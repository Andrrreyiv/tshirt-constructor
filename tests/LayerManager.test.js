// LayerManager — принты по сторонам + z-order + потолок на сторону (C11, C15).
// Грудь/спина — раздельные наборы; максимум принтов на сторону = maxPerSide (2, ред. из админки).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LayerManager } from '../src/js/tshirt/LayerManager.js';

test('add + list возвращает принты стороны в порядке слоёв', () => {
  const m = new LayerManager(2);
  const a = { id: 'a' };
  const b = { id: 'b' };
  m.add('front', a);
  m.add('front', b);
  assert.deepEqual(m.list('front'), [a, b]);
});

test('стороны раздельны', () => {
  const m = new LayerManager(2);
  m.add('front', { id: 'a' });
  assert.equal(m.list('back').length, 0);
});

test('remove убирает принт', () => {
  const m = new LayerManager(2);
  const a = { id: 'a' };
  m.add('front', a);
  m.remove('front', a);
  assert.deepEqual(m.list('front'), []);
});

test('потолок на сторону: add сверх лимита возвращает false и не добавляет', () => {
  const m = new LayerManager(2);
  assert.equal(m.add('front', { id: 'a' }), true);
  assert.equal(m.add('front', { id: 'b' }), true);
  assert.equal(m.add('front', { id: 'c' }), false);
  assert.equal(m.list('front').length, 2);
});

test('canAdd отражает наличие места', () => {
  const m = new LayerManager(1);
  assert.equal(m.canAdd('front'), true);
  m.add('front', { id: 'a' });
  assert.equal(m.canAdd('front'), false);
});

test('moveUp поднимает принт в z-order', () => {
  const m = new LayerManager(3);
  const a = { id: 'a' };
  const b = { id: 'b' };
  m.add('front', a);
  m.add('front', b);
  m.moveUp('front', a); // a был ниже b → меняются местами
  assert.deepEqual(m.list('front'), [b, a]);
});

test('текст не занимает слот принта (потолок только для принтов)', () => {
  const m = new LayerManager(2);
  m.add('front', { id: 'p1', kind: 'print' });
  m.add('front', { id: 'p2', kind: 'print' });
  // Принтов уже 2 (потолок), но текст всё равно добавляется:
  assert.equal(m.add('front', { id: 't1', kind: 'text' }), true);
  assert.equal(m.add('front', { id: 'p3', kind: 'print' }), false); // 3-й принт — нет
  assert.equal(m.list('front').length, 3); // 2 принта + 1 текст
});

test('countKind считает принты и текст раздельно', () => {
  const m = new LayerManager(2);
  m.add('front', { id: 'p1', kind: 'print' });
  m.add('front', { id: 't1', kind: 'text' });
  m.add('front', { id: 't2', kind: 'text' });
  assert.equal(m.countKind('front', 'print'), 1);
  assert.equal(m.countKind('front', 'text'), 2);
});

test('hasKind по всем сторонам', () => {
  const m = new LayerManager(2);
  m.add('back', { id: 'p1', kind: 'print' });
  assert.equal(m.hasKind('print'), true);
  assert.equal(m.hasKind('text'), false);
});
