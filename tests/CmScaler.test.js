// CmScaler — перевод «доля рамки → см» (U5, рамка = физическая зона 40×50).
// Рамка представляет физическую область печати, поэтому доля стороны принта
// от стороны рамки × размер рамки в см = реальный размер (независимо от зума экрана).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CmScaler } from '../src/js/tshirt/CmScaler.js';

const zone = { box: { x: 0.3, y: 0.26, w: 0.4, h: 0.34 }, cm: { w: 40, h: 50 } };
const canvas = { width: 1200, height: 1200 };
const printSize = { minCm: { w: 5, h: 5 }, maxCm: { w: 40, h: 50 } };

test('доля 1×1 = вся рамка → 40×50 см', () => {
  const s = new CmScaler(zone, canvas, printSize);
  assert.deepEqual(s.sizeCm(1, 1), { w: 40, h: 50 });
});

test('доля 0.5×0.5 → 20×25 см', () => {
  const s = new CmScaler(zone, canvas, printSize);
  assert.deepEqual(s.sizeCm(0.5, 0.5), { w: 20, h: 25 });
});

test('clampCm ниже минимума поднимает до 5×5', () => {
  const s = new CmScaler(zone, canvas, printSize);
  assert.deepEqual(s.clampCm({ w: 3, h: 2 }), { w: 5, h: 5 });
});

test('clampCm выше максимума опускает до 40×50', () => {
  const s = new CmScaler(zone, canvas, printSize);
  assert.deepEqual(s.clampCm({ w: 55, h: 60 }), { w: 40, h: 50 });
});

test('clampCm внутри диапазона не меняет размер', () => {
  const s = new CmScaler(zone, canvas, printSize);
  assert.deepEqual(s.clampCm({ w: 20, h: 30 }), { w: 20, h: 30 });
});
