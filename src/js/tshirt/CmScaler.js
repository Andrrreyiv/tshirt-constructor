// CmScaler — перевод «доля рамки → см» и клэмп к min/max (U5, 22.07).
// Рамка = физическая зона печати (взрослая 40×50, детская 30×40). Доля стороны
// принта от стороны рамки × размер рамки в см = реальный размер, независимо от зума.

export class CmScaler {
  /**
   * @param {{ box:{x,y,w,h}, cm:{w,h} }} zone
   * @param {{ width, height }} canvas
   * @param {{ minCm:{w,h}, maxCm:{w,h} }} printSize
   */
  constructor(zone, canvas, printSize) {
    this.zone = zone;
    this.canvas = canvas;
    this.printSize = printSize;
  }

  /** Размер принта в см из его доли от рамки по каждой оси (0..1). */
  sizeCm(fracW, fracH) {
    return {
      w: fracW * this.zone.cm.w,
      h: fracH * this.zone.cm.h,
    };
  }

  /** Клэмп размера в см к диапазону min..max печати. */
  clampCm({ w, h }) {
    const { minCm, maxCm } = this.printSize;
    return {
      w: clamp(w, minCm.w, maxCm.w),
      h: clamp(h, minCm.h, maxCm.h),
    };
  }
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}
