// PrintFrame — геометрия фиксированной рамки зоны печати + clip (C8, U5).
// Рамка задаётся долями зоны (0..1) от мокапа → CSS-проценты. За рамку принт не
// выносится: контейнер рамки в DOM имеет overflow:hidden (обрезка = «за рамку нельзя»).

export class PrintFrame {
  /**
   * @param {{ box:{x:number,y:number,w:number,h:number}, cm:{w:number,h:number} }} zone
   * @param {{ width:number, height:number }} canvas
   */
  constructor(zone, canvas) {
    this.zone = zone;
    this.canvas = canvas;
  }

  /** Позиция рамки в CSS-процентах над мокапом (для absolute-оверлея). */
  cssBox() {
    const b = this.zone.box;
    return {
      left: pct(b.x),
      top: pct(b.y),
      width: pct(b.w),
      height: pct(b.h),
    };
  }

  /** Точка (доли мокапа 0..1) внутри рамки? */
  contains(fx, fy) {
    const b = this.zone.box;
    return fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h;
  }
}

function pct(frac) {
  return `${frac * 100}%`;
}
