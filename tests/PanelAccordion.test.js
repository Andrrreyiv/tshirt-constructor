// Аккордеон панели. Клиент 26.08 (голос): «нажал кнопку шрифт и цвет, там выбрал
// какой-то шрифт, а потом перешёл к другому полю… то вот это поле должно сворачиваться…
// Тоже самое с таблицей размеров… И то же самое с детализацией внизу».
// Правил два: открыта максимум ОДНА панель, и клик мимо неё её закрывает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PanelAccordion } from '../src/js/ui/PanelAccordion.js';

test('на старте все панели свёрнуты', () => {
  const a = new PanelAccordion();
  assert.equal(a.open, null);
  assert.equal(a.isOpen('text'), false);
});

test('открыта максимум одна панель: новая вытесняет прежнюю', () => {
  const a = new PanelAccordion();
  a.toggle('text');
  assert.equal(a.isOpen('text'), true);

  a.toggle('sizes');
  assert.equal(a.isOpen('sizes'), true);
  assert.equal(a.isOpen('text'), false, 'таблица размеров обязана вытеснить шрифты');
});

test('клик мимо открытой панели её сворачивает, клик внутри — нет', () => {
  const a = new PanelAccordion();
  a.toggle('text');

  // Выбор шрифта и тяга цветового пикера идут ВНУТРИ поля — панель обязана устоять.
  assert.equal(a.closeIfOutside(true), false);
  assert.equal(a.isOpen('text'), true);

  // «Перешёл к другому полю… в любое поле кликнул» — сворачиваем.
  assert.equal(a.closeIfOutside(false), true, 'должна доложить, что DOM пора обновить');
  assert.equal(a.open, null);

  // Закрывать нечего — второй клик мимо уже ничего не меняет.
  assert.equal(a.closeIfOutside(false), false);
});

test('нативный <details> открылся сам — состояние догоняет и вытесняет прочие', () => {
  const a = new PanelAccordion();
  a.toggle('sizes');

  // Детализация внизу — обычный <details>, он раскрывается браузером без нашего toggle.
  a.openOnly('details');
  assert.equal(a.isOpen('details'), true);
  assert.equal(a.isOpen('sizes'), false, 'таблица размеров обязана свернуться');
});
