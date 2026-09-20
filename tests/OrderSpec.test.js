// Спецификация заказа футболки для сервера.
//
// Клиент хочет, чтобы покупатель мог КУПИТЬ футболку. Сейчас кнопка «Оформить заказ» не делает
// ничего (TshirtApp.js:546 — ни одного обработчика), заказ никуда не уходит.
//
// Делаем по образцу конструктора ФОРМЫ: скрытая форма POST уходит в `?add-to-cart=<товар>`,
// а цену пересчитывает СЕРВЕР. Главное правило оттуда (jetron-orders.php:13-15): присланное
// браузером число НИКОГДА не становится ценой — иначе покупатель подменит сумму в браузере
// и купит футболку за рубль. Число сохраняется рядом только для сверки.
//
// Поэтому серверу нужна не цена, а ИСХОДНЫЕ ДАННЫЕ: фасон, плотность, возраст (он задаёт рамку
// 40×50 или 30×40), размеры принтов в сантиметрах, число надписей и количество футболок.
// Всё ценовое сервер берёт из своего конфига.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSpec } from '../src/js/tshirt/OrderSpec.js';

const заказ = {
  product: { type: 'base', typeLabel: 'Базовая', color: 'Белый', colorId: 'white', densityG: 180, age: 'adult' },
  method: 'dtf', methodLabel: 'DTF', hasPrint: true,
  sides: {
    front: { prints: [{ src: 'data:image/png;base64,AAAA', cm: { w: 20, h: 25 }, price: 800 }], texts: [{ text: 'Смирнов', color: '#111', fontId: 'russo', fontName: 'Russo One', price: 250 }] },
    back: { prints: [], texts: [] },
  },
  price: { base: 600, prints: 800, texts: 250, total: 1650 },
};

test('в спецификацию идут исходные данные, а не цены', () => {
  const s = orderSpec(заказ, { quantity: 1 });
  assert.equal(s.type, 'base');
  assert.equal(s.densityG, 180);
  assert.equal(s.age, 'adult');
  assert.equal(s.colorId, 'white');
  assert.equal(s.quantity, 1);
  assert.equal(s.total, undefined, 'цену сервер считает сам, в спецификации её быть не должно');
  assert.equal(s.price, undefined);
});

test('принты описаны сантиметрами — по ним сервер берёт ступень тарифа', () => {
  const s = orderSpec(заказ, { quantity: 1 });
  assert.deepEqual(s.sides.front.prints, [{ wCm: 20, hCm: 25 }]);
  assert.deepEqual(s.sides.back.prints, []);
});

// Картинка в спецификацию не идёт: принты почти всегда data-URL (PrintEditor обрезает поля
// и перезаписывает src), и base64 раздул бы POST до сотен килобайт. Менеджер увидит макет
// отдельным PNG, как в конструкторе формы.
test('тяжёлые картинки в спецификацию не попадают', () => {
  const s = orderSpec(заказ, { quantity: 1 });
  assert.equal(JSON.stringify(s).includes('base64'), false);
  assert.ok(JSON.stringify(s).length < 600, 'спецификация должна остаться компактной');
});

test('надписи считаются числом — цена одинакова независимо от текста', () => {
  const s = orderSpec(заказ, { quantity: 1 });
  assert.equal(s.sides.front.texts, 1);
  assert.equal(s.sides.back.texts, 0);
});

test('метод нанесения передаётся, но сервер обязан вывести его сам', () => {
  const s = orderSpec(заказ, { quantity: 1 });
  assert.equal(s.method, 'dtf');
  assert.equal(s.hasPrint, true);
});

test('количество меньше единицы поднимается до единицы', () => {
  assert.equal(orderSpec(заказ, { quantity: 0 }).quantity, 1);
  assert.equal(orderSpec(заказ, { quantity: -5 }).quantity, 1);
  assert.equal(orderSpec(заказ, {}).quantity, 1);
});

// Потолок — страховка от случайного заказа на миллион: у формы такой же приём (MAX по цене).
test('количество ограничено сверху разумным числом', () => {
  const s = orderSpec(заказ, { quantity: 100000 });
  assert.ok(s.quantity <= 1000, 'непомерное количество должно обрезаться');
});

test('дробное количество округляется вниз до целого', () => {
  assert.equal(orderSpec(заказ, { quantity: 3.7 }).quantity, 3);
});

test('детская футболка отмечается возрастом — от него зависит рамка печати', () => {
  const детский = { ...заказ, product: { ...заказ.product, age: 'child' } };
  assert.equal(orderSpec(детский, { quantity: 1 }).age, 'child');
});

test('незнакомый возраст приводится к взрослому', () => {
  const кривой = { ...заказ, product: { ...заказ.product, age: 'взрослый' } };
  assert.equal(orderSpec(кривой, { quantity: 1 }).age, 'adult');
});

test('пустой заказ не роняет сборку', () => {
  const пустой = { product: {}, sides: { front: { prints: [], texts: [] }, back: { prints: [], texts: [] } }, price: {} };
  const s = orderSpec(пустой, { quantity: 1 });
  assert.equal(s.quantity, 1);
  assert.deepEqual(s.sides.front.prints, []);
});

// Человекочитаемый текст — для менеджера в корзине и в письме заказа.
test('текст спецификации перечисляет состав понятными словами', () => {
  const { specText } = orderSpec(заказ, { quantity: 2, withText: true });
  assert.match(specText, /Базовая/);
  assert.match(specText, /180/);
  assert.match(specText, /Белый/);
  assert.match(specText, /Смирнов/);
  assert.match(specText, /20×25/);
  assert.match(specText, /2 шт/);
});
