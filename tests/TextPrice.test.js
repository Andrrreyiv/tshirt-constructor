// TextPrice — цена текста (U2, 22.07). Текст в одиночку = standalone.
// При комбо с принтом текст получает скидку combinedDiscountPct (регулируется из админки).
// Логотип/принт всегда по полной (это к StepPrice, здесь только текст).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextPrice } from '../src/js/tshirt/TextPrice.js';

const cfg = { standalone: 500, combinedDiscountPct: 50 };

test('текст без принта — полная цена', () => {
  const p = new TextPrice(cfg);
  assert.equal(p.price(false), 500);
});

test('текст в комбо с принтом — скидка 50%', () => {
  const p = new TextPrice(cfg);
  assert.equal(p.price(true), 250);
});

test('скидка регулируется (30% → 350)', () => {
  const p = new TextPrice({ standalone: 500, combinedDiscountPct: 30 });
  assert.equal(p.price(true), 350);
});

test('нулевая базовая цена → 0', () => {
  const p = new TextPrice({ standalone: 0, combinedDiscountPct: 50 });
  assert.equal(p.price(true), 0);
  assert.equal(p.price(false), 0);
});
