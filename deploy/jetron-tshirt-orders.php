<?php
/**
 * Plugin Name: Jetron — заказы конструктора ФУТБОЛОК
 * Description: Скрытый товар, приём заказа из конструктора футболок и пересчёт цены НА СЕРВЕРЕ.
 * Version: 1.0.0
 *
 * Зачем. В конструкторе футболок кнопка «Оформить заказ» существовала, но обработчиков на ней
 * не было — покупатель ничего не мог купить. Механика повторяет конструктор ФОРМЫ
 * (jetron-constructor.php + jetron-orders.php), но формула цены здесь своя.
 *
 * ГЛАВНОЕ ПРАВИЛО: присланное браузером число (tshirt_total) НИКОГДА не становится ценой.
 * Оно сохраняется рядом только для сверки. Цена считается заново из спецификации и серверных
 * прайсов, иначе покупатель подменит сумму в браузере и купит футболку за рубль.
 *
 * Откат: удалить этот файл. Конструктор вернётся к состоянию «кнопка ничего не делает».
 */

if (!defined('ABSPATH')) { exit; }

const JETRON_TS_ORD_ROOT   = 'tshirt/';
const JETRON_TS_ORD_OPTION = 'jetron_tshirt_wc_product';
const JETRON_TS_ORD_TITLE  = 'Футболка с нанесением — конструктор';
const JETRON_TS_ORD_SUBDIR = 'jetron-tshirt-orders';
const JETRON_TS_ORD_BASE   = 600;      // цена товара-заглушки; реальную ставит пересчёт
const JETRON_TS_ORD_MIN    = 100;      // страховка: ниже этого цену не ставим
const JETRON_TS_ORD_MAX    = 1000000;
const JETRON_TS_ORD_MAXQTY = 1000;

add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) { return; }

    add_action('init', 'jetron_ts_ord_ensure_product', 20);
    add_filter('woocommerce_add_cart_item_data', 'jetron_ts_ord_capture', 10, 2);
    add_action('woocommerce_before_calculate_totals', 'jetron_ts_ord_apply_price', 20);
    add_filter('woocommerce_get_item_data', 'jetron_ts_ord_cart_view', 10, 2);
    add_filter('woocommerce_cart_item_thumbnail', 'jetron_ts_ord_cart_thumb', 10, 3);
    add_action('woocommerce_checkout_create_order_line_item', 'jetron_ts_ord_line_meta', 10, 4);
    // Товар скрыт из каталога, поэтому обычная проверка покупаемости его бы отсекла.
    add_filter('woocommerce_is_purchasable', 'jetron_ts_ord_purchasable', 99, 2);
});

function jetron_ts_ord_file($name) {
    return ABSPATH . JETRON_TS_ORD_ROOT . $name;
}

/** Скрытый товар-контейнер: покупатель приходит к нему только из конструктора. */
function jetron_ts_ord_ensure_product() {
    $id = (int) get_option(JETRON_TS_ORD_OPTION, 0);
    if ($id && get_post_status($id) === 'publish') {
        jetron_ts_ord_write_woo_json($id);
        return $id;
    }
    if (!class_exists('WC_Product_Simple')) { return 0; }

    $product = new WC_Product_Simple();
    $product->set_name(JETRON_TS_ORD_TITLE);
    $product->set_status('publish');
    $product->set_catalog_visibility('hidden');
    $product->set_regular_price((string) JETRON_TS_ORD_BASE);
    $product->set_price((string) JETRON_TS_ORD_BASE);
    $product->set_sold_individually(false);
    $product->set_manage_stock(false);
    $id = $product->save();
    if ($id) {
        update_option(JETRON_TS_ORD_OPTION, $id);
        jetron_ts_ord_write_woo_json($id);
    }
    return $id;
}

/** Конструктор читает этот файл, чтобы знать, в какой товар слать заказ. */
function jetron_ts_ord_write_woo_json($id) {
    $path = jetron_ts_ord_file('woo.json');
    $data = wp_json_encode(array(
        'productId' => (int) $id,
        'siteUrl'   => home_url(),
        'price'     => JETRON_TS_ORD_BASE,
    ));
    $prev = is_readable($path) ? (string) file_get_contents($path) : '';
    if ($prev === $data) { return; }   // не трогаем файл на каждом запросе
    if (is_dir(dirname($path))) {
        file_put_contents($path, $data, LOCK_EX);
    }
}

function jetron_ts_ord_purchasable($purchasable, $product) {
    $id = (int) get_option(JETRON_TS_ORD_OPTION, 0);
    return ($id && $product && $product->get_id() === $id) ? true : $purchasable;
}

/** Забираем данные заказа из POST в позицию корзины. */
function jetron_ts_ord_capture($data, $product_id) {
    $mine = (int) get_option(JETRON_TS_ORD_OPTION, 0);
    if (!$mine || (int) $product_id !== $mine) { return $data; }

    $data['tshirt_uid'] = wp_generate_uuid4();
    if (isset($_POST['tshirt_spec'])) {
        $data['tshirt_spec'] = sanitize_textarea_field(wp_unslash($_POST['tshirt_spec']));
    }
    if (isset($_POST['tshirt_total'])) {
        // Только для сверки. В цену не попадает нигде.
        $data['tshirt_total'] = (int) wp_unslash($_POST['tshirt_total']);
    }
    if (isset($_POST['tshirt_order'])) {
        $data['tshirt_order'] = jetron_ts_ord_parse(wp_unslash($_POST['tshirt_order']));
    }
    if (isset($_POST['tshirt_png'])) {
        $url = jetron_ts_ord_save_png(wp_unslash($_POST['tshirt_png']), $data['tshirt_uid']);
        if ($url) { $data['tshirt_png'] = $url; }
    }
    return $data;
}

/** Разбор спецификации с жёсткими границами: она пришла из браузера. */
function jetron_ts_ord_parse($raw) {
    if (!is_string($raw) || strlen($raw) > 8192) { return null; }
    $o = json_decode($raw, true, 8);
    if (!is_array($o)) { return null; }

    $out = array(
        'type'     => isset($o['type']) ? sanitize_key($o['type']) : '',
        'densityG' => isset($o['densityG']) ? (int) $o['densityG'] : 0,
        'colorId'  => isset($o['colorId']) ? sanitize_key($o['colorId']) : '',
        'age'      => (isset($o['age']) && $o['age'] === 'child') ? 'child' : 'adult',
        'quantity' => isset($o['quantity']) ? (int) $o['quantity'] : 1,
        'sides'    => array(),
    );
    if ($out['quantity'] < 1) { $out['quantity'] = 1; }
    if ($out['quantity'] > JETRON_TS_ORD_MAXQTY) { $out['quantity'] = JETRON_TS_ORD_MAXQTY; }

    foreach (array('front', 'back') as $side) {
        $src = isset($o['sides'][$side]) && is_array($o['sides'][$side]) ? $o['sides'][$side] : array();
        $prints = array();
        $list = isset($src['prints']) && is_array($src['prints']) ? $src['prints'] : array();
        // Потолок на число принтов: конфиг разрешает два на сторону, берём с запасом.
        foreach (array_slice($list, 0, 10) as $p) {
            $w = isset($p['wCm']) ? (float) $p['wCm'] : 0;
            $h = isset($p['hCm']) ? (float) $p['hCm'] : 0;
            if ($w > 0 && $h > 0 && $w <= 200 && $h <= 200) {
                $prints[] = array('wCm' => $w, 'hCm' => $h);
            }
        }
        $texts = isset($src['texts']) ? (int) $src['texts'] : 0;
        if ($texts < 0) { $texts = 0; }
        if ($texts > 10) { $texts = 10; }
        $out['sides'][$side] = array('prints' => $prints, 'texts' => $texts);
    }
    return $out;
}

/** Макет из конструктора: data-URL превращаем в файл в uploads. */
function jetron_ts_ord_save_png($dataurl, $uid) {
    if (!is_string($dataurl) || !preg_match('#^data:image/(png|jpe?g);base64,#i', $dataurl, $m)) {
        return '';
    }
    $ext = (strtolower($m[1]) === 'png') ? 'png' : 'jpg';
    $b64 = substr($dataurl, strpos($dataurl, ',') + 1);
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) < 32 || strlen($bin) > 8 * 1024 * 1024) { return ''; }

    $up = wp_upload_dir();
    $dir = trailingslashit($up['basedir']) . JETRON_TS_ORD_SUBDIR;
    if (!wp_mkdir_p($dir)) { return ''; }
    $name = 'tshirt-' . sanitize_file_name($uid) . '.' . $ext;
    if (file_put_contents(trailingslashit($dir) . $name, $bin) === false) { return ''; }
    return trailingslashit($up['baseurl']) . JETRON_TS_ORD_SUBDIR . '/' . $name;
}

// ── Пересчёт цены на сервере ────────────────────────────────────────────────
// Зеркало формулы из src/js/tshirt/OrderBuilder.js:
//   total = база(фасон × плотность) + печать(ступенчато) + надписи(со скидкой при принте)

/** Прайсы: базовый конфиг конструктора плюс правки владельца из админки. */
function jetron_ts_ord_prices() {
    $cfg = array();
    $base_file = jetron_ts_ord_file('src/config/tshirt-mock-config.json');
    if (is_readable($base_file)) {
        $j = json_decode((string) file_get_contents($base_file), true);
        if (is_array($j)) { $cfg = $j; }
    }
    $admin_file = jetron_ts_ord_file('admin.json');
    if (!is_readable($admin_file)) { return $cfg; }
    $a = json_decode((string) file_get_contents($admin_file), true);
    if (!is_array($a)) { return $cfg; }

    if (isset($a['prices']['form']) && is_array($a['prices']['form'])) {
        foreach ($a['prices']['form'] as $type => $row) {
            if (!is_array($row)) { continue; }
            foreach ($row as $g => $price) {
                if (is_numeric($price)) { $cfg['prices']['form'][$type][(string) $g] = $price + 0; }
            }
        }
    }
    if (isset($a['prices']['print']['methods']) && is_array($a['prices']['print']['methods'])) {
        foreach ($a['prices']['print']['methods'] as $id => $m) {
            if (isset($m['tiers']) && is_array($m['tiers'])) {
                $cfg['prices']['print']['methods'][$id]['tiers'] = $m['tiers'];
            }
        }
    }
    if (isset($a['prices']['text']) && is_array($a['prices']['text'])) {
        foreach ($a['prices']['text'] as $k => $v) {
            if (is_numeric($v)) { $cfg['prices']['text'][$k] = $v + 0; }
        }
    }
    return $cfg;
}

/** Ступенчатая цена печати: минимальный тариф, в который принт помещается целиком. */
function jetron_ts_ord_print_price($cfg, $method, $w, $h) {
    $tiers = isset($cfg['prices']['print']['methods'][$method]['tiers'])
        ? $cfg['prices']['print']['methods'][$method]['tiers'] : null;
    if (!is_array($tiers) || !$tiers) { return null; }

    $fit = null;
    $max = 0;
    foreach ($tiers as $t) {
        if (!isset($t['wCm'], $t['hCm'], $t['price'])) { continue; }
        $price = (float) $t['price'];
        if ($price > $max) { $max = $price; }
        if ((float) $t['wCm'] >= $w && (float) $t['hCm'] >= $h) {
            if ($fit === null || $price < $fit) { $fit = $price; }
        }
    }
    // Больше всех рамок — потолок сетки: то же поведение, что в StepPrice.js.
    if ($fit !== null) { return $fit; }
    return ($max > 0) ? $max : null;
}

/** Цена за ОДНУ футболку по спецификации. null — посчитать не смогли, цену не трогаем. */
function jetron_ts_ord_calc($spec) {
    if (!is_array($spec)) { return null; }
    $cfg = jetron_ts_ord_prices();

    $byType = isset($cfg['prices']['form'][$spec['type']]) ? $cfg['prices']['form'][$spec['type']] : null;
    if (!is_array($byType)) { return null; }

    $key = (string) $spec['densityG'];
    if (isset($byType[$key]) && is_numeric($byType[$key])) {
        $base = (float) $byType[$key];
    } else {
        // Фолбэк на первую плотность фасона — то же, что делает OrderBuilder.js.
        $base = null;
        foreach ($byType as $v) {
            if (is_numeric($v)) { $base = (float) $v; break; }
        }
        if ($base === null) { return null; }
    }

    $count = 0;
    $texts = 0;
    foreach (array('front', 'back') as $side) {
        $s = isset($spec['sides'][$side]) ? $spec['sides'][$side] : array();
        $count += isset($s['prints']) ? count($s['prints']) : 0;
        $texts += isset($s['texts']) ? (int) $s['texts'] : 0;
    }

    // ⚠️ Метод выводим САМИ, а не берём из браузера: принт → DTF, только надпись → плёнка
    // (PrintMethod.js). Иначе покупатель прислал бы дешёвый метод к дорогой печати.
    $method = ($count > 0) ? 'dtf' : 'film';

    $prints = 0.0;
    foreach (array('front', 'back') as $side) {
        $s = isset($spec['sides'][$side]) ? $spec['sides'][$side] : array();
        foreach ((isset($s['prints']) ? $s['prints'] : array()) as $p) {
            $price = jetron_ts_ord_print_price($cfg, $method, (float) $p['wCm'], (float) $p['hCm']);
            if ($price === null) { return null; }
            $prints += $price;
        }
    }

    $texts_total = 0.0;
    if ($texts > 0) {
        $standalone = isset($cfg['prices']['text']['standalone']) ? (float) $cfg['prices']['text']['standalone'] : 0;
        $pct = isset($cfg['prices']['text']['combinedDiscountPct']) ? (float) $cfg['prices']['text']['combinedDiscountPct'] : 0;
        if ($pct < 0) { $pct = 0; }
        if ($pct > 100) { $pct = 100; }
        $one = ($count > 0) ? round($standalone * (1 - $pct / 100)) : $standalone;
        $texts_total = $one * $texts;
    }

    $unit = round($base + $prints + $texts_total);
    if ($unit < JETRON_TS_ORD_MIN || $unit > JETRON_TS_ORD_MAX) { return null; }
    return array('unit' => $unit, 'base' => $base, 'prints' => $prints, 'texts' => $texts_total, 'method' => $method);
}

function jetron_ts_ord_apply_price($cart) {
    if (is_admin() && !defined('DOING_AJAX')) { return; }
    foreach ($cart->get_cart() as $item) {
        if (empty($item['tshirt_order']) || empty($item['data'])) { continue; }
        $calc = jetron_ts_ord_calc($item['tshirt_order']);
        if ($calc) { $item['data']->set_price($calc['unit']); }
    }
}

function jetron_ts_ord_cart_view($items, $item) {
    if (!empty($item['tshirt_spec'])) {
        $items[] = array('name' => 'Конфигурация', 'value' => nl2br(esc_html($item['tshirt_spec'])));
    }
    if (!empty($item['tshirt_png'])) {
        $items[] = array(
            'name'  => 'Макет',
            'value' => '<a href="' . esc_url($item['tshirt_png']) . '" target="_blank" rel="noopener">открыть</a>',
        );
    }
    return $items;
}

function jetron_ts_ord_cart_thumb($thumb, $item) {
    if (!empty($item['tshirt_png'])) {
        return '<img src="' . esc_url($item['tshirt_png']) . '" alt="Макет футболки" style="width:100%;height:auto">';
    }
    return $thumb;
}

function jetron_ts_ord_line_meta($line, $key, $values, $order) {
    if (!empty($values['tshirt_spec'])) {
        $line->add_meta_data('Конфигурация', $values['tshirt_spec']);
    }
    if (!empty($values['tshirt_png'])) {
        $line->add_meta_data('Макет', $values['tshirt_png']);
    }
    if (empty($values['tshirt_order'])) { return; }

    $calc = jetron_ts_ord_calc($values['tshirt_order']);
    if ($calc) {
        $line->add_meta_data('Расчёт сервера, ₽ за штуку', (int) $calc['unit']);
        $line->add_meta_data('Нанесение (определено сервером)', ($calc['method'] === 'dtf') ? 'DTF' : 'Плёнка');
    }
    if (!isset($values['tshirt_total'])) { return; }

    $client = (int) $values['tshirt_total'];
    $line->add_meta_data('Расчёт конструктора, ₽', $client);
    // Расхождение видно менеджеру сразу: либо прайсы разъехались, либо подмена в браузере.
    if ($calc && abs($client - (int) $calc['unit']) > 1) {
        $line->add_meta_data('Расхождение с расчётом браузера', 'да');
    }
}
