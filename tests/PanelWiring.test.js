// Проводка аккордеона в панель.
//
// Клиент 26.08 (голос 11-13-26): «нажал кнопку шрифт и цвет, там выбрал какой-то шрифт,
// а потом перешёл к другому полю… в любое поле кликнул — то вот это поле, где добавить
// текст и шрифт, оно должно сворачиваться… Тоже самое с таблицей размеров… И то же самое
// с детализацией внизу».
//
// Само правило проверено в PanelAccordion.test.js. Здесь проверяется, что панель
// действительно ходит через него: DOM заменён заглушками, app собран через
// Object.create — тот же приём, что в PrintMethodWiring.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TshirtApp } from '../src/js/ui/TshirtApp.js';
import { PanelAccordion } from '../src/js/ui/PanelAccordion.js';

/** Узел-заглушка: помнит, в каком состоянии его последний раз применили. */
function stubPanel() {
  const seen = [];
  return { seen, root: { contains: () => false }, apply: (open) => seen.push(open) };
}

function appWith(open = null) {
  const app = Object.create(TshirtApp.prototype);
  app.panels = new PanelAccordion(open);
  app.panelRefs = {};
  return app;
}

test('регистрация поля сразу приводит его к состоянию аккордеона', () => {
  const app = appWith('sizes');
  const text = stubPanel();
  const sizes = stubPanel();

  app._registerPanel('text', text.root, text.apply);
  app._registerPanel('sizes', sizes.root, sizes.apply);

  assert.deepEqual(text.seen, [false], 'шрифты пересобрались свёрнутыми');
  assert.deepEqual(sizes.seen, [true], 'таблица размеров пережила пересборку панели');
});

test('открытие одного поля сворачивает в DOM все остальные', () => {
  const app = appWith();
  const text = stubPanel();
  const sizes = stubPanel();
  app._registerPanel('text', text.root, text.apply);
  app._registerPanel('sizes', sizes.root, sizes.apply);

  app.panels.toggle('text');
  app._syncPanels();
  assert.equal(text.seen.at(-1), true);
  assert.equal(sizes.seen.at(-1), false);

  app.panels.toggle('sizes');
  app._syncPanels();
  assert.equal(text.seen.at(-1), false, 'шрифты обязаны свернуться в самом DOM');
  assert.equal(sizes.seen.at(-1), true);
});

test('клик по другому полю сворачивает открытое, клик внутри — нет', () => {
  // Заглушка document: запоминает подписку и умеет «кликнуть» по узлу.
  let handler = null;
  const doc = {
    addEventListener: (type, fn, capture) => {
      assert.equal(type, 'click');
      assert.equal(capture, true, 'только перехват: кнопка поля обязана сработать ПОСЛЕ нас');
      handler = fn;
    },
  };

  const app = appWith();
  app._wireAccordion(doc);

  const inside = {};
  const text = stubPanel();
  text.root = { contains: (n) => n === inside };
  app._registerPanel('text', text.root, text.apply);

  app.panels.toggle('text');
  app._syncPanels();

  // Выбор шрифта идёт внутри поля — панель обязана устоять.
  handler({ target: inside });
  assert.equal(app.panels.isOpen('text'), true);
  assert.equal(text.seen.at(-1), true);

  // «Перешёл к другому полю… в любое поле кликнул» — сворачиваем и в состоянии, и в DOM.
  handler({ target: {} });
  assert.equal(app.panels.open, null);
  assert.equal(text.seen.at(-1), false);
});
