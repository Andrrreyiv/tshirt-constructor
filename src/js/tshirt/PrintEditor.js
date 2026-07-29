// PrintEditor — интерактивный оверлей рамки печати над мокапом (фаза 1).
// Рамка = div с overflow:hidden (clip «за рамку нельзя»). Принты — absolute <img>
// внутри рамки: перетаскивание + масштаб за угол, живой показ «Ш×В см», клэмп 5×5..40×50.
// Состояние принтов хранит LayerManager (дескрипторы), оверлей пересобирается из него.

import { fitBoxInFrame } from './BoxFit.js?v=20260729d';

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
    return true;
  }

  /** Добавить текстовый слой. */
  addText({ text, color }) {
    const side = this.getSide();
    const d = { id: uid(), kind: 'text', text, color, fx: 0.1, fy: 0.42, fw: 0.8, fh: 0.16 };
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
