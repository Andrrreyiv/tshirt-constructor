// Кадрирование мокапа. Клиент 30.07 (видео): «я в режиме редактирования и не знаю,
// как увеличить размеры футболки». Размер изделия на сцене задаёт сам файл: у присланных
// картинок широкие серые поля вокруг футболки. Кадр режет эти поля, не трогая файл.
//
// Модель: кадр — это КВАДРАТ в долях изображения (w === h). Равные стороны держат пропорции
// подложки, поэтому раскладка сцены не плывёт, а перевод зоны печати остаётся линейным.
// Зоны хранятся в долях ВСЕГО мокапа, показываются в долях видимой части — см. zoneInCrop.

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

/** Минимальная сторона кадра: меньше — и мокап превращается в кашу. */
const MIN_SIDE = 0.1;

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/** Кадр отсутствует или покрывает всю картинку. */
export function isFullCrop(crop) {
  if (!crop) return true;
  return crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
}

/**
 * Проверка кадра, пришедшего снаружи (файл настроек, POST админки).
 * Возвращает нормализованный объект или null — тогда вызывающий остаётся без кадрирования.
 */
export function validateCrop(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = Number(v.x), y = Number(v.y), w = Number(v.w), h = Number(v.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w < MIN_SIDE || h < MIN_SIDE) return null;
  if (x < 0 || y < 0) return null;
  if (x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

/**
 * Зона печати из долей ВСЕГО мокапа в доли видимой (кадрированной) части.
 * Именно этими числами позиционируется рамка над картинкой.
 */
export function zoneInCrop(box, crop) {
  if (isFullCrop(crop)) return box;
  return {
    x: (box.x - crop.x) / crop.w,
    y: (box.y - crop.y) / crop.h,
    w: box.w / crop.w,
    h: box.h / crop.h,
  };
}

/**
 * CSS для самой картинки мокапа: масштабируем от центра кадра.
 * Картинка остаётся в потоке и по-прежнему задаёт размер контейнера, поэтому кадрирование
 * не ломает раскладку — лишнее просто обрезается overflow:hidden у контейнера.
 * null — кадрировать нечего.
 */
export function mockupTransform(crop) {
  if (isFullCrop(crop)) return null;
  const cx = (crop.x + crop.w / 2) * 100;
  const cy = (crop.y + crop.h / 2) * 100;
  const k = 1 / crop.w;
  return {
    transformOrigin: round(cx) + '% ' + round(cy) + '%',
    transform: 'scale(' + round(k) + ')',
  };
}

/** Доли кадра уходят в JSON и в подписи, поэтому храним их без хвостов плавающей точки. */
function fix(v) {
  return Math.round(v * 10000) / 10000;
}

/**
 * Кадр обязан ЦЕЛИКОМ содержать зону печати. Иначе рамка вылезет за видимую часть мокапа,
 * и покупатель увидит обрезанную зону — а владелец в редакторе этого может не заметить.
 * zones — массив коробок зон в долях всего мокапа.
 */
export function cropFitsZones(crop, zones) {
  if (isFullCrop(crop)) return true;
  return (zones || []).every((z) => z
    && z.x >= crop.x - 1e-6
    && z.y >= crop.y - 1e-6
    && z.x + z.w <= crop.x + crop.w + 1e-6
    && z.y + z.h <= crop.y + crop.h + 1e-6);
}

/** Наименьший квадратный кадр, который ещё вмещает все зоны. Подсказка для редактора. */
export function minCropFor(zones) {
  const list = (zones || []).filter(Boolean);
  if (!list.length) return FULL_CROP;
  const x0 = Math.min(...list.map((z) => z.x));
  const y0 = Math.min(...list.map((z) => z.y));
  const x1 = Math.max(...list.map((z) => z.x + z.w));
  const y1 = Math.max(...list.map((z) => z.y + z.h));
  const side = Math.min(1, Math.max(x1 - x0, y1 - y0, MIN_SIDE));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {
    x: fix(clamp(cx - side / 2, 0, 1 - side)),
    y: fix(clamp(cy - side / 2, 0, 1 - side)),
    w: fix(side),
    h: fix(side),
  };
}

/** Сдвиг кадра с упором в края картинки. */
export function moveCrop(crop, dx, dy) {
  return {
    x: fix(clamp(crop.x + dx, 0, 1 - crop.w)),
    y: fix(clamp(crop.y + dy, 0, 1 - crop.h)),
    w: crop.w,
    h: crop.h,
  };
}

/** Изменение стороны кадра за угол: квадрат, левый-верхний угол на месте. */
export function scaleCrop(crop, newSide) {
  const maxSide = Math.min(1 - crop.x, 1 - crop.y);
  const side = fix(clamp(newSide, MIN_SIDE, maxSide));
  return { x: crop.x, y: crop.y, w: side, h: side };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
