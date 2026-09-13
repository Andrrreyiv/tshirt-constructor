// Настройки каталога футболок из админки: плотности, цены изделия, фасоны и их видимость.
//
// Клиент 12.09: «В админке нужны настройки этих полей, сейчас категории футболок нет, но человек
// может заказать принт и мне нужно настроить плотности футболок» · «Короткий рукав (поменять
// на "Базовая")» · «Внизу добавить третью кнопку "Длинный рукав"» · «В настройках дать
// возможность отключать эти кнопки из видимости».
//
// До этой правки админка настраивала только цены печати, надписи, цвета и мокапы
// (AdminOverrides.js:12-19). Плотности жили ТОЛЬКО в конфиге, подписи фасонов — тоже, а цена
// изделия считалась из `prices.form` и админкой не перекрывалась ничем.
//
// ⚠️ Замер 13.09 опроверг прежнюю запись «цена изделия приходит из карточки WooCommerce»:
// обращений к Woo в репозитории нет, база берётся в OrderBuilder.js:18 из config.prices.form.
// Поэтому настройка цен изделия по плотностям обязана быть здесь, иначе плотности настраиваются,
// а платить за них нечем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTshirtAdmin, visibleDensities, visibleTypes } from '../src/js/tshirt/AdminOverrides.js';

const базовый = {
  densities: [{ g: 160, label: '160 г — летняя' }, { g: 180, label: '180 г — базовая' }],
  prices: { form: { base: { 160: 550, 180: 600 } }, print: { methods: {} }, text: {} },
  forms: [
    { id: 'w', type: 'base', typeLabel: 'Короткий рукав', colorId: 'white', color: 'Белый', images: { front: 'a.png' } },
    { id: 'o', type: 'oversize', typeLabel: 'Оверсайз', colorId: 'white', color: 'Белый', images: { front: 'b.png' } },
  ],
  colors: [{ id: 'white', name: 'Белый', hex: '#fff' }],
};

test('плотности из админки заменяют базовые', () => {
  const out = applyTshirtAdmin(базовый, { densities: [{ g: 220, label: '220 г — оптимальная' }] });
  assert.deepEqual(out.densities.map(d => d.g), [220]);
});

test('битые плотности игнорируются целиком — конструктор остаётся на базовом списке', () => {
  const out = applyTshirtAdmin(базовый, { densities: [{ g: 'много', label: 'ой' }] });
  assert.deepEqual(out.densities.map(d => d.g), [160, 180]);
});

test('пустой список плотностей не обнуляет каталог', () => {
  const out = applyTshirtAdmin(базовый, { densities: [] });
  assert.deepEqual(out.densities.map(d => d.g), [160, 180]);
});

// Скрытая плотность остаётся в каталоге (цена по ней уже могла уйти в заказ),
// но покупателю кнопку не показываем.
test('скрытая плотность не показывается покупателю, но из каталога не исчезает', () => {
  const out = applyTshirtAdmin(базовый, {
    densities: [{ g: 160, label: '160 г — летняя', hidden: true }, { g: 180, label: '180 г — базовая' }]
  });
  assert.equal(out.densities.length, 2, 'каталог сохраняется целиком');
  assert.deepEqual(visibleDensities(out).map(d => d.g), [180]);
});

test('цены изделия по плотностям настраиваются из админки', () => {
  const out = applyTshirtAdmin(базовый, { prices: { form: { base: { 160: 700, 180: 750 } } } });
  assert.equal(out.prices.form.base[160], 700);
  assert.equal(out.prices.form.base[180], 750);
});

test('битая цена изделия игнорируется, прежняя матрица цела', () => {
  const out = applyTshirtAdmin(базовый, { prices: { form: { base: { 160: 'дорого' } } } });
  assert.equal(out.prices.form.base[160], 550);
});

test('подпись фасона правится из админки: «Короткий рукав» становится «Базовой»', () => {
  const out = applyTshirtAdmin(базовый, { formTypes: [{ id: 'base', label: 'Базовая' }] });
  assert.deepEqual(visibleTypes(out).find(t => t.value === 'base').label, 'Базовая');
});

test('фасон можно скрыть из видимости, не удаляя изделия', () => {
  const out = applyTshirtAdmin(базовый, { formTypes: [{ id: 'oversize', label: 'Оверсайз', hidden: true }] });
  const виден = visibleTypes(out).map(t => t.value);
  assert.deepEqual(виден, ['base']);
  assert.equal(out.forms.length, 2, 'сами изделия остаются в каталоге');
});

// Третья кнопка появляется сама, как только в каталоге есть изделие такого фасона.
test('третий фасон «Длинный рукав» появляется вместе с изделием', () => {
  const сДлинным = {
    ...базовый,
    forms: [...базовый.forms, { id: 'l', type: 'long', typeLabel: 'Длинный рукав', colorId: 'white', color: 'Белый', images: { front: 'c.png' } }],
  };
  const out = applyTshirtAdmin(сДлинным, { formTypes: [{ id: 'long', label: 'Длинный рукав' }] });
  assert.deepEqual(visibleTypes(out).map(t => t.value), ['base', 'oversize', 'long']);
});

test('базовый конфиг не мутируется', () => {
  const копия = JSON.parse(JSON.stringify(базовый));
  applyTshirtAdmin(базовый, { densities: [{ g: 300, label: '300 г' }], formTypes: [{ id: 'base', label: 'Иное', hidden: true }] });
  assert.deepEqual(базовый, копия);
});

test('без настроек видимые списки совпадают с каталогом', () => {
  const out = applyTshirtAdmin(базовый, {});
  assert.deepEqual(visibleDensities(out).map(d => d.g), [160, 180]);
  assert.deepEqual(visibleTypes(out).map(t => t.value), ['base', 'oversize']);
});

// Страховка от пустого экрана: спрятать ВСЕ фасоны нельзя — покупателю не из чего выбирать.
test('если скрыты все фасоны, показываем каталог как есть', () => {
  const out = applyTshirtAdmin(базовый, {
    formTypes: [{ id: 'base', hidden: true }, { id: 'oversize', hidden: true }]
  });
  assert.equal(visibleTypes(out).length, 2, 'полностью пустой переключатель недопустим');
});

test('если скрыты все плотности, показываем список как есть', () => {
  const out = applyTshirtAdmin(базовый, {
    densities: [{ g: 160, label: 'a', hidden: true }, { g: 180, label: 'b', hidden: true }]
  });
  assert.equal(visibleDensities(out).length, 2);
});
