// Шрифт надписи: ТЗ п.69 (покупатель выбирает шрифт) и п.109 (шрифт уходит в заказ).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildOrder } from '../src/js/tshirt/OrderBuilder.js';
import { StepPrice } from '../src/js/tshirt/StepPrice.js';
import { TextPrice } from '../src/js/tshirt/TextPrice.js';
import { applyTshirtAdmin } from '../src/js/tshirt/AdminOverrides.js';
import { LayerManager } from '../src/js/tshirt/LayerManager.js';

const config = {
  sides: [{ id: 'front', label: 'Грудь' }, { id: 'back', label: 'Спина' }],
  fonts: [
    { id: 'russoone', name: 'Russo One', file: 'assets/fonts/RussoOne.ttf' },
    { id: 'oswald', name: 'Oswald', file: 'assets/fonts/Oswald.ttf' },
  ],
  colors: [{ id: 'white', name: 'Белый', hex: '#fff', note: 'Белый — контрастный фон.' }],
  forms: [{ id: 'f1', type: 'base', typeLabel: 'Короткий рукав', colorId: 'white', color: 'Белый', images: { front: 'a.png', back: 'b.png' } }],
  prices: {
    form: { base: { 180: 600 } },
    print: { method: 'dtf', rule: 'min-containing', methods: { dtf: { label: 'DTF', tiers: [{ wCm: 40, hCm: 50, price: 1250 }] } } },
    text: { standalone: 500, combinedDiscountPct: 50 },
  },
};

const state = { type: 'base', colorId: 'white', densityG: 180, age: 'adult', printMethod: 'dtf' };

function orderWith(layersBySide) {
  const layers = new LayerManager(2);
  for (const [side, list] of Object.entries(layersBySide)) {
    for (const d of list) layers.add(side, d);
  }
  return buildOrder({
    config, state, layers, scalers: {},
    priceCalc: new StepPrice(config.prices.print),
    textPrice: new TextPrice(config.prices.text),
  });
}

test('шрифт надписи попадает в заказ: id и человекочитаемое имя', () => {
  const order = orderWith({
    front: [{ kind: 'text', text: 'JETRON', color: '#111', fontId: 'oswald' }],
  });
  const t = order.sides.front.texts[0];
  assert.equal(t.fontId, 'oswald');
  assert.equal(t.fontName, 'Oswald');
  assert.equal(t.text, 'JETRON');
});

test('надпись без выбранного шрифта не ломает заказ', () => {
  const order = orderWith({ front: [{ kind: 'text', text: 'Без шрифта', color: '#111' }] });
  const t = order.sides.front.texts[0];
  assert.equal(t.fontId, null);
  assert.equal(t.fontName, null);
});

test('неизвестный id шрифта не выдумывает имя', () => {
  const order = orderWith({ front: [{ kind: 'text', text: 'X', color: '#111', fontId: 'нет-такого' }] });
  const t = order.sides.front.texts[0];
  assert.equal(t.fontId, 'нет-такого');
  assert.equal(t.fontName, null);
});

test('пояснение к цвету выживает, когда админка переписывает цвета без него', () => {
  const out = applyTshirtAdmin(config, {
    colors: [{ id: 'white', name: 'Белый', hex: '#f4f5f7' }],
  });
  assert.equal(out.colors[0].note, 'Белый — контрастный фон.');
});

test('своё пояснение из админки перебивает базовое', () => {
  const out = applyTshirtAdmin(config, {
    colors: [{ id: 'white', name: 'Белый', hex: '#f4f5f7', note: 'Свой текст' }],
  });
  assert.equal(out.colors[0].note, 'Свой текст');
});

test('новый цвет из админки остаётся без пояснения, а не с пустым', () => {
  const out = applyTshirtAdmin(config, {
    colors: [{ id: 'red', name: 'Красный', hex: '#e00' }],
  });
  assert.equal('note' in out.colors[0], false);
});
