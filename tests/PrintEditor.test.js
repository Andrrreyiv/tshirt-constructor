// PrintEditor — часть, которую можно проверить без браузера.
// Клиент 25.08: «я меняю шрифты, а надпись не меняется». Дескрипторы правит
// LayerManager.restyleKind, а перекрасить уже нарисованный узел обязан редактор,
// причём ПО МЕСТУ: пересборка слоёв захлопнула бы раскрытый список шрифтов.
// DOM здесь заменён заглушкой: refreshTextStyle трогает только `_el` и `style`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrintEditor, textFontFamily } from '../src/js/tshirt/PrintEditor.js';
import { LayerManager } from '../src/js/tshirt/LayerManager.js';

/** Узел-заглушка: `.pf-text__body` со своим style. */
function stubEl() {
  const body = { style: {} };
  return { body, el: { querySelector: (sel) => (sel === '.pf-text__body' ? body : null) } };
}

function editorWith(layers) {
  return new PrintEditor({
    frame: null,
    scaler: null,
    layers,
    getSide: () => 'front',
    getMethod: () => 'dtf',
    onChange: () => {},
  });
}

test('refreshTextStyle применяет новый шрифт к уже нарисованной надписи', () => {
  const layers = new LayerManager(2);
  const { body, el } = stubEl();
  layers.add('front', { id: 't1', kind: 'text', text: 'Маша', color: '#111', fontId: 'oswald', _el: el });
  const editor = editorWith(layers);

  layers.restyleKind('text', { fontId: 'russoone' });
  editor.refreshTextStyle();

  assert.equal(body.style.fontFamily, textFontFamily('russoone'));
});

test('refreshTextStyle применяет новый цвет к уже нарисованной надписи', () => {
  const layers = new LayerManager(2);
  const { body, el } = stubEl();
  layers.add('front', { id: 't1', kind: 'text', text: 'Маша', color: '#111', fontId: 'oswald', _el: el });
  const editor = editorWith(layers);

  layers.restyleKind('text', { color: '#e11d48' });
  editor.refreshTextStyle();

  assert.equal(body.style.color, '#e11d48');
  assert.equal(body.style.fontFamily, textFontFamily('oswald'));
});

// Клиент 26.08: «на футболке удаляю смирнов, а в поле текст слово смирнов остаётся».
// Редактор не знает про поле ввода, поэтому обязан доложить наверх, ЧТО именно убрали.
test('крестик снимает слой и докладывает наверх, какой именно', () => {
  const layers = new LayerManager(2);
  const d = { id: 't1', kind: 'text', text: 'Смирнов' };
  layers.add('front', d);

  const removed = [];
  let repriced = 0;
  const editor = new PrintEditor({
    frame: null, scaler: null, layers,
    getSide: () => 'front', getMethod: () => 'dtf',
    onChange: () => { repriced += 1; },
    onRemove: (x) => removed.push(x),
  });

  let unmounted = 0;
  editor._deleteLayer(d, { remove: () => { unmounted += 1; } });

  assert.deepEqual(layers.list('front'), [], 'дескриптор убран');
  assert.equal(unmounted, 1, 'узел снят со сцены');
  assert.deepEqual(removed, [d], 'наверх ушёл сам дескриптор');
  assert.equal(repriced, 1, 'цена пересчитана');
});
