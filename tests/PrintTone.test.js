import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT, DARK, ANY, printTone, colorTone, fitsTone, filterCategories, hiddenCount,
} from '../src/js/tshirt/PrintTone.js';

// Клиент 01.08: выбрал белую футболку — принты для чёрных показывать незачем.
// Плюс третья группа, которая идёт и туда, и туда.

test('printTone: старая галочка dark продолжает работать — разметка владельца не пропадает', () => {
  assert.equal(printTone({ dark: true }), DARK);
  assert.equal(printTone({ dark: false }), LIGHT);
  assert.equal(printTone({}), LIGHT, 'без признака считаем светлым, как было раньше');
  assert.equal(printTone(null), LIGHT);
});

test('printTone: явный tone побеждает старый флаг', () => {
  assert.equal(printTone({ tone: ANY, dark: true }), ANY);
  assert.equal(printTone({ tone: LIGHT, dark: true }), LIGHT);
  assert.equal(printTone({ tone: 'мусор', dark: true }), DARK, 'непонятное значение — падаем на dark');
});

test('colorTone: реальные цвета изделия с боевого', () => {
  assert.equal(colorTone({ id: 'white', hex: '#f4f5f7' }), LIGHT);
  assert.equal(colorTone({ id: 'black', hex: '#1c1c1e' }), DARK);
  assert.equal(colorTone({ id: 'ivory', hex: '#e9dfc9' }), LIGHT, 'молочная — светлая');
});

test('colorTone: явный tone важнее яркости, мусор не роняет', () => {
  assert.equal(colorTone({ hex: '#ffffff', tone: DARK }), DARK, 'владелец вправе переопределить');
  assert.equal(colorTone({ hex: '#abc' }), LIGHT, 'короткая запись hex');
  assert.equal(colorTone({ hex: 'не-цвет' }), LIGHT);
  assert.equal(colorTone(null), LIGHT);
});

test('fitsTone: универсальный подходит обоим, остальные только своему', () => {
  assert.equal(fitsTone({ tone: ANY }, LIGHT), true);
  assert.equal(fitsTone({ tone: ANY }, DARK), true);
  assert.equal(fitsTone({ dark: true }, LIGHT), false);
  assert.equal(fitsTone({ dark: true }, DARK), true);
  assert.equal(fitsTone({ dark: false }, LIGHT), true);
  assert.equal(fitsTone({ dark: false }, DARK), false);
});

test('filterCategories: пустые категории выбрасываются, исходник не меняется', () => {
  const cats = [
    { slug: 'a', label: 'A', items: [{ id: 1, dark: true }, { id: 2, tone: ANY }] },
    { slug: 'b', label: 'B', items: [{ id: 3, dark: true }] },       // только тёмные
    { slug: 'c', label: 'C', items: [] },
  ];
  const light = filterCategories(cats, LIGHT);
  assert.deepEqual(light.map(c => c.slug), ['a'], 'категория из одних тёмных ушла целиком');
  assert.deepEqual(light[0].items.map(i => i.id), [2]);

  const dark = filterCategories(cats, DARK);
  assert.deepEqual(dark.map(c => c.slug), ['a', 'b']);
  assert.deepEqual(dark[0].items.map(i => i.id), [1, 2], 'универсальный виден и на тёмной');

  assert.equal(cats[0].items.length, 2, 'исходный массив не мутирован');
});

test('hiddenCount: сколько картинок спрятано — для ссылки «показать остальные»', () => {
  const cats = [
    { slug: 'a', items: [{ dark: true }, { tone: ANY }, { dark: false }] },
    { slug: 'b', items: [{ dark: true }] },
  ];
  assert.equal(hiddenCount(cats, LIGHT), 2, 'два тёмных скрыты');
  assert.equal(hiddenCount(cats, DARK), 1, 'один светлый скрыт');
  assert.equal(hiddenCount([], LIGHT), 0);
});
