<?php
/**
 * Plugin Name: Jetron Tshirt Constructor Admin
 * Description: Страница настроек конструктора футболок: цены печати и надписи, изделия и цвета, библиотека принтов. Пишет tshirt/admin.json и tshirt/prints.json.
 * Version: 1.0.0
 *
 * Устанавливать как mu-plugin: wp-content/mu-plugins/jetron-tshirt-admin.php.
 * Тот же подход, что и у jetron-admin.php (конструктор формы): права администратора + nonce,
 * валидация, запись JSON рядом с конструктором. Конструктор накладывает настройки поверх
 * базового конфига (src/js/tshirt/AdminOverrides.js) и игнорирует битые разделы.
 *
 * Цена САМОГО ИЗДЕЛИЯ здесь НЕ настраивается — она берётся из карточки товара WooCommerce.
 */

if (!defined('ABSPATH')) {
    exit;
}

const JETRON_TS_NONCE = 'jetron_tshirt_admin';
const JETRON_TS_ROOT  = 'tshirt/';
const JETRON_TS_ZONES_NONCE = 'jetron_tshirt_zones';

function jetron_ts_path($file) {
    return ABSPATH . JETRON_TS_ROOT . $file;
}

function jetron_ts_dir($sub) {
    return ABSPATH . JETRON_TS_ROOT . 'assets/' . $sub . '/';
}

/** Чтение JSON-файла настроек (пустой массив, если нет или битый). */
function jetron_ts_load($file) {
    $path = jetron_ts_path($file);
    if (!file_exists($path)) {
        return array();
    }
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : array();
}

function jetron_ts_save($file, $data) {
    // serialize_precision на хостинге стоит 17, и round($v, 4) всё равно уходил в файл как
    // 0.20000000000000001110223024625... Значение верное, но файл распухает и не читается
    // глазами. -1 включает кратчайшую запись, которая обратно разбирается в то же число.
    $prev = @ini_get('serialize_precision');
    @ini_set('serialize_precision', '-1');
    $json = wp_json_encode(empty($data) ? new stdClass() : $data,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($prev !== false) {
        @ini_set('serialize_precision', $prev);
    }
    return file_put_contents(jetron_ts_path($file), $json, LOCK_EX);
}

/** Базовый конфиг и базовый манифест принтов — источник значений по умолчанию. */
function jetron_ts_base($which) {
    static $cache = array();
    if (isset($cache[$which])) {
        return $cache[$which];
    }
    $map = array(
        'config' => 'src/config/tshirt-mock-config.json',
        'prints' => 'src/config/prints-manifest.json',
    );
    $path = jetron_ts_path($map[$which]);
    $data = file_exists($path) ? json_decode(file_get_contents($path), true) : array();
    $cache[$which] = is_array($data) ? $data : array();
    return $cache[$which];
}

/** Неотрицательное число или null (пустая строка = «не задано»). */
function jetron_ts_num($v) {
    if ($v === null || $v === '') {
        return null;
    }
    $v = str_replace(',', '.', (string) $v);
    if (!is_numeric($v)) {
        return null;
    }
    $n = (float) $v;
    return $n >= 0 ? $n : null;
}

/** Безопасное имя файла: транслит + белый список расширений. */
function jetron_ts_safe_name($name, $allowed) {
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed, true)) {
        return null;
    }
    $base = sanitize_title(pathinfo($name, PATHINFO_FILENAME));
    if ($base === '') {
        $base = 'file-' . substr(md5($name . microtime()), 0, 6);
    }
    return $base . '.' . $ext;
}

/** Файлы поля в едином виде. Поле может быть одиночным (name="x") и множественным (name="x[]"). */
function jetron_ts_field_files($field) {
    if (empty($_FILES[$field]['name'])) {
        return array();
    }
    $f = $_FILES[$field];
    if (!is_array($f['name'])) {
        return array(array('name' => $f['name'], 'tmp_name' => $f['tmp_name'], 'size' => $f['size']));
    }
    $out = array();
    foreach ($f['name'] as $i => $name) {
        if ($name === '') {
            continue;
        }
        $out[] = array('name' => $name, 'tmp_name' => $f['tmp_name'][$i], 'size' => $f['size'][$i]);
    }
    return $out;
}

/** Проверка и перенос одного файла в tshirt/assets/<sub>/. Путь или массив с ошибкой. */
function jetron_ts_store_file($file, $sub, $allowed, $max_mb = 25, $must_be_image = true) {
    // Клиент 30.07 не смог загрузить картинку и не понял почему. Поэтому в каждом отказе
    // теперь видно ИМЯ файла, его вес и расширение — причина читается сразу.
    $who = '«' . sanitize_text_field($file['name']) . '»';
    $ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
    $mb  = round(((float) $file['size']) / 1048576, 1);
    if (!is_uploaded_file($file['tmp_name'])) {
        return array('error' => $who . ': файл не дошёл до сервера, попробуйте ещё раз.');
    }
    if ($file['size'] > $max_mb * 1024 * 1024) {
        return array('error' => $who . ': весит ' . $mb . ' МБ, а можно до ' . $max_mb . ' МБ. Сожмите файл.');
    }
    if ($must_be_image && !@getimagesize($file['tmp_name'])) {
        return array('error' => $who . ': это не картинка' . ($ext ? ' (расширение .' . $ext . ')' : '')
            . '. Нужен PNG, JPG или WebP. Формат HEIC с айфона и Mac не подходит, пересохраните в PNG.');
    }
    $name = jetron_ts_safe_name($file['name'], $allowed);
    if ($name === null) {
        return array('error' => $who . ': формат .' . ($ext ?: '?') . ' не подходит. Разрешены: '
            . implode(', ', $allowed) . '.');
    }
    $dir = jetron_ts_dir($sub);
    if (!is_dir($dir)) {
        wp_mkdir_p($dir);
    }
    if (file_exists($dir . $name)) {
        $ext  = pathinfo($name, PATHINFO_EXTENSION);
        $name = pathinfo($name, PATHINFO_FILENAME) . '-' . substr(md5(microtime()), 0, 4) . '.' . $ext;
    }
    if (!move_uploaded_file($file['tmp_name'], $dir . $name)) {
        return array('error' => 'Не удалось сохранить файл. Проверьте права на папку.');
    }
    return 'assets/' . $sub . '/' . $name;
}

/** Загрузка одиночного файла: путь, null (файла нет) или массив с ошибкой. */
function jetron_ts_upload($field, $sub, $allowed, $max_mb = 25, $must_be_image = true) {
    $files = jetron_ts_field_files($field);
    if (!count($files)) {
        return null;
    }
    return jetron_ts_store_file($files[0], $sub, $allowed, $max_mb, $must_be_image);
}

/**
 * Редактор зоны печати (только админ). Конструктор открывается по /tshirt/?zones=edit,
 * там владелец таскает рамку по мокапу и сохраняет её сюда. Пишем tshirt/zones.json.
 */
add_action('wp_ajax_jetron_ts_zones_boot', function () {
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array('message' => 'Недостаточно прав.'), 403);
    }
    wp_send_json_success(array('nonce' => wp_create_nonce(JETRON_TS_ZONES_NONCE)));
});

add_action('wp_ajax_jetron_ts_zones', function () {
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array('message' => 'Недостаточно прав.'), 403);
    }
    if (!check_ajax_referer(JETRON_TS_ZONES_NONCE, 'nonce', false)) {
        wp_send_json_error(array('message' => 'Страница устарела, обновите её.'), 400);
    }
    $raw = json_decode(wp_unslash($_POST['zones'] ?? ''), true);
    if (!is_array($raw)) {
        wp_send_json_error(array('message' => 'Не разобрал координаты.'), 400);
    }
    $clean = array();
    foreach ($raw as $view => $box) {
        $view = sanitize_key($view);
        if (!in_array($view, array('front', 'back'), true) || !is_array($box)) {
            continue;
        }
        $out = array();
        foreach (array('x', 'y', 'w', 'h') as $k) {
            if (!isset($box[$k]) || !is_numeric($box[$k])) {
                wp_send_json_error(array('message' => 'Координата ' . $k . ' не число.'), 400);
            }
            $v = (float) $box[$k];
            // Доли мокапа: за пределы 0..1 рамка уехать не может.
            $out[$k] = round(min(max($v, 0), 1), 4);
        }
        if ($out['w'] <= 0 || $out['h'] <= 0) {
            wp_send_json_error(array('message' => 'Нулевая рамка не сохраняется.'), 400);
        }
        if ($out['w'] > 1 || $out['h'] > 1) {
            wp_send_json_error(array('message' => 'Рамка больше макета.'), 400);
        }
        // Рамка должна целиком лежать на макете: иначе часть зоны печати висит за футболкой.
        $out['x'] = round(min($out['x'], 1 - $out['w']), 4);
        $out['y'] = round(min($out['y'], 1 - $out['h']), 4);
        $clean[$view] = $out;
    }
    if (!count($clean)) {
        wp_send_json_error(array('message' => 'Нет ни одной корректной зоны.'), 400);
    }
    // Детские зоны (клиент 01.08: «в детской не могу увеличить квадрат»). Раньше детская
    // всегда выводилась из взрослой по сантиметрам, и увеличить её было нельзя. Теперь
    // она правится отдельно и лежит в том же файле под ключом child. Раздел необязательный.
    if (isset($raw['child']) && is_array($raw['child'])) {
        $child = array();
        foreach ($raw['child'] as $view => $box) {
            $view = sanitize_key($view);
            if (!in_array($view, array('front', 'back'), true) || !is_array($box)) {
                continue;
            }
            $out = array();
            $bad = false;
            foreach (array('x', 'y', 'w', 'h') as $k) {
                if (!isset($box[$k]) || !is_numeric($box[$k])) { $bad = true; break; }
                $out[$k] = round(min(max((float) $box[$k], 0), 1), 4);
            }
            if ($bad || $out['w'] <= 0 || $out['h'] <= 0) {
                continue;
            }
            $out['x'] = round(min($out['x'], 1 - $out['w']), 4);
            $out['y'] = round(min($out['y'], 1 - $out['h']), 4);
            $child[$view] = $out;
        }
        if (count($child)) {
            $clean['child'] = $child;
        }
    }
    if (jetron_ts_save('zones.json', $clean) === false) {
        wp_send_json_error(array('message' => 'Не удалось записать файл.'), 500);
    }

    // Кадрирование мокапов приходит тем же сохранением (клиент 30.07: «как увеличить размеры
    // футболки»). Формат: {"<id модели>": {x,y,w,h}} в долях картинки. Раздел необязательный:
    // его отсутствие не должно ломать сохранение зон, поэтому обрабатываем ПОСЛЕ них.
    $crops_raw = json_decode(wp_unslash($_POST['crops'] ?? ''), true);
    $crops = array();
    if (is_array($crops_raw)) {
        foreach ($crops_raw as $form_id => $c) {
            $form_id = sanitize_text_field($form_id);
            if ($form_id === '' || !is_array($c)) {
                continue;
            }
            $box = array();
            $bad = false;
            foreach (array('x', 'y', 'w', 'h') as $k) {
                if (!isset($c[$k]) || !is_numeric($c[$k])) { $bad = true; break; }
                $box[$k] = round(min(max((float) $c[$k], 0), 1), 4);
            }
            // Слишком мелкий кадр превращает мокап в кашу; вылезающий за картинку — бессмыслица.
            if ($bad || $box['w'] < 0.1 || $box['h'] < 0.1) {
                continue;
            }
            if ($box['x'] + $box['w'] > 1.0001 || $box['y'] + $box['h'] > 1.0001) {
                continue;
            }
            $crops[$form_id] = $box;
        }
    }
    if (jetron_ts_save('crops.json', $crops) === false) {
        wp_send_json_error(array('message' => 'Зоны сохранены, а кадры нет: файл не записался.'), 500);
    }

    // Ширина поля с футболкой (клиент 01.08: «мне нужно вот это поле увеличить прямо
    // до краёв»). Приходит тем же сохранением. Диапазон повторяет StageWidth.js на фронте:
    // уже 1000 сцену съедает панель, шире 2000 строка ведёт глаз слишком далеко.
    // Раздел необязательный: его отсутствие не должно ломать сохранение зон.
    $stage_raw = json_decode(wp_unslash($_POST['stage'] ?? ''), true);
    $stage = array();
    if (is_array($stage_raw) && isset($stage_raw['width']) && is_numeric($stage_raw['width'])) {
        $w = (int) round((float) $stage_raw['width']);
        if ($w >= 1000 && $w <= 2000) {
            $stage = array('width' => $w);
        }
    }
    if (jetron_ts_save('stage.json', $stage) === false) {
        wp_send_json_error(array('message' => 'Зоны сохранены, а ширина поля нет: файл не записался.'), 500);
    }

    wp_send_json_success(array('saved' => array_keys($clean), 'crops' => count($crops), 'stage' => $stage));
});

/** Пункт меню в админке. */
add_action('admin_menu', function () {
    add_menu_page(
        'Конструктор футболок',
        'Конструктор футболок',
        'manage_options',
        'jetron-tshirt',
        'jetron_ts_page',
        'dashicons-tag',
        59
    );
});

/** Текущие цены: из админки, иначе из базового конфига. */
function jetron_ts_prices() {
    $admin = jetron_ts_load('admin.json');
    $base  = jetron_ts_base('config');
    $out   = isset($base['prices']) ? $base['prices'] : array();
    if (isset($admin['prices']['print']['methods'])) {
        foreach ($admin['prices']['print']['methods'] as $id => $m) {
            if (!empty($m['tiers'])) {
                $out['print']['methods'][$id]['tiers'] = $m['tiers'];
            }
        }
    }
    if (isset($admin['prices']['text'])) {
        $out['text'] = array_merge(isset($out['text']) ? $out['text'] : array(), $admin['prices']['text']);
    }
    return $out;
}

/** Текущие категории принтов: из админки, иначе базовый манифест. */
function jetron_ts_categories() {
    $over = jetron_ts_load('prints.json');
    if (!empty($over['categories'])) {
        return $over['categories'];
    }
    $base = jetron_ts_base('prints');
    return isset($base['categories']) ? $base['categories'] : array();
}

/** Текущий каталог изделий: из админки, иначе базовый конфиг. */
function jetron_ts_forms() {
    $admin = jetron_ts_load('admin.json');
    if (!empty($admin['forms'])) {
        return $admin['forms'];
    }
    $base = jetron_ts_base('config');
    return isset($base['forms']) ? $base['forms'] : array();
}

function jetron_ts_colors() {
    $admin = jetron_ts_load('admin.json');
    if (!empty($admin['colors'])) {
        return $admin['colors'];
    }
    $base = jetron_ts_base('config');
    return isset($base['colors']) ? $base['colors'] : array();
}

/** Обработка форм. Возвращает array(тип, текст) для уведомления. */
function jetron_ts_handle() {
    if (empty($_POST['jetron_ts_action'])) {
        return null;
    }
    if (!current_user_can('manage_options')) {
        return array('error', 'Недостаточно прав.');
    }
    if (!isset($_POST['_wpnonce']) || !wp_verify_nonce($_POST['_wpnonce'], JETRON_TS_NONCE)) {
        return array('error', 'Страница устарела, обновите её и повторите.');
    }
    $action = sanitize_text_field(wp_unslash($_POST['jetron_ts_action']));
    $admin  = jetron_ts_load('admin.json');

    if ($action === 'prices') {
        $methods = array();
        foreach ((array) ($_POST['tier'] ?? array()) as $method => $rows) {
            $method = sanitize_key($method);
            $tiers  = array();
            foreach ((array) $rows as $i => $row) {
                $w = jetron_ts_num(wp_unslash($row['w'] ?? ''));
                $h = jetron_ts_num(wp_unslash($row['h'] ?? ''));
                $p = jetron_ts_num(wp_unslash($row['price'] ?? ''));
                if ($w && $h && $p) {
                    $tiers[] = array('wCm' => $w, 'hCm' => $h, 'price' => $p);
                }
            }
            if (count($tiers)) {
                $methods[$method] = array('tiers' => $tiers);
            }
        }
        if (!count($methods)) {
            return array('error', 'Ни одной корректной ступени. Нужны ширина, высота и цена больше нуля.');
        }
        $text = array();
        $st = jetron_ts_num(wp_unslash($_POST['text_standalone'] ?? ''));
        if ($st !== null) {
            $text['standalone'] = $st;
        }
        $dc = jetron_ts_num(wp_unslash($_POST['text_discount'] ?? ''));
        if ($dc !== null && $dc <= 100) {
            $text['combinedDiscountPct'] = $dc;
        }
        $admin['prices'] = array('print' => array('methods' => $methods), 'text' => $text);
        return jetron_ts_save('admin.json', $admin) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Цены печати и надписи сохранены.');
    }

    if ($action === 'cat_add') {
        $label = sanitize_text_field(wp_unslash($_POST['cat_label'] ?? ''));
        if ($label === '') {
            return array('error', 'Введите название категории.');
        }
        $slug = sanitize_title($label);
        if ($slug === '') {
            $slug = 'cat-' . substr(md5($label), 0, 6);
        }
        $cats = jetron_ts_categories();
        foreach ($cats as $c) {
            if (($c['slug'] ?? '') === $slug) {
                return array('error', 'Категория «' . $label . '» уже есть.');
            }
        }
        $cats[] = array('slug' => $slug, 'label' => $label, 'items' => array());
        return jetron_ts_save('prints.json', array('categories' => $cats)) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Категория «' . $label . '» добавлена. Теперь загрузите в неё картинки.');
    }

    if ($action === 'cat_del') {
        $slug = sanitize_title(wp_unslash($_POST['cat_slug'] ?? ''));
        $cats = array_values(array_filter(jetron_ts_categories(), function ($c) use ($slug) {
            return ($c['slug'] ?? '') !== $slug;
        }));
        return jetron_ts_save('prints.json', array('categories' => $cats)) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Категория удалена. Файлы картинок остались на сервере.');
    }

    if ($action === 'cat_rename') {
        $slug  = sanitize_title(wp_unslash($_POST['cat_slug'] ?? ''));
        $label = sanitize_text_field(wp_unslash($_POST['cat_label'] ?? ''));
        if ($label === '') {
            return array('error', 'Введите новое название категории.');
        }
        // Меняем только подпись: slug — это папка с картинками, её трогать нельзя.
        $cats  = jetron_ts_categories();
        $found = false;
        foreach ($cats as &$c) {
            if (($c['slug'] ?? '') === $slug) {
                $c['label'] = $label;
                $found = true;
            }
        }
        unset($c);
        if (!$found) {
            return array('error', 'Категория не найдена, обновите страницу.');
        }
        return jetron_ts_save('prints.json', array('categories' => $cats)) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Категория переименована в «' . $label . '».');
    }

    if ($action === 'cat_move') {
        $slug = sanitize_title(wp_unslash($_POST['cat_slug'] ?? ''));
        $dir  = wp_unslash($_POST['dir'] ?? '') === 'up' ? -1 : 1;
        $cats = jetron_ts_categories();
        $pos  = null;
        foreach ($cats as $i => $c) {
            if (($c['slug'] ?? '') === $slug) {
                $pos = $i;
            }
        }
        if ($pos === null) {
            return array('error', 'Категория не найдена, обновите страницу.');
        }
        $to = $pos + $dir;
        if ($to < 0 || $to >= count($cats)) {
            return array('ok', 'Категория уже с краю списка.');
        }
        $tmp        = $cats[$pos];
        $cats[$pos] = $cats[$to];
        $cats[$to]  = $tmp;
        return jetron_ts_save('prints.json', array('categories' => $cats)) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Порядок категорий изменён.');
    }

    if ($action === 'print_add') {
        $slug  = sanitize_title(wp_unslash($_POST['cat_slug'] ?? ''));
        $files = jetron_ts_field_files('print_file');
        if (!count($files)) {
            return array('error', 'Выберите хотя бы одну картинку принта.');
        }
        $cats = jetron_ts_categories();
        $pos  = null;
        foreach ($cats as $i => $c) {
            if (($c['slug'] ?? '') === $slug) {
                $pos = $i;
            }
        }
        if ($pos === null) {
            return array('error', 'Категория не найдена.');
        }
        // Пачка: битые файлы пропускаем, остальные сохраняем и перечисляем ошибки в конце.
        $added  = 0;
        $errors = array();
        foreach ($files as $file) {
            $path = jetron_ts_store_file($file, 'prints/' . $slug, array('png', 'jpg', 'jpeg', 'webp'));
            if (is_array($path)) {
                $errors[] = $file['name'] . ': ' . $path['error'];
                continue;
            }
            $up_tone = sanitize_key(wp_unslash($_POST['print_tone'] ?? 'light'));
            if (!in_array($up_tone, array('light', 'dark', 'any'), true)) {
                $up_tone = 'light';
            }
            $cats[$pos]['items'][] = array(
                'id'   => $slug . '-' . substr(md5($path . microtime()), 0, 6),
                'file' => $path,
                'tone' => $up_tone,
                'dark' => ($up_tone === 'dark'),
            );
            $added++;
        }
        if ($added && jetron_ts_save('prints.json', array('categories' => $cats)) === false) {
            return array('error', 'Не удалось записать настройки.');
        }
        if (!$added) {
            return array('error', 'Ни один файл не загрузился. ' . implode(' · ', $errors));
        }
        $msg = 'Загружено картинок: ' . $added . '.';
        if (count($errors)) {
            $msg .= ' Не приняты: ' . implode(' · ', $errors);
            return array('error', $msg);
        }
        return array('ok', $msg);
    }

    if ($action === 'print_tone') {
        // Клиент 01.08: «есть принты третьей категории, которые туда и туда». Раньше признак
        // был галочкой тёмный/светлый, теперь три состояния. Старое значение `dark` пишем
        // рядом, чтобы вкладка со старой сборкой из кеша продолжала показывать то же самое.
        $slug = sanitize_title(wp_unslash($_POST['cat_slug'] ?? ''));
        $id   = sanitize_text_field(wp_unslash($_POST['print_id'] ?? ''));
        $tone = sanitize_key(wp_unslash($_POST['print_tone'] ?? ''));
        if (!in_array($tone, array('light', 'dark', 'any'), true)) {
            return array('error', 'Неизвестный тон принта.');
        }
        $cats  = jetron_ts_categories();
        $found = false;
        foreach ($cats as &$c) {
            if (($c['slug'] ?? '') !== $slug) {
                continue;
            }
            foreach ($c['items'] as &$i) {
                if (($i['id'] ?? '') === $id) {
                    $i['tone'] = $tone;
                    $i['dark'] = ($tone === 'dark');
                    $found = true;
                }
            }
            unset($i);
        }
        unset($c);
        if (!$found) {
            return array('error', 'Принт не найден, обновите страницу.');
        }
        $names = array('light' => 'для светлых', 'dark' => 'для тёмных', 'any' => 'для любых');
        return jetron_ts_save('prints.json', array('categories' => $cats)) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Принт помечен: ' . $names[$tone] . '.');
    }

    if ($action === 'print_del') {
        $slug = sanitize_title(wp_unslash($_POST['cat_slug'] ?? ''));
        $id   = sanitize_text_field(wp_unslash($_POST['print_id'] ?? ''));
        $cats = jetron_ts_categories();
        foreach ($cats as &$c) {
            if (($c['slug'] ?? '') === $slug) {
                $c['items'] = array_values(array_filter((array) ($c['items'] ?? array()), function ($i) use ($id) {
                    return ($i['id'] ?? '') !== $id;
                }));
            }
        }
        unset($c);
        return jetron_ts_save('prints.json', array('categories' => $cats)) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Принт убран из категории.');
    }
    return jetron_ts_handle_products($admin, $action);
}

/** Вкладка «Изделия и цвета»: добавление мокапа, удаление, сброс разделов. */
function jetron_ts_handle_products($admin, $action) {
    if ($action === 'form_add') {
        $front = jetron_ts_upload('img_front', 'mockups-final', array('png', 'jpg', 'jpeg', 'webp'));
        if (is_array($front)) {
            return array('error', 'Фото спереди. ' . $front['error']);
        }
        if ($front === null) {
            return array('error', 'Нужна фотография вида спереди.');
        }
        $back = jetron_ts_upload('img_back', 'mockups-final', array('png', 'jpg', 'jpeg', 'webp'));
        if (is_array($back)) {
            return array('error', 'Фото сзади. ' . $back['error']);
        }
        if ($back === null) {
            $back = $front;
        }
        $type  = sanitize_key(wp_unslash($_POST['form_type'] ?? 'base'));
        $type  = in_array($type, array('base', 'oversize'), true) ? $type : 'base';
        $color = sanitize_text_field(wp_unslash($_POST['color_name'] ?? ''));
        $hex   = sanitize_hex_color(wp_unslash($_POST['color_hex'] ?? ''));
        if ($color === '' || !$hex) {
            return array('error', 'Заполните название цвета и выберите цвет.');
        }
        $color_id = sanitize_key(sanitize_title($color));
        if ($color_id === '') {
            $color_id = 'color-' . substr(md5($color), 0, 4);
        }

        $colors = jetron_ts_colors();
        $has = false;
        foreach ($colors as $c) {
            if (($c['id'] ?? '') === $color_id) { $has = true; break; }
        }
        if (!$has) {
            $colors[] = array('id' => $color_id, 'name' => $color, 'hex' => $hex, 'mode' => 'photo');
        }
        $admin['colors'] = $colors;

        $label = $type === 'oversize' ? 'Оверсайз' : 'Базовая';
        $entry = array(
            'id'        => sanitize_title($type . '-' . $color),
            'type'      => $type,
            'typeLabel' => $label,
            'colorId'   => $color_id,
            'color'     => $color,
            'colorHex'  => $hex,
            'images'    => array('front' => $front, 'back' => $back),
        );
        // Такая пара «фасон + цвет» уже есть — считаем это заменой фотографий, а не дублем.
        $forms   = jetron_ts_forms();
        $replaced = false;
        foreach ($forms as &$f) {
            if (($f['id'] ?? '') === $entry['id']) {
                $f = $entry;
                $replaced = true;
            }
        }
        unset($f);
        if (!$replaced) {
            $forms[] = $entry;
        }
        $admin['forms'] = $forms;
        return jetron_ts_save('admin.json', $admin) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Изделие «' . $label . ' ' . $color . '» ' . ($replaced ? 'обновлено.' : 'добавлено.'));
    }

    if ($action === 'form_del') {
        $id    = sanitize_text_field(wp_unslash($_POST['form_id'] ?? ''));
        $forms = jetron_ts_forms();
        $left  = array_values(array_filter($forms, function ($f) use ($id) {
            return ($f['id'] ?? '') !== $id;
        }));
        if (count($left) === count($forms)) {
            return array('error', 'Изделие не найдено, обновите страницу и повторите.');
        }
        $admin['forms'] = $left;
        // Цвет без единой футболки убираем, иначе покупатель увидит пустой кружок выбора.
        $used = array();
        foreach ($left as $f) {
            $used[$f['colorId'] ?? ''] = true;
        }
        $admin['colors'] = array_values(array_filter(jetron_ts_colors(), function ($c) use ($used) {
            return isset($used[$c['id'] ?? '']);
        }));
        return jetron_ts_save('admin.json', $admin) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Изделие убрано из каталога.');
    }

    if ($action === 'reset') {
        $section = sanitize_key(wp_unslash($_POST['section'] ?? ''));
        if ($section === 'zones') {
            return jetron_ts_save('zones.json', array()) === false
                ? array('error', 'Не удалось записать настройки.')
                : array('ok', 'Зона печати возвращена к исходной.');
        }
        if ($section === 'prints') {
            return jetron_ts_save('prints.json', array()) === false
                ? array('error', 'Не удалось записать настройки.')
                : array('ok', 'Библиотека принтов возвращена к исходной.');
        }
        // Каталог футболок и список цветов связаны: сбрасываем их только вместе.
        $keys = $section === 'forms' ? array('forms', 'colors') : array($section);
        $hit  = false;
        foreach ($keys as $k) {
            if ($k !== '' && isset($admin[$k])) {
                unset($admin[$k]);
                $hit = true;
            }
        }
        if (!$hit) {
            return array('ok', 'Раздел и так со значениями по умолчанию.');
        }
        return jetron_ts_save('admin.json', $admin) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Раздел сброшен к значениям по умолчанию.');
    }
    return null;
}

/** Кнопка сброса. ВАЖНО: вызывать только ПОСЛЕ закрытия основной формы — вложенные формы
 *  браузер схлопывает, и в POST уходит reset вместо сохранения (грабли из конструктора формы). */
function jetron_ts_reset_form($section, $nonce, $label) {
    echo '<form method="post" style="display:inline-block;margin-left:10px" '
       . 'onsubmit="return confirm(&quot;Сбросить раздел к значениям по умолчанию?&quot;)">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_ts_action" value="reset">';
    echo '<input type="hidden" name="section" value="' . esc_attr($section) . '">';
    echo '<button type="submit" class="button-link" style="color:#b32d2e">' . esc_html($label) . '</button>';
    echo '</form>';
}

/** Страница настроек. */
function jetron_ts_page() {
    if (!current_user_can('manage_options')) {
        wp_die('Недостаточно прав.');
    }
    $notice = jetron_ts_handle();
    $tab    = isset($_GET['tab']) ? sanitize_key($_GET['tab']) : 'prices';
    $tabs   = array(
        'prices'   => 'Цены печати и надписи',
        'prints'   => 'Библиотека принтов',
        'products' => 'Изделия и цвета',
    );
    $nonce = wp_create_nonce(JETRON_TS_NONCE);
    $url   = admin_url('admin.php?page=jetron-tshirt');

    echo '<div class="wrap"><h1>Конструктор футболок</h1>';
    echo '<p style="margin:6px 0 14px"><a class="button" href="' . esc_url(home_url('/tshirt/')) . '" target="_blank">Открыть конструктор</a></p>';
    echo '<p style="max-width:760px;color:#50575e">Здесь настраивается то, что видит покупатель. '
       . 'Цена самой футболки сюда не входит: она берётся из карточки товара. '
       . 'Изменения появляются у покупателей после обновления страницы конструктора.</p>';

    if (is_array($notice)) {
        $cls = $notice[0] === 'ok' ? 'notice-success' : 'notice-error';
        echo '<div class="notice ' . esc_attr($cls) . ' is-dismissible"><p>' . esc_html($notice[1]) . '</p></div>';
    }
    if (!is_writable(ABSPATH . JETRON_TS_ROOT)) {
        echo '<div class="notice notice-error"><p>Папка tshirt/ недоступна для записи, настройки не сохранятся.</p></div>';
    }

    echo '<h2 class="nav-tab-wrapper">';
    foreach ($tabs as $key => $label) {
        echo '<a class="nav-tab' . ($key === $tab ? ' nav-tab-active' : '') . '" href="'
           . esc_url($url . '&tab=' . $key) . '">' . esc_html($label) . '</a>';
    }
    echo '</h2><div style="max-width:960px;margin-top:18px">';

    if ($tab === 'prices') {
        jetron_ts_tab_prices($nonce);
    } elseif ($tab === 'prints') {
        jetron_ts_tab_prints($nonce);
    } else {
        jetron_ts_tab_products($nonce);
    }
    echo '</div></div>';
}

/** Вкладка «Цены печати и надписи»: ступени по каждому методу + цена текста. */
function jetron_ts_tab_prices($nonce) {
    $prices  = jetron_ts_prices();
    $methods = isset($prices['print']['methods']) ? $prices['print']['methods'] : array();

    echo '<form method="post"><input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_ts_action" value="prices">';
    echo '<p style="color:#50575e">Цена печати ступенчатая: берётся первый тариф, в рамку которого '
       . 'принт помещается. Пустая строка — ступень не сохранится.</p>';

    foreach ($methods as $id => $m) {
        $label = isset($m['label']) ? $m['label'] : $id;
        echo '<h3>' . esc_html($label) . '</h3>';
        echo '<table class="widefat striped" style="max-width:520px"><thead><tr>'
           . '<th>Ширина, см</th><th>Высота, см</th><th>Цена, ₽</th></tr></thead><tbody>';
        $tiers = isset($m['tiers']) ? $m['tiers'] : array();
        $i = 0;
        foreach ($tiers as $t) {
            echo '<tr>';
            echo '<td><input type="number" min="1" step="1" name="tier[' . esc_attr($id) . '][' . $i . '][w]" value="' . esc_attr($t['wCm']) . '" class="small-text"></td>';
            echo '<td><input type="number" min="1" step="1" name="tier[' . esc_attr($id) . '][' . $i . '][h]" value="' . esc_attr($t['hCm']) . '" class="small-text"></td>';
            echo '<td><input type="number" min="0" step="10" name="tier[' . esc_attr($id) . '][' . $i . '][price]" value="' . esc_attr($t['price']) . '" class="small-text"></td>';
            echo '</tr>';
            $i++;
        }
        // Две пустые строки — чтобы можно было дописать новые ступени без перезагрузки.
        for ($k = 0; $k < 2; $k++) {
            echo '<tr>';
            echo '<td><input type="number" min="1" step="1" name="tier[' . esc_attr($id) . '][' . $i . '][w]" class="small-text" placeholder="—"></td>';
            echo '<td><input type="number" min="1" step="1" name="tier[' . esc_attr($id) . '][' . $i . '][h]" class="small-text" placeholder="—"></td>';
            echo '<td><input type="number" min="0" step="10" name="tier[' . esc_attr($id) . '][' . $i . '][price]" class="small-text" placeholder="—"></td>';
            echo '</tr>';
            $i++;
        }
        echo '</tbody></table>';
    }

    $text = isset($prices['text']) ? $prices['text'] : array();
    echo '<h3 style="margin-top:24px">Надпись</h3><table class="form-table"><tbody>';
    echo '<tr><th scope="row">Надпись без принта</th><td>'
       . '<input type="number" min="0" step="10" name="text_standalone" value="'
       . esc_attr($text['standalone'] ?? '') . '" class="small-text"> ₽</td></tr>';
    echo '<tr><th scope="row">Скидка на надпись вместе с принтом</th><td>'
       . '<input type="number" min="0" max="100" step="1" name="text_discount" value="'
       . esc_attr($text['combinedDiscountPct'] ?? '') . '" class="small-text"> %'
       . '<p class="description">Покупателю скидка отдельной строкой не показывается.</p></td></tr>';
    echo '</tbody></table>';
    submit_button('Сохранить цены', 'primary', 'submit', false);
    echo '</form>';
    jetron_ts_reset_form('prices', $nonce, 'Сбросить к значениям по умолчанию');
}

/** Ссылка на файл внутри папки конструктора. */
function jetron_ts_url($rel) {
    return home_url('/' . JETRON_TS_ROOT . ltrim($rel, '/'));
}

/** Вкладка «Библиотека принтов»: категории, загрузка и удаление картинок. */
function jetron_ts_tab_prints($nonce) {
    $cats = jetron_ts_categories();

    echo '<p style="color:#50575e">Категории показываются покупателю слева в окне «Выбрать из библиотеки». '
       . 'Лучше всего PNG с прозрачным фоном. Для тёмных принтов отметьте галочку, '
       . 'чтобы превью было видно на тёмной футболке.</p>';

    echo '<form method="post" style="margin:18px 0;padding:14px;background:#fff;border:1px solid #dcdcde">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_ts_action" value="cat_add">';
    echo '<label><strong>Новая категория</strong> ';
    echo '<input type="text" name="cat_label" class="regular-text" placeholder="Например: 23 февраля" required></label> ';
    submit_button('Добавить категорию', 'secondary', 'submit', false);
    echo '</form>';

    if (!count($cats)) {
        echo '<p>Категорий пока нет.</p>';
    }

    $last = count($cats) - 1;
    foreach ($cats as $idx => $c) {
        $slug  = isset($c['slug']) ? $c['slug'] : '';
        $items = isset($c['items']) ? (array) $c['items'] : array();
        echo '<div style="margin:18px 0;padding:14px;background:#fff;border:1px solid #dcdcde">';
        echo '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';

        // Переименование: подпись меняется, папка с картинками остаётся прежней.
        echo '<form method="post" style="display:flex;gap:6px;align-items:center;margin:0">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_ts_action" value="cat_rename">';
        echo '<input type="hidden" name="cat_slug" value="' . esc_attr($slug) . '">';
        echo '<input type="text" name="cat_label" value="' . esc_attr($c['label'] ?? $slug) . '" '
           . 'style="font-size:15px;font-weight:600;width:260px">';
        echo '<button type="submit" class="button button-small">Переименовать</button>';
        echo '</form>';

        echo '<span style="color:#787c82">картинок: ' . count($items) . '</span>';

        // Порядок категорий: этим списком слева пользуется покупатель.
        foreach (array('up' => '↑ выше', 'down' => '↓ ниже') as $dir => $label) {
            $disabled = ($dir === 'up' && $idx === 0) || ($dir === 'down' && $idx === $last);
            echo '<form method="post" style="margin:0">';
            echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
            echo '<input type="hidden" name="jetron_ts_action" value="cat_move">';
            echo '<input type="hidden" name="cat_slug" value="' . esc_attr($slug) . '">';
            echo '<input type="hidden" name="dir" value="' . esc_attr($dir) . '">';
            echo '<button type="submit" class="button button-small"' . ($disabled ? ' disabled' : '') . '>'
               . esc_html($label) . '</button>';
            echo '</form>';
        }
        echo '</div>';

        echo '<div style="display:flex;flex-wrap:wrap;gap:10px">';
        foreach ($items as $item) {
            echo '<div style="width:118px;text-align:center">';
            echo '<div style="height:110px;display:flex;align-items:center;justify-content:center;'
               . 'background:' . (!empty($item['dark']) ? '#3c434a' : '#f6f7f7') . ';border:1px solid #dcdcde">';
            echo '<img src="' . esc_url(jetron_ts_url($item['file'] ?? '')) . '" alt="" '
               . 'style="max-width:100%;max-height:104px">';
            echo '</div>';
            // Подпись и переключатель: до 30.07 признак был виден только по цвету подложки,
            // и клиент его не считывал («как узнать, какой я поставил пометку»).
            // Три состояния (клиент 01.08). Старая запись без `tone` читается по `dark`,
            // поэтому размётка, сделанная руками до 01.08, остаётся в силе.
            $tone = isset($item['tone']) ? $item['tone'] : (!empty($item['dark']) ? 'dark' : 'light');
            if (!in_array($tone, array('light', 'dark', 'any'), true)) {
                $tone = !empty($item['dark']) ? 'dark' : 'light';
            }
            $tone_names = array('light' => 'для светлых', 'dark' => 'для тёмных', 'any' => 'для любых');
            echo '<div style="font-size:11px;margin:3px 0 1px;color:'
               . ($tone === 'dark' ? '#3c434a' : ($tone === 'any' ? '#2271b1' : '#787c82')) . '">'
               . esc_html($tone_names[$tone]) . '</div>';
            echo '<form method="post" style="margin-bottom:2px;display:flex;gap:4px;justify-content:center">';
            echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
            echo '<input type="hidden" name="jetron_ts_action" value="print_tone">';
            echo '<input type="hidden" name="cat_slug" value="' . esc_attr($slug) . '">';
            echo '<input type="hidden" name="print_id" value="' . esc_attr($item['id'] ?? '') . '">';
            foreach (array('light' => 'свет', 'dark' => 'тёмн', 'any' => 'оба') as $key => $short) {
                $on = ($tone === $key);
                echo '<button type="submit" name="print_tone" value="' . esc_attr($key) . '" '
                   . 'class="button-link" style="font-size:11px;'
                   . ($on ? 'font-weight:700;text-decoration:none;color:#1d2327;cursor:default' : '')
                   . '"' . ($on ? ' disabled' : '') . '>' . esc_html($short) . '</button>';
            }
            echo '</form>';
            echo '<form method="post" onsubmit="return confirm(&quot;Убрать этот принт из библиотеки?&quot;)">';
            echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
            echo '<input type="hidden" name="jetron_ts_action" value="print_del">';
            echo '<input type="hidden" name="cat_slug" value="' . esc_attr($slug) . '">';
            echo '<input type="hidden" name="print_id" value="' . esc_attr($item['id'] ?? '') . '">';
            echo '<button type="submit" class="button-link" style="color:#b32d2e;font-size:12px">Убрать</button>';
            echo '</form></div>';
        }
        echo '</div>';

        echo '<form method="post" enctype="multipart/form-data" style="margin-top:12px">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_ts_action" value="print_add">';
        echo '<input type="hidden" name="cat_slug" value="' . esc_attr($slug) . '">';
        echo '<input type="file" name="print_file[]" accept=".png,.jpg,.jpeg,.webp" multiple required> ';
        echo '<span style="margin:0 10px">';
        foreach (array('light' => 'для светлых', 'dark' => 'для тёмных', 'any' => 'для любых') as $key => $label) {
            echo '<label style="margin-right:8px"><input type="radio" name="print_tone" value="'
               . esc_attr($key) . '"' . ($key === 'light' ? ' checked' : '') . '> ' . esc_html($label) . '</label>';
        }
        echo '</span>';
        submit_button('Загрузить принты', 'secondary', 'submit', false);
        echo '<p class="description" style="margin:6px 0 0">Можно выбрать сразу несколько файлов: '
           . 'Ctrl (⌘) или Shift в окне выбора. Выбранная пометка применится ко всей пачке.<br>'
           . '<b>«Для любых» — это про прозрачный фон, а не про красоту.</b> Если у картинки фон '
           . 'залит белым, на чёрной футболке получится белый прямоугольник. Проверка простая: '
           . 'положите принт на чёрное, и если вокруг него появилось светлое поле — он не универсальный.</p>';
        echo '</form>';

        echo '<form method="post" style="margin-top:6px" '
           . 'onsubmit="return confirm(&quot;Удалить категорию целиком?&quot;)">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_ts_action" value="cat_del">';
        echo '<input type="hidden" name="cat_slug" value="' . esc_attr($slug) . '">';
        echo '<button type="submit" class="button-link" style="color:#b32d2e">Удалить категорию</button>';
        echo '</form>';
        echo '</div>';
    }
    jetron_ts_reset_form('prints', $nonce, 'Вернуть исходную библиотеку принтов');
}

/** Вкладка «Изделия и цвета»: каталог футболок и добавление нового цвета. */
function jetron_ts_tab_products($nonce) {
    $forms = jetron_ts_forms();

    echo '<p style="color:#50575e">Каждая строка — футболка определённого фасона и цвета: '
       . 'покупатель выбирает её под макетом. Нужны два фото на прозрачном фоне: перёд и спина. '
       . 'Если фото спины нет, подставится фото спереди. Цена изделия сюда не вводится, '
       . 'она берётся из карточки товара.</p>';

    echo '<table class="widefat striped" style="margin-bottom:20px"><thead><tr>'
       . '<th style="width:90px">Перёд</th><th style="width:90px">Спина</th>'
       . '<th>Фасон</th><th>Цвет</th><th style="width:90px"></th></tr></thead><tbody>';
    if (!count($forms)) {
        echo '<tr><td colspan="5">Каталог пуст.</td></tr>';
    }
    foreach ($forms as $f) {
        $img = isset($f['images']) ? $f['images'] : array();
        echo '<tr>';
        foreach (array('front', 'back') as $side) {
            echo '<td><img src="' . esc_url(jetron_ts_url($img[$side] ?? '')) . '" alt="" '
               . 'style="max-width:76px;max-height:76px;background:#f6f7f7"></td>';
        }
        echo '<td>' . esc_html($f['typeLabel'] ?? ($f['type'] ?? '')) . '</td>';
        echo '<td><span style="display:inline-block;width:14px;height:14px;vertical-align:-2px;'
           . 'border:1px solid #c3c4c7;background:' . esc_attr($f['colorHex'] ?? '#fff') . '"></span> '
           . esc_html($f['color'] ?? '') . '</td>';
        echo '<td><form method="post" onsubmit="return confirm(&quot;Убрать это изделие из конструктора?&quot;)">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_ts_action" value="form_del">';
        echo '<input type="hidden" name="form_id" value="' . esc_attr($f['id'] ?? '') . '">';
        echo '<button type="submit" class="button-link" style="color:#b32d2e">Убрать</button>';
        echo '</form></td>';
        echo '</tr>';
    }
    echo '</tbody></table>';

    echo '<div style="padding:14px;background:#fff;border:1px solid #dcdcde">';
    echo '<h3 style="margin-top:0">Добавить футболку</h3>';
    echo '<form method="post" enctype="multipart/form-data">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_ts_action" value="form_add">';
    echo '<table class="form-table"><tbody>';
    echo '<tr><th scope="row">Фасон</th><td><select name="form_type">'
       . '<option value="base">Базовая</option><option value="oversize">Оверсайз</option>'
       . '</select></td></tr>';
    echo '<tr><th scope="row">Название цвета</th><td>'
       . '<input type="text" name="color_name" class="regular-text" placeholder="Например: Хаки" required>'
       . '<p class="description">Так цвет будет подписан у покупателя.</p></td></tr>';
    echo '<tr><th scope="row">Цвет кружка</th><td>'
       . '<input type="color" name="color_hex" value="#ffffff" required>'
       . '<p class="description">Кружок выбора цвета под макетом.</p></td></tr>';
    echo '<tr><th scope="row">Фото спереди</th><td>'
       . '<input type="file" name="img_front" accept=".png,.jpg,.jpeg,.webp" required></td></tr>';
    echo '<tr><th scope="row">Фото сзади</th><td>'
       . '<input type="file" name="img_back" accept=".png,.jpg,.jpeg,.webp">'
       . '<p class="description">Не обязательно: без него спина покажется тем же фото.</p></td></tr>';
    echo '</tbody></table>';
    submit_button('Добавить в конструктор', 'primary', 'submit', false);
    echo '</form></div>';

    echo '<h3 style="margin-top:26px">Зона печати</h3>';
    echo '<p style="color:#50575e;max-width:760px">Пунктирная рамка на макете это физическая зона печати: '
       . 'взрослая 40×50 см, детская выводится из неё автоматически. Если на вашей фотографии рамка '
       . 'стоит не по месту или выглядит мелкой, поправьте её в редакторе: там она двигается и '
       . 'тянется мышью, пропорции 40×50 держатся сами.</p>';
    echo '<p><a class="button button-primary" href="' . esc_url(home_url('/tshirt/?zones=edit')) . '" target="_blank">'
       . 'Открыть редактор зоны печати</a></p>';

    echo '<p style="margin-top:14px">';
    jetron_ts_reset_form('forms', $nonce, 'Вернуть исходный каталог футболок и цветов');
    echo '</p><p>';
    jetron_ts_reset_form('zones', $nonce, 'Вернуть исходную зону печати');
    echo '</p>';
}
