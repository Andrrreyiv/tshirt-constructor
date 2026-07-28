// TshirtApp — оркестратор редактора (адаптация jetron UniformApp).
// Раскладка v2 (единая с конструктором формы): сцена показывает ОБЕ стороны разом,
// цвет и фасон выбираются под макетом, правая панель — параметры + липкий итог с CTA.
// Активная сторона (клик по карточке) — та, куда добавляются принт и текст.

import { PrintFrame } from '../tshirt/PrintFrame.js';
import { CmScaler } from '../tshirt/CmScaler.js';
import { LayerManager } from '../tshirt/LayerManager.js';
import { StepPrice } from '../tshirt/StepPrice.js';
import { TextPrice } from '../tshirt/TextPrice.js';
import { PrintEditor } from '../tshirt/PrintEditor.js';
import { buildOrder } from '../tshirt/OrderBuilder.js';
import { QualityHint } from '../tshirt/QualityHint.js';
import { Recolor } from '../tshirt/Recolor.js';
import { LibraryPanel } from '../tshirt/LibraryPanel.js';

export class TshirtApp {
  /** @param {{ config, viewsEl, panelEl, colorEl, manifest }} opts */
  constructor({ config, viewsEl, panelEl, colorEl = null, manifest = null }) {
    this.config = config;
    this.viewsEl = viewsEl;
    this.panelEl = panelEl;
    this.colorEl = colorEl;

    this.state = {
      type: 'base',      // base | oversize
      colorId: 'white',  // white | black | ivory (ivory подтверждена клиентом 23.07)
      side: 'front',     // активная сторона: куда ложатся принт и текст
      age: 'adult',      // adult | child
      densityG: (config.densities?.[0]?.g) ?? null,
      printMethod: config.prices?.print?.method ?? 'dtf', // dtf | film
      sizesOpen: false,
    };

    this.state.textInput = '';
    this.state.textColor = '#111111';

    // Доменные модули (фаза 1 активна).
    this.layers = new LayerManager(config.layers?.maxPrintsPerSide ?? 2);
    this.priceCalc = new StepPrice(config.prices.print);
    this.textPrice = new TextPrice(config.prices.text ?? {});
    this.quality = new QualityHint(config);
    this.recolor = new Recolor(config);
    this.library = new LibraryPanel(config, manifest);
    this.frames = {};
    this.scalers = {};
    this.editors = {};   // по одному редактору на сторону — обе видны одновременно
    this._lastTotal = null;
  }

  start() {
    for (const zone of this.config.zoneTemplate) {
      this.frames[zone.view] = new PrintFrame(zone, this.config.canvas);
      this.scalers[zone.view] = new CmScaler(zone, this.config.canvas, this.config.printSize);
    }
    this.render();
  }

  /** Активная форма (мокап) по типу и цвету. */
  currentForm() {
    return this.config.forms.find(
      f => f.type === this.state.type && f.colorId === this.state.colorId
    );
  }

  /** Редактор активной стороны — принимает принты и текст. */
  activeEditor() {
    return this.editors[this.state.side] ?? null;
  }

  /** Полная перерисовка сцены, палитры, панели и цены. */
  render() {
    this.renderViews();
    this.renderColorPick();
    this.renderPanel();
    this.updatePrice();
  }

  // ── Сцена: обе стороны разом ─────────────────────────────────────────────
  renderViews() {
    const form = this.currentForm();
    this.viewsEl.innerHTML = '';
    this.editors = {};

    for (const side of this.config.sides) {
      const isActive = side.id === this.state.side;
      const col = el('div', 'canvas-col' + (isActive ? ' is-active' : ''));
      col.append(el('div', 'canvas-label', side.label));

      const wrap = el('div', 'canvas-wrap' + (isActive ? ' is-active' : ''));
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('aria-pressed', String(isActive));
      wrap.setAttribute('aria-label', 'Выбрать сторону: ' + side.label);

      const inner = el('div', 'stage__canvas'); // сжимается по картинке → % рамки = % мокапа
      const img = el('img', 'stage__img');
      img.src = form?.images?.[side.id] ?? '';
      img.alt = (form?.typeLabel ?? '') + ' ' + (form?.color ?? '') + ' — ' + side.label;
      inner.append(img);

      // Оверлей рамки печати этой стороны (drag + resize + clip).
      const frame = this.frames[side.id];
      const scaler = this.scalers[side.id];
      if (frame && scaler) {
        const editor = new PrintEditor({
          frame, scaler, layers: this.layers,
          getSide: () => side.id,
          getMethod: () => this.state.printMethod,
          onChange: () => { this.renderPanel(); this.updatePrice(); },
        });
        editor.mount(inner);
        this.editors[side.id] = editor;
      }

      wrap.append(inner);
      const pick = () => {
        if (this.state.side !== side.id) { this.state.side = side.id; this.render(); }
      };
      wrap.addEventListener('click', (e) => {
        // Клик по принту, ручке или крестику не должен переключать сторону.
        if (e.target.closest('.pf-print')) return;
        pick();
      });
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });

      col.append(wrap);
      this.viewsEl.append(col);
    }
  }

  // ── Цвет и фасон под макетом ─────────────────────────────────────────────
  renderColorPick() {
    if (!this.colorEl) return;
    const c = this.config;
    const form = this.currentForm();
    this.colorEl.innerHTML = '';

    const head = el('div', 'cp-head');
    const title = el('div', 'cp-title');
    title.append(document.createTextNode('Цвет: '), el('b', '', form?.color ?? '—'));
    head.append(title);
    this.colorEl.append(head);

    // Палитра цветов изделия
    const palette = el('div', 'color-palette');
    for (const color of c.colors) {
      const pending = color.pending === true;
      const isActive = color.id === this.state.colorId && !pending;
      const sw = el('button', 'swatch'
        + (isActive ? ' swatch--active' : '')
        + (pending ? ' swatch--pending' : ''));
      sw.type = 'button';
      sw.style.background = color.hex;
      sw.title = pending ? color.name + ' (под подтверждение)' : color.name;
      sw.setAttribute('aria-label', color.name);
      if (pending) {
        sw.append(el('span', 'swatch__badge', 'под подтв.'));
        sw.disabled = true;
      } else {
        sw.addEventListener('click', () => { this.state.colorId = color.id; this.render(); });
      }
      palette.append(sw);
    }
    this.colorEl.append(palette);

    // Фасон — карточками с живым превью выбранного цвета
    const label = el('div', 'cp-models-label');
    label.append(document.createTextNode('Фасон: '), el('b', '', form?.typeLabel ?? '—'));
    this.colorEl.append(label);

    const carousel = el('div', 'model-carousel');
    for (const opt of typeOptions(c)) {
      const variant = c.forms.find(f => f.type === opt.value && f.colorId === this.state.colorId)
        ?? c.forms.find(f => f.type === opt.value);
      const card = el('button', 'model-card' + (opt.value === this.state.type ? ' active' : ''));
      card.type = 'button';
      card.setAttribute('aria-pressed', String(opt.value === this.state.type));
      const thumb = el('div', 'model-thumb');
      const img = el('img');
      img.src = variant?.images?.front ?? '';
      img.alt = opt.label;
      thumb.append(img);
      card.append(thumb, el('span', 'model-name', opt.label));
      card.addEventListener('click', () => { this.state.type = opt.value; this.render(); });
      carousel.append(card);
    }
    this.colorEl.append(carousel);
  }

  // ── Панель параметров ────────────────────────────────────────────────────
  renderPanel() {
    const c = this.config;
    this.panelEl.innerHTML = '';

    const head = el('div', 'panel-title');
    head.append(el('h2', '', 'Конструктор футболок'));
    head.append(el('p', '', 'Выберите изделие, добавьте принт и надпись — цена пересчитается сразу.'));
    this.panelEl.append(head);

    // Изделие
    const product = section('Изделие');
    product.append(this.segField('Плотность ткани',
      c.densities.map(d => ({ value: d.g, label: d.g + ' г', sub: d.label.split('—')[1]?.trim() })),
      this.state.densityG, v => { this.state.densityG = Number(v); this.render(); }));
    product.append(this.segField('Размерная линейка',
      [{ value: 'adult', label: 'Взрослая' }, { value: 'child', label: 'Детская' }],
      this.state.age, v => { this.state.age = v; this.render(); }));
    product.append(this.sizesField());
    this.panelEl.append(product);

    // Принт
    const printSec = section('Принт', 'до ' + (c.layers?.maxPrintsPerSide ?? 2) + ' на сторону');
    printSec.append(this.segField('Метод нанесения',
      Object.entries(c.prices.print.methods).map(([id, m]) => ({ value: id, label: m.label })),
      this.state.printMethod, v => { this.state.printMethod = v; this.render(); }));
    printSec.append(this.libraryField());
    this.panelEl.append(printSec);

    // Надпись
    const textSec = section('Надпись');
    textSec.append(this.textField());
    this.panelEl.append(textSec);

    // Итог заказа + CTA
    this.panelEl.append(this.orderField());
  }

  /** Собрать сериализуемый итог заказа из текущего состояния (единый источник цены). */
  currentOrder() {
    return buildOrder({
      config: this.config,
      state: this.state,
      layers: this.layers,
      scalers: this.scalers,
      priceCalc: this.priceCalc,
      textPrice: this.textPrice,
    });
  }

  /** Липкая карточка «Итог заказа»: изделие, нанесения по сторонам, разбивка, CTA. */
  orderField() {
    const order = this.currentOrder();
    const sec = section('Итог заказа');
    sec.classList.add('price-box');

    const p = order.product;
    sec.append(el('div', 'order__product',
      p.typeLabel + ', ' + p.color + ', ' + p.densityG + ' г, '
      + (p.age === 'child' ? 'детская' : 'взрослая') + ' · ' + order.methodLabel));

    // Нанесения по сторонам (только непустые).
    let hasAny = false;
    for (const side of this.config.sides) {
      const s = order.sides[side.id];
      if (!s || (s.prints.length === 0 && s.texts.length === 0)) continue;
      hasAny = true;
      const block = el('div', 'order__side');
      block.append(el('div', 'order__side-name', side.label));
      for (const pr of s.prints) {
        block.append(rowLine('Принт ' + pr.cm.w + '×' + pr.cm.h + ' см', pr.price + ' ₽'));
      }
      for (const tx of s.texts) {
        block.append(rowLine('Текст «' + tx.text + '»', tx.price + ' ₽'));
      }
      sec.append(block);
    }
    if (!hasAny) {
      sec.append(el('div', 'order__empty', 'Нанесений пока нет — добавьте принт или надпись.'));
    }

    // Разбивка цены.
    const br = el('div', 'order__breakdown');
    br.append(rowLine('Футболка', order.price.base + ' ₽'));
    if (order.price.prints > 0) br.append(rowLine('Принты', order.price.prints + ' ₽'));
    if (order.price.texts > 0) br.append(rowLine('Надпись', order.price.texts + ' ₽'));
    sec.append(br);

    // Итог крупно + CTA.
    const foot = el('div', 'price-foot');
    foot.append(el('span', 'price-foot-label', 'Итого'));
    const total = el('span', 'price-total', order.price.total + ' ₽');
    total.id = 'totalPrice';
    foot.append(total);
    sec.append(foot);

    const cta = el('button', 'cta', 'Оформить заказ');
    cta.type = 'button';
    sec.append(cta);
    sec.append(el('div', 'hint price-note', 'Цена предварительная. Менеджер подтвердит перед оплатой.'));

    return sec;
  }

  textField() {
    const field = el('div', 'field');

    const row = el('div', 'text-row');
    const input = el('input', 'text-row__input');
    input.type = 'text';
    input.placeholder = 'Ваша надпись';
    input.value = this.state.textInput;
    input.addEventListener('input', () => { this.state.textInput = input.value; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.addText(); });

    const color = el('input', 'text-row__color');
    color.type = 'color'; // U8: полный RGB-пикер
    color.value = this.state.textColor;
    color.title = 'Цвет текста (любой)';
    color.addEventListener('input', () => { this.state.textColor = color.value; });

    const add = el('button', 'text-row__add', 'Добавить');
    add.type = 'button';
    add.addEventListener('click', () => this.addText());

    row.append(input, color, add);
    field.append(row);

    const disc = this.config.prices?.text?.combinedDiscountPct ?? 0;
    field.append(el('div', 'hint',
      'Надпись ' + (this.config.prices?.text?.standalone ?? 0) + ' ₽. '
      + 'Вместе с принтом — дешевле на ' + disc + '%. '
      + 'Ляжет на сторону «' + sideLabel(this.config, this.state.side) + '».'));
    return field;
  }

  addText() {
    const text = (this.state.textInput || '').trim();
    if (!text) return;
    const editor = this.activeEditor();
    if (!editor) return;
    editor.addText({ text, color: this.state.textColor });
    this.state.textInput = '';
    this.render();
  }

  libraryField() {
    const field = el('div', 'field');
    const libEl = el('div', 'lib');
    // Клиент 28.07: библиотека вынесена в отдельное окно, в панели только кнопка вызова.
    this.library.renderTrigger(libEl, {
      onOpen: () => this.library.openModal({
        onPick: (src) => this.addPrint(src),
        onUpload: (file) => this.uploadPrint(file),
      }),
    });
    field.append(libEl);
    field.append(el('div', 'hint',
      'Принт ляжет на сторону «' + sideLabel(this.config, this.state.side) + '». '
      + 'Тяните его внутри рамки, угол — размер.'));
    return field;
  }

  addPrint(src) {
    const editor = this.activeEditor();
    if (!editor) return;
    if (!editor.addPrint(src)) {
      alert('На эту сторону можно добавить не более '
        + (this.config.layers?.maxPrintsPerSide ?? 2) + ' принтов.');
    }
  }

  uploadPrint(file) {
    const maxMB = this.config.upload?.maxUploadMB ?? 20;
    if (file.size > maxMB * 1024 * 1024) {
      alert('Файл больше ' + maxMB + ' МБ.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.addPrint(reader.result);
    reader.readAsDataURL(file);
  }

  segField(label, options, active, onPick) {
    const field = el('div', 'field');
    field.append(el('div', 'field__label', label));
    const seg = el('div', 'seg');
    for (const opt of options) {
      const isActive = String(opt.value) === String(active);
      const btn = el('button', 'seg__btn' + (isActive ? ' seg__btn--active' : ''));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(isActive));
      btn.append(document.createTextNode(opt.label));
      if (opt.sub) btn.append(el('small', '', opt.sub));
      btn.addEventListener('click', () => onPick(opt.value));
      seg.append(btn);
    }
    field.append(seg);
    return field;
  }

  sizesField() {
    const field = el('div', 'field');
    const table = this.config.sizes[this.state.age];

    const toggle = el('button', 'sizes-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(this.state.sizesOpen));
    toggle.append(el('span', '', table?.title ?? 'Размеры'), el('span', 'chev', '▾'));

    const body = el('div', 'sizes-body');
    body.hidden = !this.state.sizesOpen;

    const t = el('table', 'sizes-table');
    const thead = el('tr');
    for (const col of table?.columns ?? []) thead.append(el('th', '', col));
    t.append(thead);
    for (const row of table?.rows ?? []) {
      const tr = el('tr');
      for (const cell of row) tr.append(el('td', '', cell));
      t.append(tr);
    }
    body.append(t);

    toggle.addEventListener('click', () => {
      this.state.sizesOpen = !this.state.sizesOpen;
      body.hidden = !this.state.sizesOpen;
      toggle.setAttribute('aria-expanded', String(this.state.sizesOpen));
    });

    field.append(toggle, body);
    return field;
  }

  // ── Цена: единый источник — buildOrder (база U3 + принты U1 + текст U2) ──
  updatePrice() {
    const out = document.getElementById('totalPrice');
    if (!out) return;
    const total = this.currentOrder().price.total;
    out.textContent = total > 0 ? total + ' ₽' : '—';
    // Микро-удар цены при изменении суммы.
    if (this._lastTotal != null && this._lastTotal !== total) {
      out.classList.remove('bump');
      void out.offsetWidth;
      out.classList.add('bump');
    }
    this._lastTotal = total;
  }
}

// ── Хелперы DOM ──────────────────────────────────────────────────────────────
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** Карточка панели с заголовком (и необязательной подписью справа). */
function section(title, note) {
  const sec = document.createElement('section');
  const h = el('h3', '', title);
  if (note) h.append(el('small', '', note));
  sec.append(h);
  return sec;
}

function rowLine(label, value) {
  const row = el('div', 'order__row');
  row.append(el('span', 'order__row-label', label), el('span', 'order__row-value', value));
  return row;
}

function typeOptions(config) {
  const seen = new Map();
  for (const f of config.forms) if (!seen.has(f.type)) seen.set(f.type, f.typeLabel);
  return [...seen].map(([value, label]) => ({ value, label }));
}

function sideLabel(config, sideId) {
  return config.sides.find(s => s.id === sideId)?.label ?? sideId;
}