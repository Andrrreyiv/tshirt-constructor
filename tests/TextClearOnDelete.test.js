// Очистка поля ввода при удалении надписи с футболки.
//
// Клиент 26.08 (голос 11-11-48): «я забиваю текст смирнов, на футболке отображается
// смирнов, потом я на футболке удаляю смирнов, а в поле текст слово смирнов остаётся.
// Если уж на футболке удаляем слово смирнов, то и в поле пусть это слово тоже удалится».
// И (голос 11-12-06): «обратно уже вернуть не можем… поэтому оно уже ни к чему».
//
// DOM не нужен: forgetLayer трогает только state, поэтому app собран через Object.create —
// тот же приём, что в PrintMethodWiring.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TshirtApp } from '../src/js/ui/TshirtApp.js';

function appWith(state) {
  const app = Object.create(TshirtApp.prototype);
  app.state = state;
  return app;
}

test('крестик на надписи очищает поле ввода', () => {
  const app = appWith({ textInput: 'Смирнов', liveTextId: 't1' });

  assert.equal(app.forgetLayer({ id: 't1', kind: 'text' }), true);
  assert.equal(app.state.textInput, '');
  assert.equal(app.state.liveTextId, null);
});

test('крестик на принте поле ввода не трогает', () => {
  const app = appWith({ textInput: 'Смирнов', liveTextId: 't1' });

  assert.equal(app.forgetLayer({ id: 'p1', kind: 'print' }), false);
  assert.equal(app.state.textInput, 'Смирнов');
  assert.equal(app.state.liveTextId, 't1');
});

test('удаление ЧУЖОЙ надписи (она осталась на другой стороне) поле не чистит', () => {
  // Набрали «Смирнов» на груди (t1), переключились на спину — liveText заводит там
  // свой слой t2 и поле ввода теперь описывает именно его. Крестик на старом t1
  // не должен стирать текст, который на футболке ещё жив.
  const app = appWith({ textInput: 'Смирнов', liveTextId: 't2' });

  assert.equal(app.forgetLayer({ id: 't1', kind: 'text' }), false);
  assert.equal(app.state.textInput, 'Смирнов');
  assert.equal(app.state.liveTextId, 't2');
});
