// Проводка вывода метода в панель.
//
// Клиент 25.08 (голос 15-09-19): «если человек просто надпись выбрал, то там делаем плёнкой…
// кнопку плёнкой, и всё, ничем поменять не может, не может поменять на DTF. Если он выбрал
// принт или загрузил картинку, то там делаем только DTF, там кнопку плёнка убираем».
//
// Метода мало: цену считает OrderBuilder по state.printMethod, поэтому проверяется именно
// то, что состояние догоняет содержимое футболки. DOM не нужен — syncPrintMethod трогает
// только LayerManager и state, поэтому app собран через Object.create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TshirtApp } from '../src/js/ui/TshirtApp.js';
import { LayerManager } from '../src/js/tshirt/LayerManager.js';

function appWith(descriptors) {
  const app = Object.create(TshirtApp.prototype);
  app.layers = new LayerManager(2);
  app.state = { side: 'front', printMethod: 'dtf' };
  for (const d of descriptors) app.layers.add('front', d);
  return app;
}

test('положили только надпись — метод становится плёнкой', () => {
  const app = appWith([{ id: 't1', kind: 'text', text: 'Маша' }]);
  app.syncPrintMethod();
  assert.equal(app.state.printMethod, 'film');
});

// Набор надписи идёт в ТИХОМ режиме (панель не пересобирается, иначе слетает фокус),
// цену там обновляет updatePrice → currentOrder, мимо methodField. Поэтому метод обязан
// выводиться и в самом заказе, иначе первая же надпись посчитается по цене DTF.
test('заказ считается по выведенному методу даже без пересборки панели', () => {
  const app = appWith([{ id: 't1', kind: 'text', text: 'Маша' }]);
  app.config = { sides: [{ id: 'front' }, { id: 'back' }], prices: { print: { methods: METHODS } } };
  app.scalers = {};
  app.priceCalc = { price: () => 0 };
  app.textPrice = { price: () => 500 };
  assert.equal(app.currentOrder().method, 'film');
});

// ── Панель ───────────────────────────────────────────────────────────────────
// «там кнопку плёнка убираем» — то есть в панели остаётся РОВНО одна кнопка, а не две
// с одной активной: иначе покупатель всё равно жмёт по дешёвой и удивляется цене.
// Заглушка документа умеет ровно то, что нужно segField: создать узел, повесить
// слушателя, дописать текст.
function stubDocument() {
  const make = (tag) => ({
    tagName: tag, className: '', textContent: '', style: {}, children: [], on: {},
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = kids; },
    setAttribute(k, v) { this[k] = v; },
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); },
  });
  return { createElement: make, createTextNode: (t) => ({ text: t }) };
}

/** Подписи всех кнопок .seg__btn в поддереве. */
function buttonLabels(node) {
  const out = [];
  for (const kid of node.children ?? []) {
    if (kid && typeof kid.className === 'string' && kid.className.startsWith('seg__btn')) {
      out.push(kid.children.map(c => c.text ?? '').join(''));
    }
    out.push(...buttonLabels(kid));
  }
  return out;
}

const METHODS = { dtf: { label: 'DTF' }, film: { label: 'Плёнкой' } };

test('надпись без принта — в панели только «Плёнкой», кнопки DTF нет', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const app = appWith([{ id: 't1', kind: 'text', text: 'Маша' }]);
    app.config = { prices: { print: { methods: METHODS } } };
    assert.deepEqual(buttonLabels(app.methodField()), ['Плёнкой']);
  } finally {
    globalThis.document = prev;
  }
});

// На пустой футболке печатать нечего, поэтому поля метода быть не должно вовсе:
// одинокая залипшая кнопка над пустым изделием только сбивает с толку.
test('на пустой футболке поля метода нет', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const app = appWith([]);
    app.config = { prices: { print: { methods: METHODS } } };
    assert.equal(app.methodField(), null);
  } finally {
    globalThis.document = prev;
  }
});

// Проверено в браузере 25.08: покупатель напечатал «Маша», цена стала плёночной, а строки
// «Плёнкой» на экране НЕ БЫЛО — она появлялась только после клика по любому другому полю.
// Причина в тихом режиме: панель нарочно не пересобирается, иначе слетает фокус с поля ввода.
// Поэтому поле метода живёт в постоянном гнезде, которое обновляется вместе с ценой.
test('поле метода догоняет надпись без пересборки панели', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const app = appWith([]);
    app.config = { prices: { print: { methods: METHODS } } };
    app.methodSlot = globalThis.document.createElement('div');
    app.refreshMethodField();
    assert.deepEqual(buttonLabels(app.methodSlot), [], 'на пустой футболке печатать нечего');
    app.layers.add('front', { id: 't1', kind: 'text', text: 'Маша' });
    app.refreshMethodField();
    assert.deepEqual(buttonLabels(app.methodSlot), ['Плёнкой']);
  } finally {
    globalThis.document = prev;
  }
});

// Обратный случай и главный по деньгам: плёнкой такой принт не сделать.
test('принт вместе с надписью — в панели только DTF', () => {
  const prev = globalThis.document;
  globalThis.document = stubDocument();
  try {
    const app = appWith([
      { id: 'p1', kind: 'print', src: 'x.png' },
      { id: 't1', kind: 'text', text: 'Маша' },
    ]);
    app.state.printMethod = 'film'; // покупатель успел выбрать дешёвое до принта
    app.config = { prices: { print: { methods: METHODS } } };
    assert.deepEqual(buttonLabels(app.methodField()), ['DTF']);
    assert.equal(app.state.printMethod, 'dtf', 'цена осталась бы плёночной');
  } finally {
    globalThis.document = prev;
  }
});
