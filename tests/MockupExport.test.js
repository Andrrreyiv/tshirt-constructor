import test from 'node:test';
import assert from 'node:assert/strict';
import { sidesToExport } from '../src/js/tshirt/MockupExport.js';

const SIDES = [{ id: 'front' }, { id: 'back' }];
const only = (...ids) => (id) => ids.includes(id);

test('принт только на груди — в макет уходит только грудь', () => {
  assert.deepEqual(sidesToExport(SIDES, only('front'), 'front').map(s => s.id), ['front']);
});

test('принт только на спине — только спина, даже если открыта грудь', () => {
  assert.deepEqual(sidesToExport(SIDES, only('back'), 'front').map(s => s.id), ['back']);
});

test('принты с обеих сторон — обе, в исходном порядке', () => {
  assert.deepEqual(sidesToExport(SIDES, only('front', 'back'), 'back').map(s => s.id), ['front', 'back']);
});

test('пусто везде — активная сторона, кнопка не должна молчать', () => {
  assert.deepEqual(sidesToExport(SIDES, () => false, 'back').map(s => s.id), ['back']);
  assert.deepEqual(sidesToExport(SIDES, () => false, 'нет такой').map(s => s.id), ['front'], 'запасной вариант — первая');
});

test('мусор на входе не роняет', () => {
  assert.deepEqual(sidesToExport([], () => true, 'front'), []);
  assert.deepEqual(sidesToExport(null, () => true, 'front'), []);
  const throwing = () => { throw new Error('слои недоступны'); };
  assert.deepEqual(sidesToExport(SIDES, throwing, 'back').map(s => s.id), ['back'], 'сбой проверки = сторона считается пустой');
});
