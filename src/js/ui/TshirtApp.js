// TshirtApp — оркестратор редактора (адаптация jetron UniformApp).
// Раскладка v3 (макет клиента 28.07): сцена показывает ОДНУ активную сторону крупно,
// цвет и фасон выбираются под макетом, правая панель — параметры + липкий итог с CTA.
// Активная сторона (клик по карточке) — та, куда добавляются принт и текст.

import { PrintFrame } from '../tshirt/PrintFrame.js?v=20260730c';
import { alignBoxToCm, deriveBox } from '../tshirt/ZoneBox.js?v=20260730c';
import { CmScaler } from '../tshirt/CmScaler.js?v=20260730c';
import { LayerManager } from '../tshirt/LayerManager.js?v=20260730c';
import { StepPrice } from '../tshirt/StepPrice.js?v=20260730c';
import { TextPrice } from '../tshirt/TextPrice.js?v=20260730c';
import { PrintEditor } from '../tshirt/PrintEditor.js?v=20260730c';
import { buildOrder } from '../tshirt/OrderBuilder.js?v=20260730c';
import { QualityHint } from '../tshirt/QualityHint.js?v=20260730c';
import { Recolor } from '../tshirt/Recolor.js?v=20260730c';
import { LibraryPanel } from '../tshirt/LibraryPanel.js?v=20260730c';
import { printBoxOnMockup } from '../tshirt/BoxFit.js?v=20260730c';

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
    this.buildZones();
    this.render();
  }

  /**
   * Зоны печати под текущий возраст. Коробка всегда приводится к пропорциям физической
   * зоны (клиент 29.07: рамка обещала 40×50, а на экране была почти квадратной).
   */
  buildZones() {
    const canvas = this.config.canvas;
    const stageAspect = (canvas?.width ?? 1) / (canvas?.height ?? 1);
    const byAge = this.config.frame?.byAge ?? {};
    const adultCm = { w: byAge.adult?.wCm ?? 40, h: byAge.adult?.hCm ?? 50 };
    const ageCm = byAge[this.state.age]
      ? { w: byAge[this.state.age].wCm, h: byAge[this.state.age].hCm }
      : adultCm;
    this.zones = {};
    for (const src of this.config.zoneTemplate) {
      // Владелец правит коробку для взрослой зоны, детская выводится от центра.
      const adultBox = alignBoxToCm(src.box, adultCm, stageAspect);
      const box = ageCm === adultCm ? adultBox : deriveBox(adultBox, adultCm, ageCm);
      const zone = { ...src, box: alignBoxToCm(box, ageCm, stageAspect), cm: { ...ageCm } };
      this.zones[zone.view] = zone;
      this.frames[zone.view] = new PrintFrame(zone, canvas);
      this.scalers[zone.view] = new CmScaler(zone, canvas, this.config.printSize);
    }
  }

  /** Зона стороны с учётом возраста (для превью и редактора). */
  zoneFor(view) {
    return (this.zones && this.zones[view]) || this.config.zoneTemplate.find(z => z.view === view);
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

  // ── Сцена: ТОЛЬКО активная сторона, крупно (макет клиента 28.07) ─────────
  // Раньше показывали обе стороны рядом одинакового размера. Клиент: «слева одна крупная
  // футболка, справа маленькие превьюшки». Превью переехали в панель — sidePreviewField().
  renderViews() {
    const form = this.currentForm();
    this.viewsEl.innerHTML = '';
    this.editors = {};

    for (const side of this.config.sides) {
      const isActive = side.id === this.state.side;
      if (!isActive) continue; // неактивная сторона живёт только в превью панели
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
  /** Фасоны из каталога: значение + подпись как в карточке товара. */
  typeOptions() {
    const seen = new Map();
    for (const f of this.config.forms) {
      if (!seen.has(f.type)) seen.set(f.type, f.typeLabel ?? f.type);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }

  /** Сменить фасон, сохранив выбранный цвет, если он есть у нового фасона. */
  pickType(type) {
    if (this.state.type === type) return;
    this.state.type = type;
    const has = this.config.forms.some(f => f.type === type && f.colorId === this.state.colorId);
    if (!has) {
      const first = this.config.forms.find(f => f.type === type);
      if (first) this.state.colorId = first.colorId;
    }
    this.render();
  }

  renderPanel() {
    const c = this.config;
    this.panelEl.innerHTML = '';

    const head = el('div', 'panel-title');
    head.append(el('h2', '', 'Конструктор футболок'));
    head.append(el('p', '', 'Выберите изделие, добавьте принт и надпись — цена пересчитается сразу.'));
    this.panelEl.append(head);

    // Изделие
    const product = section('Изделие');
    product.append(this.segField('Размерная линейка',
      [{ value: 'adult', label: 'Взрослая' }, { value: 'child', label: 'Детская' }],
      this.state.age, v => { this.state.age = v; this.buildZones(); this.render(); }));
    product.append(this.sizesField());
    product.append(this.segField('Тип футболки', this.typeOptions(),
      this.state.type, v => this.pickType(v)));
    product.append(this.segField('Плотность ткани',
      c.densities.map(d => ({ value: d.g, label: d.g + ' г', sub: d.label.split('—')[1]?.trim() })),
      this.state.densityG, v => { this.state.densityG = Number(v); this.render(); }));
    // Превью сторон и выбор стороны: в макете клиента они идут сразу под плотностью.
    product.append(this.sidePreviewField());
    this.panelEl.append(product);

    // Дизайн: принт, затем надпись, затем метод нанесения — порядок из макета клиента.
    const printSec = section('Добавить дизайн', 'до ' + (c.layers?.maxPrintsPerSide ?? 2) + ' принтов на сторону');
    printSec.append(this.libraryField());
    printSec.append(this.textField());
    printSec.append(this.segField('Метод нанесения',
      Object.entries(c.prices.print.methods).map(([id, m]) => ({ value: id, label: m.label })),
      this.state.printMethod, v => { this.state.printMethod = v; this.render(); }));
    this.panelEl.append(printSec);

    // Итог заказа + CTA
    this.panelEl.append(this.orderField());
  }

/**
   * Превью обеих сторон + переключатель «Грудь / Спина» (макет клиента 28.07).
   * Превью рисуются БЕЗ рамок зоны и БЕЗ подписи размера — только изделие и нанесения,
   * «по тем размерам, которые отображаются на самой футболке».
   */
  sidePreviewField() {
    const field = el('div', 'field');
    const form = this.currentForm();

    const row = el('div', 'sideprev');
    for (const side of this.config.sides) {
      const isActive = side.id === this.state.side;
      const cell = el('button', 'sideprev__cell' + (isActive ? ' is-active' : ''));
      cell.type = 'button';
      cell.setAttribute('aria-pressed', String(isActive));
      cell.setAttribute('aria-label', 'Показать сторону: ' + side.label);

      const box = el('div', 'sideprev__box');
      const img = el('img', 'sideprev__img');
      img.src = form?.images?.[side.id] ?? '';
      img.alt = side.label;
      img.loading = 'lazy';
      box.append(img);

      // Нанесения: координаты хранятся в долях РАМКИ, пересчитываем в доли мокапа.
      const zone = this.zoneFor(side.id);
      if (zone) {
        for (const d of this.layers.list(side.id)) {
          const b = printBoxOnMockup(zone.box, d);
          const item = el('div', 'sideprev__item');
          Object.assign(item.style, {
            left: b.x * 100 + '%', top: b.y * 100 + '%',
            width: b.w * 100 + '%', height: b.h * 100 + '%',
          });
          if ((d.kind ?? 'print') === 'text') {
            const t = el('div', 'sideprev__text', d.text);
            t.style.color = d.color || '#111';
            item.append(t);
          } else {
            const pi = el('img', 'sideprev__print');
            pi.src = d.src;
            pi.alt = '';
            item.append(pi);
          }
          box.append(item);
        }
      }

      cell.append(box);
      cell.addEventListener('click', () => {
        if (this.state.side !== side.id) { this.state.side = side.id; this.render(); }
      });
      row.append(cell);
    }
    field.append(row);

    // Переключатель под превью — дублирует выбор, как в макете.
    field.append(this.segField('Сторона нанесения',
      this.config.sides.map(s => ({ value: s.id, label: s.label })),
      this.state.side, v => { this.state.side = v; this.render(); }));
    return field;
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

    // Детализация: клиент на макете держит её свёрнутой, чтобы панель не разрасталась.
    const details = document.createElement('details');
    details.className = 'order__details';
    details.open = this.state.detailsOpen ?? false;
    details.addEventListener('toggle', () => { this.state.detailsOpen = details.open; });
    const summary = document.createElement('summary');
    summary.className = 'order__details-sum';
    summary.textContent = 'Детализация';
    details.append(summary);

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
      details.append(block);
    }
    if (!hasAny) {
      details.append(el('div', 'order__empty', 'Нанесений пока нет — добавьте принт или надпись.'));
    }

    // Разбивка цены.
    const br = el('div', 'order__breakdown');
    br.append(rowLine('Футболка', order.price.base + ' ₽'));
    if (order.price.prints > 0) br.append(rowLine('Принты', order.price.prints + ' ₽'));
    if (order.price.texts > 0) br.append(rowLine('Надпись', order.price.texts + ' ₽'));
    details.append(br);
    sec.append(details);

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