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
