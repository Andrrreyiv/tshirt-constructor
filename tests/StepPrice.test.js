// StepPrice — ступенчатая цена нанесения (U1, 22.07).
// Правило min-containing: цена = минимальный тариф, чья рамка вмещает принт (wCm≥w и hCm≥h).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StepPrice } from '../src/js/tshirt/StepPrice.js';

const cfg = {
  method: 'dtf',
  rule: 'min-containing',
  methods: {
    dtf: { label: 'DTF', tiers: [
      { wCm: 10, hCm: 10, price: 400 },
      { wCm: 15, hCm: 15, price: 550 },
      { wCm: 20, hCm: 20, price: 750 },
      { wCm: 30, hCm: 30, price: 850 },
      { wCm: 40, hCm: 40, price: 1050 },
      { wCm: 10, hCm: 15, price: 500 },
      { wCm: 15, hCm: 20, price: 700 },
      { wCm: 20, hCm: 30, price: 800 },
      { wCm: 30, hCm: 40, price: 1000 },
    ] },
    film: { label: 'Плёнкой', tiers: [
      { wCm: 10, hCm: 15, price: 400 },
      { wCm: 15, hCm: 20, price: 500 },
      { wCm: 20, hCm: 30, price: 600 },
      { wCm: 30, hCm: 40, price: 700 },
    ] },
  },
};

test('точное совпадение с самым маленьким тарифом', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(10, 10, 'dtf'), 400);
});

test('цена «замирает» в брекете 11..15', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(11, 11, 'dtf'), 550);
  assert.equal(p.price(14, 14, 'dtf'), 550);
});

test('перешагнул брекет → следующая ступень', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(16, 16, 'dtf'), 750);
});

test('min-containing: узкий высокий принт берёт дешёвый прямоугольный тариф', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(10, 15, 'dtf'), 500);
  assert.equal(p.price(12, 18, 'dtf'), 700);
});

test('метод «Плёнкой» имеет свою сетку', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(10, 15, 'film'), 400);
  assert.equal(p.price(25, 35, 'film'), 700);
});

test('принт больше всех тарифов → потолок сетки', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(40, 50, 'dtf'), 1050);
});

test('нулевой размер → 0', () => {
  const p = new StepPrice(cfg);
  assert.equal(p.price(0, 0, 'dtf'), 0);
});
