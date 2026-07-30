// Геометрия зоны печати. Клиент 29.07: «по ощущениям она не 40 на 50» — и был прав:
// коробка в конфиге имела соотношение 0.96, а 40×50 см это 0.80. Рамка обещала одно,
// а показывала другое. Здесь коробка всегда приводится к пропорциям физической зоны.

/** Доля 0..1 в допустимых границах. */
function clamp01(v) {
  return Math.min(Math.max(v, 0), 1);
}

/**
 * Привести коробку к пропорциям физической зоны, сохранив центр.
 * Уменьшаем по нужной оси, чтобы рамка не вылезла за мокап.
 * @param {{x:number,y:number,w:number,h:number}} box доли мокапа
 * @param {{w:number,h:number}} cm физический размер зоны
 * @param {number} stageAspect ширина/высота подложки в пикселях (мокапы квадратные → 1)
 */
export function alignBoxToCm(box, cm, stageAspect = 1) {
  const target = (cm.w / cm.h) / stageAspect; // нужное отношение w/h в долях мокапа
  const current = box.w / box.h;
  let w = box.w;
  let h = box.h;
  if (current > target) {
    w = h * target;          // коробка слишком широкая — режем ширину
  } else if (current < target) {
    h = w / target;          // слишком узкая — режем высоту
  }
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  w = Math.min(w, 1);
  h = Math.min(h, 1);
  return {
    x: clamp01(Math.min(Math.max(cx - w / 2, 0), 1 - w)),
    y: clamp01(Math.min(Math.max(cy - h / 2, 0), 1 - h)),
    w,
    h,
  };
}

/**
 * Коробка для другого физического размера (например детская 30×40 из взрослой 40×50):
 * масштабируем от центра пропорционально сантиметрам.
 */
export function deriveBox(box, fromCm, toCm) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = Math.min(box.w * (toCm.w / fromCm.w), 1);
  const h = Math.min(box.h * (toCm.h / fromCm.h), 1);
  return {
    x: clamp01(Math.min(Math.max(cx - w / 2, 0), 1 - w)),
    y: clamp01(Math.min(Math.max(cy - h / 2, 0), 1 - h)),
    w,
    h,
  };
}

/** Сдвиг коробки с упором в края мокапа. */
export function moveBox(box, dx, dy) {
  return {
    x: clamp01(Math.min(Math.max(box.x + dx, 0), 1 - box.w)),
    y: clamp01(Math.min(Math.max(box.y + dy, 0), 1 - box.h)),
    w: box.w,
    h: box.h,
  };
}

/**
 * Масштаб коробки за угол с сохранением пропорций и левого-верхнего угла.
 * minW не даёт свести рамку в точку.
 */
export function scaleBox(box, newW, cm, stageAspect = 1, minW = 0.08) {
  const target = (cm.w / cm.h) / stageAspect;
  const w = Math.min(Math.max(newW, minW), 1 - box.x);
  const h = Math.min(w / target, 1 - box.y);
  const wFromH = h * target;
  return { x: box.x, y: box.y, w: Math.min(w, wFromH), h };
}
