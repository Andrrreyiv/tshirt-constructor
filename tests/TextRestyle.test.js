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

// У цвета ровно тот же дефект, что был у шрифта: он писался в дескриптор только при
// создании слоя. ⚠️ С 20.09 цвет выбирается ПАЛИТРОЙ, а не RGB-пикером — клиент попросил
// «эти же цвета», как в конструкторе формы. Пикера в проекте больше нет.
test('свотч палитры перекрашивает УЖЕ набранную надпись', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app, front, refreshed } = appWithText();
    app.config = {
      fonts: [{ id: 'oswald', name: 'Oswald' }],
      textColors: [{ id: 'black', name: 'Чёрный', hex: '#111111' },
                   { id: 'red', name: 'Красный', hex: '#e2001a' }],
    };
    app.render = () => {};

    const свотчи = collectByClass(app.textField(), 'swatch swatch--text');
    assert.equal(свотчи.length, 1, 'невыбранных свотчей должно быть видно');
    свотчи[0].click();

    assert.equal(app.state.textColor, '#e2001a');
    assert.equal(front.color, '#e2001a', 'надпись осталась старого цвета');
    assert.ok(refreshed.length > 0, 'живые узлы не перекрашены');
  } finally {
    globalThis.document = prev;
  }
});

// Маленькие превью сторон и цена собираются в renderPanel, а не в живых узлах сцены.
// У свотча, в отличие от пикера, тянуть нечего — перерисовываем сразу по клику.
test('выбор цвета перерисовывает панель (превью сторон и цена)', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = {
      fonts: [{ id: 'oswald', name: 'Oswald' }],
      textColors: [{ id: 'red', name: 'Красный', hex: '#e2001a' }],
    };
    let renders = 0;
    app.render = () => { renders++; };

    const свотч = findByClass(app.textField(), 'swatch swatch--text');
    assert.ok(свотч, 'свотч цвета не найден в панели');
    свотч.click();
    assert.equal(renders, 1, 'после выбора цвета панель обязана пересобраться');
  } finally {
    globalThis.document = prev;
  }
});

// Подписи над палитрой больше нет — клиент просил её убрать («убрать надпись Цвет надписи»).
test('над палитрой нет подписи, а цвета берутся из конфига', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = {
      fonts: [{ id: 'oswald', name: 'Oswald' }],
      textColors: [{ id: 'white', name: 'Белый', hex: '#ffffff' },
                   { id: 'black', name: 'Чёрный', hex: '#111111' },
                   { id: 'red', name: 'Красный', hex: '#e2001a' }],
    };
    app.render = () => {};
    const field = app.textField();
    const ряд = findByClass(field, 'text-opts__color');
    assert.ok(ряд, 'ряд палитры должен существовать');
    const свои = (ряд.children ?? []).filter((k) => String(k.className || '').includes('swatch'));
    assert.equal(свои.length, 3, 'в ряду обязаны быть только свотчи, по одному на цвет конфига');
    assert.equal(ряд.children.length, свои.length, 'подпись над палитрой вернулась');
    assert.equal(findByClass(field, 'text-opts__picker'), null, 'RGB-пикер вернулся');
  } finally {
    globalThis.document = prev;
  }
});

// ── Вид блока надписи по голосовому клиента 20.09 14:42 ───────────────────────────────
// Дословно: «эту фразу добавить текст нужно вставить в поле, где написано например Маша…
// убрать надпись добавить текст, она не нужна»; «они не выходят из этого блока… отдельно
// и на всю ширину самого этого блока»; «вместо грудь и спина… кнопку шрифт в белом фоне
// залить, а цвет сделать залипшим».
test('подсказка стоит в поле, отдельной подписи над ним нет', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    app.render = () => {};
    const field = app.textField();
    const поле = findByClass(field, 'design-row__input');
    assert.equal(поле.placeholder, 'Добавить текст', 'подсказка в поле обязана быть этими словами');
    assert.equal(findByClass(field, 'design-row__caption'), null,
      'подпись над полем вернулась, а клиент просил её убрать');
  } finally {
    globalThis.document = prev;
  }
});

test('кнопки «Шрифт» и «Цвет» лежат ВНУТРИ плашки и сделаны сегментом', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    app.render = () => {};
    const field = app.textField();
    const плашка = findByClass(field, 'design-row design-row--text');
    assert.ok(плашка, 'плашка надписи должна существовать');
    const сегмент = findByClass(плашка, 'seg text-seg');
    assert.ok(сегмент, 'сегмент обязан лежать ВНУТРИ плашки, а не под ней');
    assert.equal(collectByClass(сегмент, 'seg__btn').length, 2, 'кнопок должно быть две');
    assert.equal(findByClass(field, 'text-fc'), null, 'прежний ряд кнопок под плашкой вернулся');
  } finally {
    globalThis.document = prev;
  }
});

test('выбранная кнопка залита белым, как активная в «Грудь | Спина»', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const { app } = appWithText();
    app.config = { fonts: [{ id: 'oswald', name: 'Oswald' }] };
    app.render = () => {};
    const field = app.textField();
    const [шрифт, цвет] = collectByClass(field, 'seg__btn');
    assert.ok(!/seg__btn--active/.test(шрифт.className), 'на старте ничего не залито');

    шрифт.click();
    assert.match(шрифт.className, /seg__btn--active/, 'нажатая кнопка обязана залипать');
    assert.ok(!/seg__btn--active/.test(цвет.className), 'залипшей может быть только одна');

    цвет.click();
    assert.match(цвет.className, /seg__btn--active/);
    assert.ok(!/seg__btn--active/.test(шрифт.className), 'прежняя обязана отпускаться');
  } finally {
    globalThis.document = prev;
  }
});

// Панели по-прежнему гасятся явно: display: flex перебивает атрибут hidden.
test('скрытые панели действительно скрыты в CSS, сегмент без своего фона', () => {
  const css = readFileSync(new URL('../src/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.text-opts\[hidden\], \.font-list\[hidden\], \.text-opts__color\[hidden\] \{ display: none; \}/,
    'без явного гашения скрытые панели остаются на экране');
  assert.match(css, /\.text-seg \{[^}]*\}/, 'стили сегмента внутри плашки пропали');
  assert.match(css, /\.text-seg__dot \{/, 'кружок цвета на кнопке «Цвет» пропал');
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
