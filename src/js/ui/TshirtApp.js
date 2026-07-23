// TshirtApp — оркестратор редактора (адаптация jetron UniformApp).
// Фаза 0: превью футболки (тип/цвет/сторона) на реальных мокапах + панель параметров.
// Механики принта/цены/слоёв подключаются по фазам MVP-SCOPE (tshirt/* — заглушки).

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
  /** @param {{ config, viewsEl, panelEl, manifest? }} opts */
  constructor({ config, viewsEl, panelEl, manifest = null }) {
    this.config = config;
    this.viewsEl = viewsEl;
    this.panelEl = panelEl;

    this.state = {
      type: 'base',      // base | oversize
      colorId: 'white',  // white | black | ivory (ivory подтверждена клиентом 23.07)
      side: 'front',     // front | back
      age: 'adult',      // adult | child
      densityG: (config.densities?.[0]?.g) ?? null,
      printMethod: config.prices?.print?.method ?? 'dtf' // dtf | film
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
    this.editor = null;
  }

  start() {
    for (const zone of this.config.zoneTemplate) {
      this.frames[zone.view] = new PrintFrame(zone, this.config.canvas);
      this.scalers[zone.view] = new CmScaler(zone, this.config.canvas, this.config.printSize);
    }
    this.render();
  }

  /** Активная форма (мокап) по типу+цвету. */
  currentForm() {
    return this.config.forms.find(
      f => f.type === this.state.type && f.colorId === this.state.colorId
    );
  }

  /** Полная перерисовка превью + панель + цена. */
  render() {
    this.renderViews();
    this.renderPanel();
    this.updatePrice();
  }

  // ── Превью: миниатюры сторон + крупный мокап ─────────────────────────────
  renderViews() {
    const form = this.currentForm();
    this.viewsEl.innerHTML = '';

    const thumbs = el('div', 'views__thumbs');
    for (const side of this.config.sides) {
      const wrap = el('div');
      const btn = el('button', 'thumb' + (side.id === this.state.side ? ' thumb--active' : ''));
      btn.style.backgroundImage = `url("${form?.images?.[side.id] ?? ''}")`;
      btn.setAttribute('aria-label', side.label);
      btn.addEventListener('click', () => { this.state.side = side.id; this.render(); });
      const label = el('span', 'thumb__label', side.label);
      wrap.append(btn, label);
      thumbs.append(wrap);
    }

    const stage = el('div', 'views__stage');
    const inner = el('div', 'stage__canvas'); // сжимается по картинке → % рамки = % мокапа
    const img = el('img', 'stage__img');
    img.src = form?.images?.[this.state.side] ?? '';
    img.alt = `${form?.typeLabel ?? ''} ${form?.color ?? ''} — ${sideLabel(this.config, this.state.side)}`;
    inner.append(img);

    // Оверлей рамки печати текущей стороны (drag + resize + clip).
    const frame = this.frames[this.state.side];
    const scaler = this.scalers[this.state.side];
    if (frame && scaler) {
      this.editor = new PrintEditor({
        frame, scaler, layers: this.layers,
        getSide: () => this.state.side,
        getMethod: () => this.state.printMethod,
        onChange: () => this.updatePrice(),
      });
      this.editor.mount(inner);
    } else {
      this.editor = null;
    }

    stage.append(inner);
    this.viewsEl.append(thumbs, stage);
  }

  // ── Панель параметров ────────────────────────────────────────────────────
  renderPanel() {
    const c = this.config;
    this.panelEl.innerHTML = '';

    // Тип
    this.panelEl.append(this.segField('Тип футболки', typeOptions(c), this.state.type,
      v => { this.state.type = v; this.render(); }));

    // Цвет
    this.panelEl.append(this.colorField());

    // Сторона
    this.panelEl.append(this.segField('Сторона',
      c.sides.map(s => ({ value: s.id, label: s.label })), this.state.side,
      v => { this.state.side = v; this.render(); }));

    // Плотность (образец, из админки позже)
    this.panelEl.append(this.segField('Плотность ткани',
      c.densities.map(d => ({ value: d.g, label: `${d.g} г`, sub: d.label.split('—')[1]?.trim() })),
      this.state.densityG, v => { this.state.densityG = Number(v); this.render(); }));

    // Возраст
    this.panelEl.append(this.segField('Размерная линейка',
      [{ value: 'adult', label: 'Взрослая' }, { value: 'child', label: 'Детская' }],
      this.state.age, v => { this.state.age = v; this.render(); }));

    // Таблица размеров
    this.panelEl.append(this.sizesField());

    // Метод нанесения (влияет на ступенчатую цену)
    this.panelEl.append(this.segField('Метод нанесения',
      Object.entries(c.prices.print.methods).map(([id, m]) => ({ value: id, label: m.label })),
      this.state.printMethod, v => { this.state.printMethod = v; this.render(); }));

    // Библиотека принтов + загрузка
    this.panelEl.append(this.libraryField());

    // Текст (U2 скидка при комбо с принтом, U8 полный RGB-цвет)
    this.panelEl.append(this.textField());

    // Итог заказа (сводка того, что нанесено + разбивка цены)
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

  /** Видимый блок «Итог заказа»: изделие, нанесения по сторонам, разбивка цены. */
  orderField() {
    const order = this.currentOrder();
    const field = el('div', 'field order');
    field.append(el('div', 'field__label', 'Итог заказа'));

    const p = order.product;
    field.append(el('div', 'order__product',
      `${p.typeLabel}, ${p.color}, ${p.densityG} г, ${p.age === 'child' ? 'детская' : 'взрослая'} · ${order.methodLabel}`));

    // Нанесения по сторонам (только непустые).
    for (const side of this.config.sides) {
      const s = order.sides[side.id];
      if (!s || (s.prints.length === 0 && s.texts.length === 0)) continue;
      const block = el('div', 'order__side');
      block.append(el('div', 'order__side-name', side.label));
      for (const pr of s.prints) {
        block.append(rowLine(`Принт ${pr.cm.w}×${pr.cm.h} см`, `${pr.price} ₽`));
      }
      for (const tx of s.texts) {
        block.append(rowLine(`Текст «${tx.text}»`, `${tx.price} ₽`));
      }
      field.append(block);
    }

    // Разбивка цены.
    const br = el('div', 'order__breakdown');
    br.append(rowLine('Футболка', `${order.price.base} ₽`));
    if (order.price.prints > 0) br.append(rowLine('Принты', `${order.price.prints} ₽`));
    if (order.price.texts > 0) br.append(rowLine('Текст', `${order.price.texts} ₽`));
    const totalRow = rowLine('Итого', `${order.price.total} ₽`);
    totalRow.classList.add('order__total');
    br.append(totalRow);
    field.append(br);

    return field;
  }

  textField() {
    const field = el('div', 'field');
    field.append(el('div', 'field__label', 'Текст'));

    const row = el('div', 'text-row');
    const input = el('input', 'text-row__input');
    input.type = 'text';
    input.placeholder = 'Ваша надпись';
    input.value = this.state.textInput;
    input.addEventListener('input', () => { this.state.textInput = input.value; });

    const color = el('input', 'text-row__color');
    color.type = 'color'; // U8: полный RGB-пикер
    color.value = this.state.textColor;
    color.title = 'Цвет текста (любой)';
    color.addEventListener('input', () => { this.state.textColor = color.value; });

    const add = el('button', 'text-row__add', 'Добавить');
    add.addEventListener('click', () => this.addText());

    row.append(input, color, add);
    field.append(row);

    const disc = this.config.prices?.text?.combinedDiscountPct ?? 0;
    field.append(el('div', 'hint',
      `Текст ${this.config.prices?.text?.standalone ?? 0} ₽. С принтом — скидка ${disc}% на текст.`));
    return field;
  }

  addText() {
    const text = (this.state.textInput || '').trim();
    if (!text) return;
    if (!this.editor) return;
    this.editor.addText({ text, color: this.state.textColor });
    this.state.textInput = '';
    this.render();
  }

  libraryField() {
    const field = el('div', 'field');
    field.append(el('div', 'field__label', 'Принт'));
    const cap = el('div', 'hint',
      `Максимум ${this.config.layers?.maxPrintsPerSide ?? 2} принта на сторону. Тяните принт в рамке, угол — размер.`);
    field.append(cap);
    const libEl = el('div', 'lib');
    this.library.render(libEl, {
      onPick: (src) => this.addPrint(src),
      onUpload: (file) => this.uploadPrint(file),
    });
    field.append(libEl);
    return field;
  }

  addPrint(src) {
    if (!this.editor) return;
    if (!this.editor.addPrint(src)) {
      alert(`На эту сторону можно добавить не более ${this.config.layers?.maxPrintsPerSide ?? 2} принтов.`);
    }
  }

  uploadPrint(file) {
    const maxMB = this.config.upload?.maxUploadMB ?? 20;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`Файл больше ${maxMB} МБ.`);
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
      btn.append(document.createTextNode(opt.label));
      if (opt.sub) btn.append(el('small', '', opt.sub));
      btn.addEventListener('click', () => onPick(opt.value));
      seg.append(btn);
    }
    field.append(seg);
    return field;
  }

  colorField() {
    const field = el('div', 'field');
    field.append(el('div', 'field__label', 'Цвет'));
    const row = el('div', 'colors');
    for (const color of this.config.colors) {
      const pending = color.pending === true;
      const isActive = color.id === this.state.colorId && !pending;
      const sw = el('button', 'swatch'
        + (isActive ? ' swatch--active' : '')
        + (pending ? ' swatch--pending' : ''));
      sw.style.background = color.hex;
      sw.title = pending ? `${color.name} (под подтверждение)` : color.name;
      if (pending) {
        sw.append(el('span', 'swatch__badge', 'под подтв.'));
        sw.disabled = true;
      } else {
        sw.addEventListener('click', () => { this.state.colorId = color.id; this.render(); });
      }
      row.append(sw);
    }
    field.append(row);
    field.append(el('div', 'hint', 'Старт: белый, чёрный и слоновая кость. Прочие цвета — из админки (перекраска).'));
    return field;
  }

  sizesField() {
    const field = el('div', 'field');
    const table = this.config.sizes[this.state.age];
    field.append(el('div', 'field__label', table?.title ?? 'Размеры'));
    const t = el('table', 'sizes-table');
    const thead = el('tr');
    for (const col of table?.columns ?? []) thead.append(el('th', '', col));
    t.append(thead);
    for (const row of table?.rows ?? []) {
      const tr = el('tr');
      for (const cell of row) tr.append(el('td', '', cell));
      t.append(tr);
    }
    field.append(t);
    return field;
  }

  // ── Цена: единый источник — buildOrder (база U3 + принты U1 + текст U2) ──
  updatePrice() {
    const out = document.getElementById('totalPrice');
    if (!out) return;
    const total = this.currentOrder().price.total;
    out.textContent = total > 0 ? `${total} ₽` : '—';
  }
}

// ── Хелперы DOM ──────────────────────────────────────────────────────────────
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
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
