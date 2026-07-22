// OrderBuilder — сборка состояния конструктора в сериализуемый итог заказа.
// Цена в итоге считается теми же чистыми модулями (StepPrice/TextPrice), что и в UI,
// чтобы сервер/корзина могли независимо пересчитать. U1 (принт), U2 (текст-скидка), U3 (база).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder } from '../src/js/tshirt/OrderBuilder.js';
import { StepPrice } from '../src/js/tshirt/StepPrice.js';
import { TextPrice } from '../src/js/tshirt/TextPrice.js';
import { CmScaler } from '../src/js/tshirt/CmScaler.js';
import { LayerManager } from '../src/js/tshirt/LayerManager.js';

// Минимальный конфиг под текущую доменную модель.
const config = {
  sides: [{ id: 'front', label: 'Грудь' }, { id: 'back', label: 'Спина' }],
  forms: [
    { type: 'base', colorId: 'white', typeLabel: 'Базовая', color: 'Белый' },
    { type: 'oversize', colorId: 'black', typeLabel: 'Оверсайз', color: 'Чёрный' },
  ],
  prices: {
    form: { base: { '180': 600 }, oversize: { '200': 800 } },
    text: { standalone: 500, combinedDiscountPct: 50 },
    print: {
      method: 'dtf',
      methods: {
        dtf: { label: 'DTF', tiers: [ { wCm: 20, hCm: 25, price: 800 }, { wCm: 40, hCm: 50, price: 1400 } ] },
        film: { label: 'Плёнкой', tiers: [ { wCm: 20, hCm: 25, price: 600 } ] },
      },
    },
  },
  zoneTemplate: [
    { view: 'front', box: { x: 0.3, y: 0.26, w: 0.4, h: 0.34 }, cm: { w: 40, h: 50 } },
    { view: 'back', box: { x: 0.3, y: 0.2, w: 0.4, h: 0.4 }, cm: { w: 40, h: 50 } },
  ],
  printSize: { minCm: { w: 5, h: 5 }, maxCm: { w: 40, h: 50 } },
  canvas: { w: 1000, h: 1200 },
};

function makeDeps() {
  const scalers = {};
  for (const z of config.zoneTemplate) scalers[z.view] = new CmScaler(z, config.canvas, config.printSize);
  return {
    config,
    priceCalc: new StepPrice(config.prices.print),
    textPrice: new TextPrice(config.prices.text),
    scalers,
  };
}

const baseState = { type: 'base', colorId: 'white', side: 'front', age: 'adult', densityG: 180, printMethod: 'dtf' };

test('пустой дизайн — только базовая цена футболки', () => {
  const layers = new LayerManager(2);
  const deps = makeDeps();
  const order = buildOrder({ ...deps, state: baseState, layers });
  assert.equal(order.price.base, 600);
  assert.equal(order.price.prints, 0);
  assert.equal(order.price.texts, 0);
  assert.equal(order.price.total, 600);
  assert.equal(order.product.typeLabel, 'Базовая');
  assert.equal(order.product.color, 'Белый');
  assert.equal(order.method, 'dtf');
});

test('один принт 20×25 DTF → +800, размер в см в позиции', () => {
  const layers = new LayerManager(2);
  layers.add('front', { kind: 'print', src: 'a.png', fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 });
  const deps = makeDeps();
  const order = buildOrder({ ...deps, state: baseState, layers });
  assert.equal(order.price.prints, 800);
  assert.equal(order.price.total, 1400);
  assert.deepEqual(order.sides.front.prints[0].cm, { w: 20, h: 25 });
  assert.equal(order.sides.front.prints[0].price, 800);
});

test('текст без принта — полная цена 500', () => {
  const layers = new LayerManager(2);
  layers.add('front', { kind: 'text', text: 'HI', color: '#f00', fx: 0.1, fy: 0.4, fw: 0.8, fh: 0.16 });
  const deps = makeDeps();
  const order = buildOrder({ ...deps, state: baseState, layers });
  assert.equal(order.price.texts, 500);
  assert.equal(order.price.total, 1100);
  assert.equal(order.sides.front.texts[0].text, 'HI');
  assert.equal(order.sides.front.texts[0].price, 500);
});

test('текст + принт → текст со скидкой 50% (250), принт полный', () => {
  const layers = new LayerManager(2);
  layers.add('front', { kind: 'print', src: 'a.png', fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 });
  layers.add('front', { kind: 'text', text: 'CHAMPION', color: '#111', fx: 0.1, fy: 0.4, fw: 0.8, fh: 0.16 });
  const deps = makeDeps();
  const order = buildOrder({ ...deps, state: baseState, layers });
  assert.equal(order.price.prints, 800);
  assert.equal(order.price.texts, 250);
  assert.equal(order.price.total, 1650);
});

test('обе стороны учитываются в итоге', () => {
  const layers = new LayerManager(2);
  layers.add('front', { kind: 'print', src: 'a.png', fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 });
  layers.add('back', { kind: 'print', src: 'b.png', fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 });
  const deps = makeDeps();
  const order = buildOrder({ ...deps, state: baseState, layers });
  assert.equal(order.sides.front.prints.length, 1);
  assert.equal(order.sides.back.prints.length, 1);
  assert.equal(order.price.prints, 1600);
  assert.equal(order.price.total, 2200);
});

test('результат сериализуем в JSON', () => {
  const layers = new LayerManager(2);
  layers.add('front', { kind: 'text', text: 'X', color: '#000', fx: 0.1, fy: 0.4, fw: 0.8, fh: 0.16 });
  const deps = makeDeps();
  const order = buildOrder({ ...deps, state: baseState, layers });
  const round = JSON.parse(JSON.stringify(order));
  assert.equal(round.price.total, order.price.total);
});
