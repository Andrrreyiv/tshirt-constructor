// Просмотр принта крупно. Клиент 09.09 (голосовое 14:19): «когда выбираешь принт на футболку,
// человек по сути не может этот принт разглядеть… нет кнопочки, допустим, знаете, как в Ютубе,
// увеличить… чтобы принт открылся, ну как бы не на весь экран, а хотя бы в доступное обозримое
// поле… есть очень насыщенные принты с мелкими деталями, а у меня там по сути их вообще не видно».
//
// Замер боевого 10.09 подтвердил дословно: плитка 138×138 px при файле 622×800…1596×1500,
// то есть картинка ужата в 4,5-5,8 раза, а клик по плитке делал ровно одно — выбирал принт
// и закрывал окно (LibraryPanel: onPick + closeModal). Разглядеть было негде.
//
// ⚠️ Увеличение работает на ТЕХ ЖЕ файлах, что и плитка, и это принципиально: в библиотеку
// сознательно отдаётся уменьшенное превью, а не оригинал 3111×4000 (см. комментарий у
// .libm__thumb в app.css). 800 px по высоте — это ~7 см при 300 dpi, перепечатать нельзя.
// Оригиналы в браузер не пускаем ни при каком «увеличить».
//
// Здесь проверяется модель без DOM — как у PanelAccordion. Листание стрелками согласовано
// с владельцем 10.09 сверх просьбы клиента: при 82 принтах закрывать и открывать окно
// на каждую картинку — это то же самое неудобство с другой стороны.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrintPreview } from '../src/js/tshirt/PrintPreview.js';

const items = [
  { id: 'a', file: 'a.webp' },
  { id: 'b', file: 'b.webp' },
  { id: 'c', file: 'c.webp' },
];

test('на старте просмотр закрыт и картинки нет', () => {
  const p = new PrintPreview();
  assert.equal(p.isOpen, false);
  assert.equal(p.current, null);
});

test('открывается ровно на той картинке, по которой нажали', () => {
  const p = new PrintPreview();
  p.open(items, 1);
  assert.equal(p.isOpen, true);
  assert.equal(p.current.file, 'b.webp');
});

test('стрелки листают вперёд и назад', () => {
  const p = new PrintPreview();
  p.open(items, 0);
  p.next();
  assert.equal(p.current.file, 'b.webp');
  p.next();
  assert.equal(p.current.file, 'c.webp');
  p.prev();
  assert.equal(p.current.file, 'b.webp');
});

// Зацикливание, а не упор в край: покупатель листает 82 картинки подряд и не должен
// гадать, кончились они или кнопка сломалась.
test('с последней вперёд — на первую, с первой назад — на последнюю', () => {
  const p = new PrintPreview();
  p.open(items, 2);
  p.next();
  assert.equal(p.current.file, 'a.webp', 'после последней идёт первая');
  p.prev();
  assert.equal(p.current.file, 'c.webp', 'до первой идёт последняя');
});

test('одна картинка в категории: листание оставляет её на месте', () => {
  const p = new PrintPreview();
  p.open([items[0]], 0);
  p.next();
  assert.equal(p.current.file, 'a.webp');
  p.prev();
  assert.equal(p.current.file, 'a.webp');
});

// Пустая категория в библиотеке возможна (отбор по тону прячет всё), и открывать
// просмотр на пустоте нельзя: дальше он показывал бы undefined.
test('на пустом списке просмотр не открывается', () => {
  const p = new PrintPreview();
  p.open([], 0);
  assert.equal(p.isOpen, false);
  assert.equal(p.current, null);
});

test('индекс за границами списка прижимается к ближайшей картинке', () => {
  const p = new PrintPreview();
  p.open(items, 99);
  assert.equal(p.current.file, 'c.webp');
  p.close();
  p.open(items, -5);
  assert.equal(p.current.file, 'a.webp');
});

test('закрытие сбрасывает и просмотр, и картинку', () => {
  const p = new PrintPreview();
  p.open(items, 1);
  p.close();
  assert.equal(p.isOpen, false);
  assert.equal(p.current, null);
});

// Листание не должно ничего выбирать: выбор — отдельное действие кнопкой «Выбрать этот принт».
test('листание не выбирает принт, файл отдаётся только по запросу', () => {
  const p = new PrintPreview();
  p.open(items, 0);
  p.next();
  assert.equal(p.pick(), 'b.webp', 'выбирается именно та картинка, что на экране');
});

test('на закрытом просмотре выбирать нечего', () => {
  const p = new PrintPreview();
  assert.equal(p.pick(), null);
});

// ── Иерархия клавиш ──────────────────────────────────────────
// Ловушка, найденная при разборе кода 10.09: в LibraryPanel висит ОДИН глобальный
// обработчик Escape, и он закрывал всю библиотеку. Если бы просмотр повесили сверху
// как есть, покупатель, закрывая увеличенный принт, вылетал бы из выбора целиком.
import { keyAction } from '../src/js/tshirt/LibraryPanel.js';

test('Esc при открытом просмотре гасит только просмотр, библиотека остаётся', () => {
  assert.equal(keyAction('Escape', true), 'closePreview');
});

test('Esc без просмотра закрывает библиотеку — прежнее поведение цело', () => {
  assert.equal(keyAction('Escape', false), 'closeModal');
});

test('стрелки листают только внутри просмотра', () => {
  assert.equal(keyAction('ArrowRight', true), 'next');
  assert.equal(keyAction('ArrowLeft', true), 'prev');
  assert.equal(keyAction('ArrowRight', false), 'none', 'в библиотеке стрелки не трогаем');
  assert.equal(keyAction('ArrowLeft', false), 'none');
});

test('посторонние клавиши ничего не делают', () => {
  assert.equal(keyAction('Enter', true), 'none');
  assert.equal(keyAction('a', false), 'none');
});
