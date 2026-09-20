// Дефект клиента 25.08: «я меняю шрифты, а надпись не меняется. То есть я только
// изначально, когда выбрал шрифт, он тем шрифтом и написал. А дальше уже другим
// я не могу поменять».
//
// Шрифт и цвет лежат в дескрипторе слоя и записывались ОДИН раз, при создании.
// render() пересобирает слои из тех же дескрипторов, поэтому смена шрифта в панели
// физически не могла дойти до готовой надписи. Здесь проверяется связка в TshirtApp:
// дескрипторы обеих сторон обновлены и живые узлы перекрашены.
//
// DOM не нужен: restyleTextLayers трогает только LayerManager и редакторы сторон,
// поэтому редакторы заменены заглушками, а сам app собран через Object.create —
// конструктор TshirtApp требует узлов страницы, а к этой логике они отношения не имеют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TshirtApp } from '../src/js/ui/TshirtApp.js';
import { LayerManager } from '../src/js/tshirt/LayerManager.js';
import { PanelAccordion } from '../src/js/ui/PanelAccordion.js';
import { readFileSync } from 'node:fs';

function appWithText() {
  const app = Object.create(TshirtApp.prototype);
  app.layers = new LayerManager(2);
  app.state = { side: 'front', fontId: 'oswald', textColor: '#111111' };
  // Поле шрифтов теперь регистрируется в аккордеоне (замечание клиента 26.08),
  // поэтому заглушке app нужны те же два поля, что заводит конструктор.
  app.panels = new PanelAccordion();
  app.panelRefs = {};
  const refreshed = [];
  app.editors = {
    front: { refreshTextStyle: () => refreshed.push('front') },
    back: { refreshTextStyle: () => refreshed.push('back') },
  };
  const front = { id: 't1', kind: 'text', text: 'Маша, я тебя люблю', fontId: 'oswald', color: '#111111' };
  const back = { id: 't2', kind: 'text', text: 'Спина', fontId: 'oswald', color: '#111111' };
  app.layers.add('front', front);
  app.layers.add('back', back);
  return { app, front, back, refreshed };
}

test('смена шрифта догоняет уже набранную надпись на обеих сторонах', () => {
  const { app, front, back } = appWithText();
  app.restyleTextLayers({ fontId: 'russoone' });
  assert.equal(front.fontId, 'russoone');
  assert.equal(back.fontId, 'russoone');
});

// Пикер цвета шлёт input непрерывно, пока его тянут. Перерисовать панель нельзя —
// пикер закроется под рукой, поэтому узлы обновляются по месту через редакторы сторон.
test('смена оформления перекрашивает живые узлы через редакторы сторон', () => {
  const { app, refreshed } = appWithText();
  app.restyleTextLayers({ color: '#e11d48' });
  assert.deepEqual(refreshed.sort(), ['back', 'front']);
});

// ── Связка панели ────────────────────────────────────────────────────────────
// Метода мало: клиент жал КНОПКУ ШРИФТА, и именно её обработчик надпись не трогал.
// Поэтому проверяем сам обработчик. Полноценный DOM для этого не нужен — fontList()
// умеет только создавать узлы, вешать слушателей и писать style, что и даёт заглушка.
function stubDocument() {
  const make = (tag) => ({
    tagName: tag, className: '', textContent: '', style: {}, children: [], on: {},
    append(...kids) { this.children.push(...kids); },
    setAttribute(k, v) { this[k] = v; },
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); },
    click() { for (const fn of this.on.click ?? []) fn({}); },
    querySelectorAll(sel) { return collectByClass(this, sel.replace(/^\./, '')); },
  });
  return { createElement: make, createTextNode: (t) => ({ text: t }) };
}

test('клик по кнопке шрифта меняет шрифт УЖЕ набранной надписи', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app, front } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }, { id: 'russoone', name: 'Russo One' }] };
    app.render = () => {}; // перерисовку сцены здесь не проверяем

    const list = app.fontList();
    list.children[1].click(); // вторая кнопка = Russo One

    assert.equal(app.state.fontId, 'russoone');
    assert.equal(front.fontId, 'russoone', 'надпись осталась на старом шрифте');
  } finally {
    globalThis.document = prev;
  }
});

// У цвета ровно тот же дефект: он тоже писался в дескриптор только при создании слоя.
// Клиент про цвет пока не жаловался, но это одна и та же дырка, лечим сразу.
test('пикер цвета перекрашивает УЖЕ набранную надпись', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app, front, refreshed } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    app.render = () => {};

    const field = app.textField();
    const picker = findByClass(field, 'text-opts__picker');
    assert.ok(picker, 'пикер цвета не найден в панели');
    picker.value = '#e11d48';
    for (const fn of picker.on.input ?? []) fn({});

    assert.equal(app.state.textColor, '#e11d48');
    assert.equal(front.color, '#e11d48', 'надпись осталась старого цвета');
    assert.ok(refreshed.length > 0, 'живые узлы не перекрашены');
  } finally {
    globalThis.document = prev;
  }
});

// Маленькие превью сторон и цена собираются в renderPanel, а не в живых узлах сцены.
// Пока пикер тянут, перерисовывать нельзя, поэтому догоняем их на закрытии пикера.
test('закрытие пикера цвета перерисовывает панель (превью сторон и цена)', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    let renders = 0;
    app.render = () => { renders++; };

    const picker = findByClass(app.textField(), 'text-opts__picker');
    picker.value = '#e11d48';
    for (const fn of picker.on.input ?? []) fn({});
    assert.equal(renders, 0, 'перерисовка во время тяги закрыла бы пикер');

    for (const fn of picker.on.change ?? []) fn({});
    assert.equal(renders, 1);
  } finally {
    globalThis.document = prev;
  }
});

// ── Две кнопки «Шрифт» и «Цвет» вместо бейджа (клиент 20.09) ──────────────────────────
// Голосом о двух вещах сразу: «можете эти кнопки в конструктор футболок добавить» (те же,
// что сделаны в конструкторе формы) и «где поле добавить текст, как-то его выделить,
// а то его по факту нет». Вёрстку тесты не стерегут, поэтому здесь — разметка и то
// правило CSS, потеря которого оставляет обе панели раскрытыми.
test('под полем надписи стоят две кнопки, бейджа больше нет', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }, { id: 'rpl', name: 'РПЛ' }] };
    app.render = () => {};

    const field = app.textField();
    const кнопки = collectByClass(field, 'text-fc__btn');
    assert.equal(кнопки.length, 2, 'кнопок «Шрифт» и «Цвет» должно быть ровно две');
    assert.equal(findByClass(field, 'text-badge'), null, 'вернулся прежний бейдж «Шрифт и цвет»');

    const имя = findByClass(field, 'text-fc__val');
    assert.equal(имя.textContent, 'Oswald', 'на кнопке обязано стоять имя текущего шрифта');
    const кружок = findByClass(field, 'text-fc__dot');
    assert.equal(кружок.style.background, '#111111', 'кружок обязан показывать текущий цвет');
  } finally {
    globalThis.document = prev;
  }
});

// Открыта всегда ровно одна панель: иначе поле вырастает вдвое, а клиент просил обратного.
test('кнопки раскрывают по одной панели и закрываются повторным нажатием', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    app.render = () => {};

    const field = app.textField();
    const [шрифт, цвет] = collectByClass(field, 'text-fc__btn');
    const список = findByClass(field, 'font-list');
    const цветРяд = findByClass(field, 'text-opts__color');
    assert.ok(список && цветРяд);

    // Старт: всё свёрнуто.
    assert.equal(список.hidden, true);
    assert.equal(цветРяд.hidden, true);

    шрифт.click();
    assert.equal(список.hidden, false, 'список шрифтов не раскрылся');
    assert.equal(цветРяд.hidden, true, 'цвет обязан оставаться скрытым');

    цвет.click();
    assert.equal(список.hidden, true, 'список шрифтов обязан закрыться');
    assert.equal(цветРяд.hidden, false, 'палитра цвета не раскрылась');

    цвет.click();
    assert.equal(цветРяд.hidden, true, 'повторное нажатие обязано закрывать');
    assert.equal(app.panels.isOpen('text'), false, 'аккордеон остался открытым');
  } finally {
    globalThis.document = prev;
  }
});

// Клиент 20.09 дословно: «а где поле добавить текст, как-то его выделить, а то его по факту
// нет». Так и было: у соседнего ряда живая кнопка «Добавить принт», а весь текстовый блок
// держался на СЕРОЙ ПОДСКАЗКЕ внутри поля — видимого текста в ряду не было вовсе.
test('«Добавить текст» — живая подпись в ряду, а не только подсказка в поле', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    app.render = () => {};

    const field = app.textField();
    const подпись = findByClass(field, 'design-row__caption');
    assert.ok(подпись, 'подпись «Добавить текст» пропала из ряда');
    assert.equal(подпись.textContent, 'Добавить текст');

    const поле = findByClass(field, 'design-row__input');
    assert.notEqual(поле.placeholder, 'Добавить текст',
      'подсказка обязана показывать пример, а не дублировать подпись');
  } finally {
    globalThis.document = prev;
  }
});

// Поле ввода было прозрачным и читалось как подпись — клиент его «по факту» не видел.
// ⚠️ И гашение панелей: `display: flex` перебивает атрибут hidden, без правила обе видны.
test('CSS: поле надписи выделено рамкой, скрытые панели действительно скрыты', () => {
  const css = readFileSync(new URL('../src/css/app.css', import.meta.url), 'utf8');
  const поле = css.match(/^\.design-row__input \{([^}]*)\}/m); // ^ — иначе цепляет медиа-правило
  assert.ok(поле, 'правило .design-row__input пропало');
  assert.match(поле[1], /border: 1\.5px solid/, 'поле снова без рамки — его не видно');
  assert.doesNotMatch(поле[1], /background: none/, 'прозрачный фон возвращает прежний дефект');
  assert.match(css, /\.text-opts\[hidden\], \.font-list\[hidden\], \.text-opts__color\[hidden\] \{ display: none; \}/,
    'без явного гашения скрытые панели остаются на экране');
  assert.match(css, /\.text-fc__btn \{/, 'стили кнопок «Шрифт» и «Цвет» пропали');
});

/** Все узлы поддерева с данным className. */
function collectByClass(node, cls) {
  const out = [];
  for (const kid of node.children ?? []) {
    if (kid && kid.className === cls) out.push(kid);
    out.push(...collectByClass(kid, cls));
  }
  return out;
}

/** Обход дерева заглушек: нужен узел по className. */
function findByClass(node, cls) {
  if (!node || typeof node !== 'object') return null;
  if (node.className === cls) return node;
  for (const kid of node.children ?? []) {
    const hit = findByClass(kid, cls);
    if (hit) return hit;
  }
  return null;
}
