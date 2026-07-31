// PrintEditor — интерактивный оверлей рамки печати над мокапом (фаза 1).
// Рамка = div с overflow:hidden (clip «за рамку нельзя»). Принты — absolute <img>
// внутри рамки: перетаскивание + масштаб за угол, живой показ «Ш×В см», клэмп 5×5..40×50.
// Состояние принтов хранит LayerManager (дескрипторы), оверлей пересобирается из него.

import { fitBoxInFrame } from './BoxFit.js?v=20260731c';
import { inkBounds, worthTrimming, fitBox } from './TrimImage.js?v=20260731c';

export class PrintEditor {
  /**
   * @param {{ frame, scaler, layers, getSide, getMethod, onChange }} opts
   *  frame: PrintFrame · scaler: CmScaler · layers: LayerManager
   *  getSide()/getMethod(): текущая сторона/метод · onChange(): пересчитать цену
   */
  constructor({ frame, scaler, layers, getSide, getMethod, onChange }) {
    this.frame = frame;
    this.scaler = scaler;
    this.layers = layers;
    this.getSide = getSide;
    this.getMethod = getMethod;
    this.onChange = onChange || (() => {});
    this.frameEl = null;
  }

  /** Смонтировать рамку-оверлей в контейнер стейджа и наполнить принтами стороны. */
  mount(stageEl) {
    const box = this.frame.cssBox();
    const frameEl = el('div', 'pf-frame');
    Object.assign(frameEl.style, {
      left: box.left, top: box.top, width: box.width, height: box.height,
    });
    frameEl.setAttribute('aria-label', 'Зона печати 40×50 см');
    this.frameEl = frameEl;
    stageEl.append(frameEl);

    for (const d of this.layers.list(this.getSide())) this._renderLayer(d);

    // Реколибровка размера текста при реформате рамки (загрузка мокапа / ресайз окна).
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        for (const d of this.layers.list(this.getSide())) {
          if ((d.kind ?? 'print') === 'text') this._applyTextSize(d);
        }
      });
      this._ro.observe(frameEl);
    }
    return frameEl;
  }

  /** Добавить новый принт по src (из библиотеки или загрузки). */
  addPrint(src) {
    const side = this.getSide();
    if (!this.layers.canAdd(side, 'print')) return false;
    // Стартовый размер: половина рамки, по центру.
    const d = { id: uid(), kind: 'print', src, fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 };
    this.layers.add(side, d);
    if (this.frameEl) this._renderLayer(d);
    this.onChange();
    // Библиотечные PNG нарисованы с прозрачным запасом по краям: без обрезки рисунок
    // не доходит до краёв коробки, а подпись «Ш×В см» считает коробку и завышает размер.
    this._trimAndFit(d).catch(() => { /* JPEG без альфы или другой домен — оставляем как есть */ });
    return true;
  }

  /** Обрезать прозрачные поля и посадить коробку ровно по картинке. */
  async _trimAndFit(d) {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return;
    const img = await loadImage(d.src);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return; // защищённая картинка: без данных пикселей обрезать нечем
    }
    const bounds = inkBounds(pixels, w, h);
    if (!bounds) return;
    let size = { w: bounds.w, h: bounds.h };
    if (worthTrimming(bounds, w, h)) {
      const cut = document.createElement('canvas');
      cut.width = bounds.w;
      cut.height = bounds.h;
      cut.getContext('2d').drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
      try {
        d.src = cut.toDataURL('image/png');
      } catch {
        size = { w, h }; // не смогли обрезать — считаем коробку по исходным пропорциям
      }
    }
    if (!this.frameEl) return;
    const rect = this.frameEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Стартуем на 70% рамки: покупателю есть куда и увеличить, и уменьшить.
    Object.assign(d, fitBox({ w: rect.width, h: rect.height }, size, 0.7));
    if (d._el) {
      d._el.remove();
      this._renderLayer(d);
    }
    this.onChange();
  }

  /** Добавить текстовый слой. */
  addText({ text, color, fontId = null }) {
    const side = this.getSide();
    const d = { id: uid(), kind: 'text', text, color, fontId, fx: 0.1, fy: 0.42, fw: 0.8, fh: 0.16 };
    this.layers.add(side, d);
    if (this.frameEl) this._renderLayer(d);
    this.onChange();
    return true;
  }

  _renderLayer(d) {
    if ((d.kind ?? 'print') === 'text') this._renderText(d);
    else this._renderPrint(d);
  }

  /** Суммарная цена нанесения всех принтов стороны текущим методом. */
  // (цена считается в TshirtApp через StepPrice; здесь — только размеры)

  _renderPrint(d) {
    const wrap = el('div', 'pf-print');
    Object.assign(wrap.style, {
      left: pct(d.fx), top: pct(d.fy), width: pct(d.fw), height: pct(d.fh),
    });
    const img = el('img', 'pf-print__img');
    img.src = d.src;
    img.draggable = false;
    const handle = el('div', 'pf-print__handle');
    handle.setAttribute('aria-label', 'Изменить размер');
    const del = el('button', 'pf-print__del');
    del.textContent = '×';
    del.title = 'Удалить принт';

    wrap.append(img, handle, del);
    this.frameEl.append(wrap);
    d._el = wrap;

    this._wireDrag(wrap, d);
    this._wireResize(handle, d);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.layers.remove(this.getSide(), d);
      wrap.remove();
      this.onChange();
    });
  }

  _renderText(d) {
    const wrap = el('div', 'pf-print pf-text');
    Object.assign(wrap.style, {
      left: pct(d.fx), top: pct(d.fy), width: pct(d.fw), height: pct(d.fh),
    });
    const span = el('div', 'pf-text__body');
    span.textContent = d.text;
    span.style.color = d.color || '#111';
    // Шрифты надписи объявлены в app.css как ts-<id> (@font-face). Без выбора остаётся
    // шрифт из CSS, чтобы старые слои без fontId рисовались как раньше.
    if (d.fontId) span.style.fontFamily = textFontFamily(d.fontId);
    const handle = el('div', 'pf-print__handle');
    handle.setAttribute('aria-label', 'Изменить размер');
    const del = el('button', 'pf-print__del');
    del.textContent = '×';
    del.title = 'Удалить текст';

    wrap.append(span, handle, del);
    this.frameEl.append(wrap);
    d._el = wrap;
    this._applyTextSize(d);

    this._wireDrag(wrap, d);
    this._wireResize(handle, d, () => this._applyTextSize(d));
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.layers.remove(this.getSide(), d);
      wrap.remove();
      this.onChange();
    });
  }

  /** Размер шрифта текста ≈ доля высоты рамки в px (реколибруется при reflow). */
  _applyTextSize(d) {
    if (!d._el) return;
    const h = this._frameRect().height;
    const px = Math.max(8, h * d.fh * 0.6);
    const body = d._el.querySelector('.pf-text__body');
    if (body) body.style.fontSize = `${px}px`;
  }

  _frameRect() {
    return this.frameEl.getBoundingClientRect();
  }

  _wireDrag(wrap, d) {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('pf-print__handle')) return;
      if (e.target.classList.contains('pf-print__del')) return;
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      const r = this._frameRect();
      const startX = e.clientX, startY = e.clientY;
      const x0 = d.fx, y0 = d.fy;
      const move = (ev) => {
        const dx = (ev.clientX - startX) / r.width;
        const dy = (ev.clientY - startY) / r.height;
        d.fx = clamp(x0 + dx, 0, 1 - d.fw);
        d.fy = clamp(y0 + dy, 0, 1 - d.fh);
        wrap.style.left = pct(d.fx);
        wrap.style.top = pct(d.fy);
      };
      const up = (ev) => {
        wrap.releasePointerCapture(e.pointerId);
        wrap.removeEventListener('pointermove', move);
        wrap.removeEventListener('pointerup', up);
      };
      wrap.addEventListener('pointermove', move);
      wrap.addEventListener('pointerup', up);
    });
  }

  _wireResize(handle, d, onResize) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const r = this._frameRect();
      const startX = e.clientX, startY = e.clientY;
      const w0 = d.fw, h0 = d.fh;
      const isText = (d.kind ?? 'print') === 'text';
      const move = (ev) => {
        const dw = (ev.clientX - startX) / r.width;
        const dh = (ev.clientY - startY) / r.height;
        // Потолок — САМА зона (1), а не остаток справа: иначе центрированный принт нельзя
        // растянуть до краёв (клиент 28.07: «не могу к краям раздвинуть», выходило 37×50 из 40×50).
        let fw = clamp(w0 + dw, 0.02, 1);
        let fh = clamp(h0 + dh, 0.02, 1);
        if (!isText) {
          // Клэмп принта по см (5×5..40×50): доли → см → клэмп → обратно в доли.
          const cm = this.scaler.clampCm(this.scaler.sizeCm(fw, fh));
          fw = cm.w / this.scaler.zone.cm.w;
          fh = cm.h / this.scaler.zone.cm.h;
        }
        // Упёрлись в правый/нижний край — сдвигаем принт внутрь, а не режем размер.
        const box = fitBoxInFrame({ fx: d.fx, fy: d.fy, fw, fh });
        d.fx = box.fx; d.fy = box.fy; d.fw = box.fw; d.fh = box.fh;
        const w = wrap(handle);
        w.style.left = pct(box.fx);
        w.style.top = pct(box.fy);
        w.style.width = pct(box.fw);
        w.style.height = pct(box.fh);
        if (isText) { if (onResize) onResize(); } else { this._showCm(d); }
      };
      const up = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.onChange();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  _showCm(d) {
    const cm = this.scaler.sizeCm(d.fw, d.fh);
    const label = this.frameEl.querySelector('.pf-frame__cm') || (() => {
      const l = el('div', 'pf-frame__cm');
      this.frameEl.append(l);
      return l;
    })();
    label.textContent = `${Math.round(cm.w)}×${Math.round(cm.h)} см`;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function pct(f) { return `${f * 100}%`; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function uid() { return 'p' + Math.random().toString(36).slice(2, 9); }
function wrap(handle) { return handle.parentElement; }

/** CSS-семейство шрифта надписи по id из конфига. */
export function textFontFamily(fontId) {
  return '"ts-' + fontId + '", var(--font-display)';
}

/** Промис-обёртка над загрузкой картинки. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
