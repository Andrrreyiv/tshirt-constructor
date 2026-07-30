// Обрезка прозрачных полей у принта (клиент 29.07): библиотечные PNG нарисованы с запасом,
// поэтому рисунок не доходил до краёв рамки, а подпись обещала «40×50 см».
// Здесь только математика границ, работа с canvas — в браузерном слое PrintEditor.

/**
 * Границы непрозрачных пикселей.
 * @param {Uint8ClampedArray|number[]} data RGBA-поток длиной w*h*4
 * @param {number} w
 * @param {number} h
 * @param {number} alphaMin минимальная альфа, которую считаем краской (0..255)
 * @returns {{x:number,y:number,w:number,h:number}|null} null — картинка пустая
 */
export function inkBounds(data, w, h, alphaMin = 8) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] >= alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Есть ли смысл обрезать: поля больше доли tolerance от стороны. */
export function worthTrimming(bounds, w, h, tolerance = 0.01) {
  if (!bounds) return false;
  const cutX = w - bounds.w;
  const cutY = h - bounds.h;
  return cutX > w * tolerance || cutY > h * tolerance;
}

/**
 * Коробка слоя в долях рамки, чтобы картинка легла БЕЗ внутренних полей.
 * Ширину задаём долей fill, высоту считаем из пропорций картинки и пропорций рамки.
 * Если по высоте не влезает — упираемся в высоту и пересчитываем ширину.
 * @param {{w:number,h:number}} frame пиксельный размер рамки
 * @param {{w:number,h:number}} image пиксельный размер картинки (уже обрезанной)
 * @param {number} fill какую долю рамки занять по большей стороне (0..1)
 */
export function fitBox(frame, image, fill = 1) {
  const safeFill = Math.min(Math.max(fill, 0.05), 1);
  const imgAspect = image.w / image.h;
  const frameAspect = frame.w / frame.h;
  let fw = safeFill;
  let fh = (fw * frameAspect) / imgAspect;
  if (fh > safeFill) {
    fh = safeFill;
    fw = (fh * imgAspect) / frameAspect;
  }
  return {
    fx: (1 - fw) / 2,
    fy: (1 - fh) / 2,
    fw,
    fh,
  };
}
