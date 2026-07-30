import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyTshirtAdmin, applyPrintsOverride, applyZonesOverride } from '../src/js/tshirt/AdminOverrides.js';

const base = JSON.parse(readFileSync(fileURLToPath(new URL('../src/config/tshirt-mock-config.json', import.meta.url)), 'utf8'));
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../src/config/prints-manifest.json', import.meta.url)), 'utf8'));

test('пустые настройки ничего не меняют', () => {
  const r = applyTshirtAdmin(base, null);
  assert.equal(r.prices.text.standalone, base.prices.text.standalone);
  assert.equal(r.colors.length, base.colors.length);
});

// Владелец правит ступенчатый прайс печати: тарифы заменяются целиком по методу.
test('тарифы печати заменяются по методу', () => {
  const tiers = [{ wCm: 10, hCm: 10, price: 450 }, { wCm: 40, hCm: 50, price: 1400 }];
  const r = applyTshirtAdmin(base, { prices: { print: { methods: { dtf: { tiers } } } } });
  assert.deepEqual(r.prices.print.methods.dtf.tiers, tiers);
  assert.deepEqual(r.prices.print.methods.film.tiers, base.prices.print.methods.film.tiers);
});

test('битые тарифы игнорируются, прайс не ломается', () => {
  const r = applyTshirtAdmin(base, { prices: { print: { methods: { dtf: { tiers: [{ wCm: 0, hCm: 10, price: -5 }] } } } } });
  assert.deepEqual(r.prices.print.methods.dtf.tiers, base.prices.print.methods.dtf.tiers);
});

test('цена надписи и скидка перекрываются числами', () => {
  const r = applyTshirtAdmin(base, { prices: { text: { standalone: 700, combinedDiscountPct: 30 } } });
  assert.equal(r.prices.text.standalone, 700);
  assert.equal(r.prices.text.combinedDiscountPct, 30);
});

test('мусор вместо цены надписи игнорируется', () => {
  const r = applyTshirtAdmin(base, { prices: { text: { standalone: 'дорого' } } });
  assert.equal(r.prices.text.standalone, base.prices.text.standalone);
});

// Цвета и мокапы: пустой список означает «не трогай», а не «удали всё».
test('цвета и изделия заменяются списком, пустой список игнорируется', () => {
  const colors = [{ id: 'red', name: 'Красный', hex: '#e00', mode: 'photo' }];
  const r = applyTshirtAdmin(base, { colors, forms: [] });
  assert.deepEqual(r.colors, colors);
  assert.equal(r.forms.length, base.forms.length);
});

test('изделие без картинки в каталог не попадает', () => {
  const r = applyTshirtAdmin(base, { forms: [{ id: 'x', type: 'base', colorId: 'red', color: 'Красный' }] });
  assert.deepEqual(r.forms, base.forms);
});

test('базовый конфиг не мутируется', () => {
  const было = base.prices.text.standalone;
  applyTshirtAdmin(base, { prices: { text: { standalone: 999 } } });
  assert.equal(base.prices.text.standalone, было);
});

// Библиотека принтов: клиент заводит категории и грузит в них картинки.
test('категории принтов заменяются целиком', () => {
  const cats = [{ slug: 'new', label: 'Новинки', items: [{ id: 'n1', file: 'assets/prints/new/1.webp' }] }];
  const r = applyPrintsOverride(manifest, { categories: cats });
  assert.equal(r.categories.length, 1);
  assert.equal(r.categories[0].label, 'Новинки');
});

test('категория без картинок допустима, но без файла позиция выкидывается', () => {
  const r = applyPrintsOverride(manifest, { categories: [
    { slug: 'empty', label: 'Пустая', items: [] },
    { slug: 'bad', label: 'Битая', items: [{ id: 'x' }] }
  ] });
  assert.equal(r.categories.length, 2);
  assert.deepEqual(r.categories[0].items, []);
  assert.deepEqual(r.categories[1].items, []);
});

test('пустой список категорий и мусор оставляют исходную библиотеку', () => {
  assert.deepEqual(applyPrintsOverride(manifest, { categories: [] }).categories, manifest.categories);
  assert.deepEqual(applyPrintsOverride(manifest, null).categories, manifest.categories);
});

test('applyZonesOverride подменяет коробку зоны из редактора', () => {
  const config = { zoneTemplate: [
    { key: 'chest', view: 'front', box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 }, cm: { w: 40, h: 50 } },
    { key: 'backPrint', view: 'back', box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 }, cm: { w: 40, h: 50 } }
  ] };
  const out = applyZonesOverride(config, { front: { x: 0.25, y: 0.15, w: 0.5, h: 0.62 } });
  assert.deepEqual(out.zoneTemplate[0].box, { x: 0.25, y: 0.15, w: 0.5, h: 0.62 });
  assert.deepEqual(out.zoneTemplate[1].box, { x: 0.3, y: 0.2, w: 0.4, h: 0.5 }, 'спину не трогали');
  assert.equal(out.zoneTemplate[0].cm.w, 40, 'сантиметры остаются физическими');
});

test('applyZonesOverride игнорирует мусор и выход за границы', () => {
  const config = { zoneTemplate: [{ view: 'front', box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }] };
  for (const bad of [null, {}, { front: null }, { front: { x: -1, y: 0, w: 0.4, h: 0.5 } },
                     { front: { x: 0, y: 0, w: 0, h: 0.5 } }, { front: { x: 'a', y: 0, w: 0.4, h: 0.5 } }]) {
    const out = applyZonesOverride(config, bad);
    assert.deepEqual(out.zoneTemplate[0].box, { x: 0.3, y: 0.2, w: 0.4, h: 0.5 });
  }
});
