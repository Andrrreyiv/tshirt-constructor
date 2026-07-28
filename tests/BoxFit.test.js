import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBoxInFrame } from '../src/js/tshirt/BoxFit.js';

// Главный кейс клиента: принт стоит по центру и его тянут на всю зону.
// Раньше ширина упиралась в остаток справа — до края было не дотянуть.
test('принт можно растянуть на всю зону: край упёрся — рамка сдвигается внутрь', () => {
  const r = fitBoxInFrame({ fx: 0.075, fy: 0, fw: 1, fh: 1 });
  assert.deepEqual(r, { fx: 0, fy: 0, fw: 1, fh: 1 });
});

test('пока принт помещается, положение не трогаем', () => {
  const r = fitBoxInFrame({ fx: 0.2, fy: 0.1, fw: 0.5, fh: 0.4 });
  assert.deepEqual(r, { fx: 0.2, fy: 0.1, fw: 0.5, fh: 0.4 });
});

// Размер больше зоны физически невозможен — печатать не на чем.
test('размер больше зоны обрезается до зоны', () => {
  const r = fitBoxInFrame({ fx: 0.3, fy: 0.3, fw: 1.6, fh: 2 });
  assert.deepEqual(r, { fx: 0, fy: 0, fw: 1, fh: 1 });
});

// Правый и нижний край: сдвиг ровно настолько, чтобы принт влез, не больше.
test('сдвиг минимальный — принт прижимается к краю, а не улетает', () => {
  assert.deepEqual(fitBoxInFrame({ fx: 0.8, fy: 0.9, fw: 0.5, fh: 0.3 }),
    { fx: 0.5, fy: 0.7, fw: 0.5, fh: 0.3 });
});

// Отрицательные координаты приходят при перетаскивании к левому/верхнему краю.
test('за левый и верхний край не выпускаем', () => {
  assert.deepEqual(fitBoxInFrame({ fx: -0.2, fy: -0.1, fw: 0.4, fh: 0.4 }),
    { fx: 0, fy: 0, fw: 0.4, fh: 0.4 });
});
