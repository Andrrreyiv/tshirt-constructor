import test from 'node:test';
import assert from 'node:assert/strict';
import { alignBoxToCm, deriveBox, moveBox, scaleBox } from '../src/js/tshirt/ZoneBox.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('alignBoxToCm приводит слишком широкую коробку к 4:5, центр на месте', () => {
  const box = { x: 0.26, y: 0.2, w: 0.48, h: 0.5 };  // соотношение 0.96 — как было в конфиге
  const out = alignBoxToCm(box, { w: 40, h: 50 });
  assert.ok(close(out.w / out.h, 0.8), 'соотношение стало 0.8, а не ' + out.w / out.h);
  assert.ok(close(out.h, 0.5), 'высота не изменилась');
  assert.ok(close(out.x + out.w / 2, box.x + box.w / 2), 'центр по горизонтали сохранён');
});

test('alignBoxToCm только ужимает: рамка не должна вылезти за изделие', () => {
  // 0.4x0.4 это соотношение 1.0, больше нужного 0.8 → режем ширину, высоту не растим
  const out = alignBoxToCm({ x: 0.3, y: 0.2, w: 0.4, h: 0.4 }, { w: 40, h: 50 });
  assert.ok(close(out.h, 0.4), 'высота осталась 0.4');
  assert.ok(close(out.w, 0.32), 'ширина стала 0.4 × 0.8');
  assert.ok(close(out.x + out.w / 2, 0.5), 'центр сохранён');
});

test('alignBoxToCm учитывает неквадратную подложку', () => {
  // подложка 3:4 (шире в пикселях по высоте) → доля ширины должна быть больше
  const out = alignBoxToCm({ x: 0.3, y: 0.2, w: 0.4, h: 0.4 }, { w: 40, h: 50 }, 0.75);
  assert.ok(close(out.w / out.h, 0.8 / 0.75));
});

test('alignBoxToCm не выпускает рамку за пределы мокапа', () => {
  const out = alignBoxToCm({ x: 0.9, y: 0.9, w: 0.4, h: 0.2 }, { w: 40, h: 50 });
  assert.ok(out.x >= 0 && out.y >= 0);
  assert.ok(out.x + out.w <= 1 + 1e-9);
  assert.ok(out.y + out.h <= 1 + 1e-9);
});

test('deriveBox делает детскую зону 30×40 из взрослой 40×50 от центра', () => {
  const adult = { x: 0.3, y: 0.2, w: 0.4, h: 0.5 };
  const child = deriveBox(adult, { w: 40, h: 50 }, { w: 30, h: 40 });
  assert.ok(close(child.w, 0.3), 'ширина 0.4 × 30/40');
  assert.ok(close(child.h, 0.4), 'высота 0.5 × 40/50');
  assert.ok(close(child.x + child.w / 2, adult.x + adult.w / 2));
  assert.ok(close(child.y + child.h / 2, adult.y + adult.h / 2));
});

test('moveBox упирается в края', () => {
  const box = { x: 0.3, y: 0.2, w: 0.4, h: 0.5 };
  assert.deepEqual(moveBox(box, -1, -1), { x: 0, y: 0, w: 0.4, h: 0.5 });
  assert.deepEqual(moveBox(box, 1, 1), { x: 0.6, y: 0.5, w: 0.4, h: 0.5 });
});

test('scaleBox держит пропорции и не даёт свести рамку в точку', () => {
  const box = { x: 0.2, y: 0.1, w: 0.4, h: 0.5 };
  const big = scaleBox(box, 0.6, { w: 40, h: 50 });
  assert.ok(close(big.w / big.h, 0.8));
  const tiny = scaleBox(box, 0.001, { w: 40, h: 50 });
  assert.ok(tiny.w >= 0.08);
});
