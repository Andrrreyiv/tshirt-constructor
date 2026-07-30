import test from 'node:test';
import assert from 'node:assert/strict';
import { inkBounds, worthTrimming, fitBox } from '../src/js/tshirt/TrimImage.js';

/** Собрать RGBA-поток: непрозрачный прямоугольник внутри прозрачного поля. */
function makeImage(w, h, rect) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 200; data[i + 1] = 30; data[i + 2] = 30; data[i + 3] = 255;
    }
  }
  return data;
}

test('inkBounds находит границы рисунка внутри прозрачных полей', () => {
  const data = makeImage(20, 30, { x: 4, y: 6, w: 10, h: 12 });
  assert.deepEqual(inkBounds(data, 20, 30), { x: 4, y: 6, w: 10, h: 12 });
});

test('inkBounds возвращает null на полностью прозрачной картинке', () => {
  assert.equal(inkBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4), null);
});

test('inkBounds считает краской только альфу от порога', () => {
  const data = new Uint8ClampedArray(2 * 1 * 4);
  data[3] = 4;   // почти прозрачный пиксель — это не краска
  data[7] = 200; // второй пиксель — краска
  assert.deepEqual(inkBounds(data, 2, 1, 8), { x: 1, y: 0, w: 1, h: 1 });
});

test('worthTrimming молчит, когда полей практически нет', () => {
  assert.equal(worthTrimming({ x: 0, y: 0, w: 100, h: 100 }, 100, 100), false);
  assert.equal(worthTrimming({ x: 5, y: 0, w: 90, h: 100 }, 100, 100), true);
  assert.equal(worthTrimming(null, 100, 100), false);
});

test('fitBox: вертикальная картинка упирается в высоту рамки', () => {
  // рамка 400×500 (4:5), картинка 300×600 (1:2) — выше рамки, значит потолок по высоте
  const box = fitBox({ w: 400, h: 500 }, { w: 300, h: 600 }, 1);
  assert.equal(box.fh, 1);
  assert.ok(box.fw < 1);
  // проверяем, что пиксельные пропорции коробки совпали с пропорциями картинки
  const boxAspect = (box.fw * 400) / (box.fh * 500);
  assert.ok(Math.abs(boxAspect - 300 / 600) < 1e-9);
  assert.ok(Math.abs(box.fx - (1 - box.fw) / 2) < 1e-9);
});

test('fitBox: горизонтальная картинка упирается в ширину рамки', () => {
  const box = fitBox({ w: 400, h: 500 }, { w: 800, h: 400 }, 1);
  assert.equal(box.fw, 1);
  assert.ok(box.fh < 1);
  const boxAspect = (box.fw * 400) / (box.fh * 500);
  assert.ok(Math.abs(boxAspect - 800 / 400) < 1e-9);
});

test('fitBox уважает долю заполнения', () => {
  const box = fitBox({ w: 400, h: 500 }, { w: 400, h: 500 }, 0.5);
  assert.ok(Math.abs(box.fw - 0.5) < 1e-9);
  assert.ok(Math.abs(box.fh - 0.5) < 1e-9);
});
