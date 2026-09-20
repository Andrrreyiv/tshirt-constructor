import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_CROP, validateCrop, isFullCrop, zoneInCrop, mockupTransform, moveCrop, scaleCrop, cropFitsZones, minCropFor,
} from '../src/js/tshirt/Crop.js';

// Кадрирование мокапа (клиент 30.07, видео: «не знаю, как увеличить размеры футболки»).
// Модель: квадрат в долях изображения. Стороны равны, поэтому пропорции подложки
// не меняются и раскладка сцены остаётся прежней.

test('FULL_CROP — это отсутствие кадрирования', () => {
  assert.deepEqual(FULL_CROP, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(isFullCrop(FULL_CROP), true);
  assert.equal(isFullCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }), false);
  assert.equal(isFullCrop(null), true, 'пусто = не кадрируем');
});

test('validateCrop принимает разумный кадр и отвергает мусор', () => {
  assert.deepEqual(validateCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 }), { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
  assert.deepEqual(validateCrop({ x: '0', y: '0', w: '0.4', h: '0.4' }), { x: 0, y: 0, w: 0.4, h: 0.4 });
  for (const bad of [
    null, undefined, 42, 'crop', {},
    { x: -0.1, y: 0, w: 0.5, h: 0.5 },
    { x: 0.7, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.7, w: 0.5, h: 0.5 },
    { x: 0, y: 0, w: 0, h: 0.5 },
    { x: 0, y: 0, w: 1.4, h: 1.4 },
    { x: 0, y: 0, w: 0.02, h: 0.02 },
    { x: 0, y: 0, w: 0.5, h: NaN },
  ]) {
    assert.equal(validateCrop(bad), null, 'должен отвергнуть: ' + JSON.stringify(bad));
  }
});

test('zoneInCrop переводит зону из долей всего мокапа в доли видимой части', () => {
  const zone = { x: 0.35, y: 0.25, w: 0.30, h: 0.40 };
  assert.deepEqual(zoneInCrop(zone, FULL_CROP), zone);
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const v = zoneInCrop(zone, crop);
  assert.ok(Math.abs(v.x - 0.2) < 1e-9 && Math.abs(v.y - 0) < 1e-9);
  assert.ok(Math.abs(v.w - 0.6) < 1e-9 && Math.abs(v.h - 0.8) < 1e-9);
  assert.deepEqual(zoneInCrop(zone, null), zone);
});

// Семантика CSS разбором того, что вернула функция: куда на экране попадёт точка
// картинки с долей p при ширине контейнера W. Именно это важно, а не текст стиля:
// старый тест сверял строки со СВОЕЙ же реализацией и пропустил сдвиг кадра на 35 px.
function mapPoint(style, p, W) {
  const [ox] = style.transformOrigin.split(' ');
  const origin = ox.trim() === '0' ? 0 : (parseFloat(ox) / 100) * W;
  const k = parseFloat(style.transform.match(/scale\(([-\d.]+)\)/)[1]);
  const tr = style.transform.match(/translate\(([-\d.]+)%/);
  const shift = tr ? (parseFloat(tr[1]) / 100) * W : 0;
  // translate применяется первым, затем scale относительно origin.
  return origin + ((p * W + shift) - origin) * k;
}

test('mockupTransform: кадр заполняет контейнер ровно, включая НЕЦЕНТРИРОВАННЫй', () => {
  assert.equal(mockupTransform(FULL_CROP), null, 'без кадрирования стиль не нужен');
  const W = 314;
  for (const crop of [
    { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },   // центрированный
    { x: 0, y: 0, w: 0.5, h: 0.5 },         // в углу
    { x: 0, y: 0, w: 0.78, h: 0.78 },       // случай с боевого 31.07
    { x: 0.2, y: 0.1, w: 0.6, h: 0.6 },
  ]) {
    const st = mockupTransform(crop);
    const left = mapPoint(st, crop.x, W);
    const right = mapPoint(st, crop.x + crop.w, W);
    assert.ok(Math.abs(left) < 0.5, 'левый край кадра в 0, а не ' + left);
    assert.ok(Math.abs(right - W) < 0.5, 'правый край кадра в W, а не ' + right);
  }
});

test('mockupTransform: масштаб обратен стороне кадра', () => {
  assert.match(mockupTransform({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }).transform, /scale\(2\)/);
  assert.match(mockupTransform({ x: 0, y: 0, w: 0.25, h: 0.25 }).transform, /scale\(4\)/);
});

test('moveCrop двигает кадр и упирается в края картинки', () => {
  const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  assert.deepEqual(moveCrop(c, 0.1, 0.1), { x: 0.3, y: 0.3, w: 0.5, h: 0.5 });
  assert.deepEqual(moveCrop(c, -1, -1), { x: 0, y: 0, w: 0.5, h: 0.5 }, 'левый верхний упор');
  assert.deepEqual(moveCrop(c, 1, 1), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'правый нижний упор');
});

test('scaleCrop держит квадрат, не даёт вылезти за картинку и схлопнуться', () => {
  const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  const bigger = scaleCrop(c, 0.7);
  assert.equal(bigger.w, bigger.h, 'стороны равны, пропорции подложки не плывут');
  assert.equal(bigger.w, 0.7);
  assert.equal(scaleCrop(c, 0.95).w, 0.8, 'упор в правый край');
  assert.equal(scaleCrop(c, 0.01).w, 0.1, 'минимальная сторона');
  for (const w of [0.01, 0.3, 0.6, 0.95, 5]) {
    assert.notEqual(validateCrop(scaleCrop(c, w)), null, 'сторона ' + w);
  }
});

test('кадр не ломает зону: после перевода зона остаётся внутри видимой части', () => {
  const zone = { x: 0.35, y: 0.25, w: 0.30, h: 0.40 };
  const crop = { x: 0.2, y: 0.1, w: 0.6, h: 0.6 };
  const v = zoneInCrop(zone, crop);
  assert.ok(v.x >= 0 && v.y >= 0, 'не уехала в минус');
  assert.ok(v.x + v.w <= 1.0001 && v.y + v.h <= 1.0001, 'не вылезла за видимую часть');
});

test('cropFitsZones не даёт обрезать зону печати кадром', () => {
  const zone = { x: 0.3, y: 0.2, w: 0.4, h: 0.5 };
  assert.equal(cropFitsZones(FULL_CROP, [zone]), true);
  assert.equal(cropFitsZones({ x: 0.25, y: 0.15, w: 0.6, h: 0.6 }, [zone]), true, 'кадр вмещает зону');
  assert.equal(cropFitsZones({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, [zone]), false, 'зона вылезает сверху');
  assert.equal(cropFitsZones({ x: 0.4, y: 0.2, w: 0.5, h: 0.5 }, [zone]), false, 'зона вылезает слева');
  assert.equal(cropFitsZones({ x: 0, y: 0, w: 0.5, h: 0.5 }, [zone]), false, 'зона вылезает справа и снизу');
});

test('minCropFor даёт наименьший кадр, который ещё вмещает все зоны', () => {
  const front = { x: 0.3, y: 0.2, w: 0.4, h: 0.5 };
  const back = { x: 0.3, y: 0.25, w: 0.4, h: 0.5 };
  const c = minCropFor([front, back]);
  assert.equal(c.w, c.h, 'квадрат');
  assert.equal(cropFitsZones(c, [front, back]), true, 'вмещает обе зоны');
  assert.notEqual(validateCrop(c), null, 'валиден');
  assert.deepEqual(minCropFor([]), FULL_CROP, 'зон нет — не кадрируем');
});
