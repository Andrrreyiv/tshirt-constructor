// TshirtApp — оркестратор редактора (адаптация jetron UniformApp).
// Раскладка v3 (макет клиента 28.07): сцена показывает ОДНУ активную сторону крупно,
// цвет и фасон выбираются под макетом, правая панель — параметры + липкий итог с CTA.
// Активная сторона (клик по карточке) — та, куда добавляются принт и текст.

import { PrintFrame } from '../tshirt/PrintFrame.js?v=20260801c';
import { alignBoxToCm, deriveBox } from '../tshirt/ZoneBox.js?v=20260801c';
import { CmScaler } from '../tshirt/CmScaler.js?v=20260801c';
import { LayerManager } from '../tshirt/LayerManager.js?v=20260801c';
import { StepPrice } from '../tshirt/StepPrice.js?v=20260801c';
import { TextPrice } from '../tshirt/TextPrice.js?v=20260801c';
import { PrintEditor } from '../tshirt/PrintEditor.js?v=20260801c';
import { buildOrder } from '../tshirt/OrderBuilder.js?v=20260801c';
import { QualityHint } from '../tshirt/QualityHint.js?v=20260801c';
import { Recolor } from '../tshirt/Recolor.js?v=20260801c';
import { LibraryPanel } from '../tshirt/LibraryPanel.js?v=20260801c';
import { colorTone } from '../tshirt/PrintTone.js?v=20260801c';
import { printBoxOnMockup } from '../tshirt/BoxFit.js?v=20260801c';
import { zoneInCrop, mockupTransform, FULL_CROP } from '../tshirt/Crop.js?v=20260801c';
import { textFontFamily } from '../tshirt/PrintEditor.js?v=20260801c';

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
    // id надписи, которая правится прямо во время набора (клиент 01.08, без кнопки «Добавить»)
    this.state.liveTextId = null;
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
      // Владелец правит коробку для взрослой зоны; детская выводится от центра,
      // ЕСЛИ он не задал её отдельно. Клиент 01.08: «в детской не могу увеличить
      // квадрат» — раньше она жёстко считалась как 30/40 от взрослой и потолок был
      // непреодолим. Своя сохранённая детская коробка теперь побеждает.
      const adultBox = alignBoxToCm(src.box, adultCm, stageAspect);
      const ownChild = this.state.age === 'child' && this.config.childZones
        ? this.config.childZones[src.view]
        : null;
      const box = ageCm === adultCm
        ? adultBox
        : (ownChild ? alignBoxToCm(ownChild, ageCm, stageAspect) : deriveBox(adultBox, adultCm, ageCm));
      const zone = { ...src, box: alignBoxToCm(box, ageCm, stageAspect), cm: { ...ageCm } };
      this.zones[zone.view] = zone;
      // Рамка живёт над кадрированной картинкой, поэтому её координаты — от видимой части.
      // Сантиметры не трогаем: CmScaler считает от физической зоны, кадр на них не влияет.
      const shown = { ...zone, box: zoneInCrop(zone.box, this.currentCrop()) };
      this.frames[zone.view] = new PrintFrame(shown, canvas);
      this.scalers[zone.view] = new CmScaler(shown, canvas, this.config.printSize);
    }
  }

  /** Зона стороны с учётом возраста, в долях ВСЕГО мокапа (редактор правит именно её). */
  zoneFor(view) {
    return (this.zones && this.zones[view]) || this.config.zoneTemplate.find(z => z.view === view);
  }

  /** Кадр текущего мокапа: режет серые поля, чтобы футболка была крупнее (клиент 30.07). */
  currentCrop() {
    // Пока владелец правит кадр в редакторе, картинку показываем целиком: иначе он
    // не увидит, что именно срезает.
    if (this._suppressCrop) return FULL_CROP;
    const form = this.currentForm();
    return (form && this.config.crops && this.config.crops[form.id]) || FULL_CROP;
  }

  /**
   * Зона в долях ВИДИМОЙ части мокапа. Именно ею позиционируется рамка и нанесения:
   * зоны хранятся от всей картинки, а показываем мы её кадрированной.
   */
  zoneView(view) {
    const zone = this.zoneFor(view);
    if (!zone) return null;
    return { ...zone, box: zoneInCrop(zone.box, this.currentCrop()) };
  }

  /** Применить кадр к картинке мокапа. Без кадрирования ничего не трогаем. */
  applyCropTo(img) {
    const st = mockupTransform(this.currentCrop());
    if (!st) return;
    img.style.transformOrigin = st.transformOrigin;
    img.style.transform = st.transform;
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

      const wrap = el('div', 'canvas-wrap' + (isActive ? ' is-active' : ''));
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('aria-pressed', String(isActive));
      wrap.setAttribute('aria-label', 'Выбрать сторону: ' + side.label);

      const inner = el('div', 'stage__canvas'); // сжимается по картинке → % рамки = % мокапа
      const img = el('img', 'stage__img');
      img.src = form?.images?.[side.id] ?? '';
      this.applyCropTo(img);
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

    // Кнопка «Скачать макет» (клиент 30.07: «в конструкторе футболок её нет, мы про неё забыли»).
    // Место то же, что в конструкторе формы: отдельной строкой над выбором цвета.
    const dl = el('div', 'cp-download');
    const dlBtn = el('button', 'stage-btn', 'Скачать макет');
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', () => {
      dlBtn.disabled = true;
      this.downloadMockup()
        .catch(() => alert('Не удалось собрать макет. Попробуйте ещё раз.'))
        .finally(() => { dlBtn.disabled = false; });
    });
    dl.append(dlBtn);
    this.colorEl.append(dl);

    // Макет клиента 30.07: слева «ЦВЕТ: …» со свотчами, справа пояснение к выбранному цвету.
    const grid = el('div', 'cp-grid');
    const left = el('div', 'cp-left');
    const head = el('div', 'cp-head');
    const title = el('div', 'cp-title');
    title.append(document.createTextNode('Цвет: '), el('b', '', form?.color ?? '—'));
    head.append(title);
    left.append(head);

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
        sw.addEventListener('click', () => { this.state.colorId = color.id; this.buildZones(); this.render(); });
      }
      palette.append(sw);
    }
    left.append(palette);
    grid.append(left);

    // Пояснение к выбранному цвету (config.colors[].note). Пустое поле просто скрывает блок.
    // Блок «Фасон» с каруселью убран 30.07: он дублировал «Тип футболки» в панели,
    // в макете клиента его нет.
    const note = c.colors.find(x => x.id === this.state.colorId)?.note;
    if (note) grid.append(el('p', 'cp-note', note));
    this.colorEl.append(grid);
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
    this.buildZones();   // кадр свой у каждой модели — пересобираем рамки
    this.render();
  }

  renderPanel() {
    const c = this.config;
    this.panelEl.innerHTML = '';

    // Заголовка «Конструктор футболок» и подзаголовка в макете клиента 30.07 нет:
    // название есть на самой странице сайта, в панели оно только съедало высоту.
    // Изделие — секция без заголовка, как в макете.
    // Клиент 01.08 (голос): «без разделов блоков, без отдельно добавить дизайн,
    // без надписей, без подписей, без всего, вот один в один… там заголовки эти все
    // убрать, объединить блок, где добавить дизайн у нас отдельным блоком идёт».
    // Поэтому изделие и дизайн живут в ОДНОЙ карточке и без единой подписи.
    const product = section();
    // Таблица размеров живёт ВНУТРИ серого блока линейки (клиент 30.07: «серый блок увеличить
    // вниз чуть-чуть и туда вставить эти взрослые размеры, а то они очень много места занимают
    // и всё у нас ползает вниз»). Отдельным полем она распирала панель при каждом раскрытии.
    product.append(this.segField(null,
      [{ value: 'adult', label: 'Взрослая' }, { value: 'child', label: 'Детская' }],
      this.state.age, v => { this.state.age = v; this.buildZones(); this.render(); },
      this.sizesField()));
    product.append(this.segField(null, this.typeOptions(),
      this.state.type, v => this.pickType(v)));
    product.append(this.segField(null,
      c.densities.map(d => ({ value: d.g, label: d.g + ' г', sub: d.label.split('—')[1]?.trim() })),
      this.state.densityG, v => { this.state.densityG = Number(v); this.render(); }));
    // Превью сторон и выбор стороны: в макете клиента они идут сразу под плотностью.
    product.append(this.sidePreviewField());

    // Дизайн: принт, затем надпись, затем метод нанесения — порядок из макета клиента.
    // Подпись «до N принтов на сторону» убрана 30.07: в макете её нет, а потолок
    // и так виден по сообщению при попытке добавить третий принт.
    product.append(this.libraryField());
    product.append(this.textField());
    product.append(this.segField(null,
      Object.entries(c.prices.print.methods).map(([id, m]) => ({ value: id, label: m.label })),
      this.state.printMethod, v => { this.state.printMethod = v; this.render(); }));
    this.panelEl.append(product);

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
      this.applyCropTo(img);
      box.append(img);

      // Нанесения: координаты хранятся в долях РАМКИ, пересчитываем в доли ВИДИМОЙ части
      // мокапа — превью тоже кадрировано, поэтому берём zoneView, а не сырую зону.
      const zone = this.zoneView(side.id);
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
            // Тем же шрифтом, что и на макете: превью обещает то, что уйдёт в печать.
            if (d.fontId) t.style.fontFamily = textFontFamily(d.fontId);
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

    // Переключатель под превью — дублирует выбор, как в макете. Без подписи (клиент 01.08).
    field.append(this.segField(null,
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
    const sec = section();
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

  /**
   * Строка надписи по макету клиента 30.07: «Добавить текст» слева, бейдж «Шрифт и цвет»
   * справа. Пока поле пустое, строка выглядит ровно как в макете (подпись — это placeholder).
   * Кнопка «Добавить» появляется только когда есть что добавлять.
   * Бейдж раскрывает выбор шрифта (ТЗ п.69) и цвета (U8 — полный RGB-пикер).
   */
  textField() {
    const field = el('div', 'field');

    const row = el('div', 'design-row design-row--text');
    const input = el('input', 'design-row__input');
    input.type = 'text';
    input.placeholder = 'Добавить текст';
    input.value = this.state.textInput;
    input.setAttribute('aria-label', 'Текст надписи');
    // Клиент 01.08: «убрать кнопочку добавить, она очень сильно сужает поле… как только
    // он начал что-то печатать, автоматически всё переносится на футболку, и он сразу
    // видит, что печатает». Кнопки больше нет, надпись живёт прямо во время набора.
    input.addEventListener('input', () => this.liveText(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

    const badge = el('button', 'text-badge');
    badge.type = 'button';
    badge.setAttribute('aria-expanded', String(this.state.textOptsOpen === true));
    badge.append(el('span', 'text-badge__dot'), document.createTextNode('Шрифт и цвет'));

    row.append(input, badge);
    field.append(row);

    const opts = el('div', 'text-opts');
    opts.hidden = this.state.textOptsOpen !== true;
    opts.append(this.fontList());
    const colorRow = el('label', 'text-opts__color');
    colorRow.append(el('span', '', 'Цвет надписи'));
    const color = el('input', 'text-opts__picker');
    color.type = 'color'; // U8: полный RGB-пикер, в отличие от цветов изделия
    color.value = this.state.textColor;
    color.addEventListener('input', () => {
      this.state.textColor = color.value;
      for (const s of opts.querySelectorAll('.font-opt__sample')) s.style.color = color.value;
    });
    colorRow.append(color);
    opts.append(colorRow);
    field.append(opts);

    badge.addEventListener('click', () => {
      this.state.textOptsOpen = this.state.textOptsOpen !== true;
      opts.hidden = !this.state.textOptsOpen;
      badge.setAttribute('aria-expanded', String(this.state.textOptsOpen));
    });
    return field;
  }

  /** Список шрифтов: образец нарисован самим шрифтом, чтобы выбирали глазами. */
  fontList() {
    const box = el('div', 'font-list');
    for (const f of this.config.fonts ?? []) {
      const isActive = f.id === this.currentFontId();
      const btn = el('button', 'font-opt' + (isActive ? ' font-opt--active' : ''));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(isActive));
      const sample = el('span', 'font-opt__sample', f.name);
      sample.style.fontFamily = textFontFamily(f.id);
      sample.style.color = this.state.textColor;
      btn.append(sample);
      btn.addEventListener('click', () => { this.state.fontId = f.id; this.render(); });
      box.append(btn);
    }
    return box;
  }

  /** Выбранный шрифт надписи; по умолчанию первый из конфига. */
  currentFontId() {
    return this.state.fontId ?? this.config.fonts?.[0]?.id ?? null;
  }

  /**
   * Надпись во время набора: первый символ создаёт слой, дальше правится тот же,
   * пустое поле убирает надпись с футболки. Клиент 01.08 просил убрать кнопку
   * «Добавить» и показывать текст сразу.
   *
   * ⚠️ Панель здесь НЕ перерисовывается целиком: renderPanel() пересоздал бы поле
   * ввода, и фокус слетал бы на каждом символе. Обновляем только сам слой и цену.
   */
  liveText(value) {
    this.state.textInput = value;
    const editor = this.activeEditor();
    if (!editor) return;
    const text = value.trim();

    if (!text) {
      if (this.state.liveTextId) {
        editor.removeLayer(this.state.liveTextId, { silent: true });
        this.state.liveTextId = null;
      }
      this.updatePrice();
      return;
    }
    if (this.state.liveTextId && editor.updateTextLayer(this.state.liveTextId, text)) {
      this.updatePrice();
      return;
    }
    // Слоя ещё нет (или он остался на другой стороне) — заводим новый.
    const id = editor.addText({
      text, color: this.state.textColor, fontId: this.currentFontId(), silent: true,
    });
    this.state.liveTextId = typeof id === 'string' ? id : null;
    this.updatePrice();
  }

  /** Принт, уже положенный на активную сторону — он и показывается миниатюрой в строке. */
  activePrintSrc() {
    const prints = this.layers.list(this.state.side).filter(d => (d.kind ?? 'print') === 'print');
    return prints.length ? prints[prints.length - 1].src : null;
  }

  libraryField() {
    const field = el('div', 'field');
    const libEl = el('div', 'lib');
    // Библиотека показывает принты под цвет выбранного изделия (клиент 01.08). Тон сообщаем
    // здесь, а не в обработчике свотча: сюда попадаем при КАЖДОЙ перерисовке, поэтому смена
    // цвета любым путём (свотч, смена фасона со сбросом цвета) учитывается одинаково.
    const color = (this.config.colors || []).find(x => x.id === this.state.colorId);
    this.library.setTone(colorTone(color));
    // Клиент 28.07: библиотека вынесена в отдельное окно, в панели только строка вызова.
    // Подсказки под строкой в макете 30.07 нет — сторона видна по выделенному превью
    // и переключателю «Сторона нанесения» прямо над блоком.
    this.library.renderTrigger(libEl, {
      thumbSrc: this.activePrintSrc(),
      onOpen: () => this.library.openModal({
        onPick: (src) => this.addPrint(src),
        onUpload: (file) => this.uploadPrint(file),
      }),
    });
    field.append(libEl);
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

  /**
   * Поле-сегмент. Необязательный extra кладётся ВНУТРЬ серого контейнера под кнопками:
   * так таблица размеров не распирает панель, а разворачивается внутри блока (клиент 30.07).
   */
  /**
   * Ряд кнопок-переключателей. Подпись НЕОБЯЗАТЕЛЬНА: клиент 01.08 попросил панель
   * «без разделов блоков, без надписей, без подписей, без всего, вот один в один»
   * по своему макету, поэтому подписи полей больше не выводятся.
   */
  segField(label, options, active, onPick, extra = null) {
    const field = el('div', 'field');
    if (label) field.append(el('div', 'field__label', label));
    const seg = el('div', 'seg' + (extra ? ' seg--stack' : ''));
    const row = extra ? el('div', 'seg__row') : seg;
    for (const opt of options) {
      const isActive = String(opt.value) === String(active);
      const btn = el('button', 'seg__btn' + (isActive ? ' seg__btn--active' : ''));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(isActive));
      btn.append(document.createTextNode(opt.label));
      if (opt.sub) btn.append(el('small', '', opt.sub));
      btn.addEventListener('click', () => onPick(opt.value));
      row.append(btn);
    }
    if (extra) seg.append(row, extra);
    field.append(seg);
    return field;
  }

  sizesField() {
    // Подпись всегда «Таблица размеров» (клиент 30.07): раньше стояло «Взрослые размеры»
    // из заголовка сетки, и при переключении линейки текст прыгал.
    const field = el('div', 'sizes-wrap');
    const table = this.config.sizes[this.state.age];

    const toggle = el('button', 'sizes-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(this.state.sizesOpen));
    toggle.append(el('span', '', 'Таблица размеров'), el('span', 'chev', '▾'));

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

  // ── Скачать макет (клиент 30.07) ─────────────────────────────────────────
  // Конструктор футболок рисует нанесения обычным DOM, а не Fabric, поэтому холст
  // собираем вручную: мокап в натуральную величину, поверх принты и надписи по тем же
  // долям, что и на экране (printBoxOnMockup — та же математика, что в превью сторон).
  async downloadMockup() {
    const sides = [];
    for (const side of this.config.sides) {
      const c = await this._composeSide(side.id);
      if (c) sides.push({ label: side.label, canvas: c });
    }
    if (!sides.length) return;

    const pad = 24, gap = 24, labelH = 34;
    const maxH = Math.max(...sides.map(s => s.canvas.height));
    const totalW = sides.reduce((n, s) => n + s.canvas.width, 0) + gap * (sides.length - 1) + pad * 2;
    const out = document.createElement('canvas');
    out.width = totalW;
    out.height = maxH + labelH + pad * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = '600 22px -apple-system, Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    let x = pad;
    for (const s of sides) {
      ctx.fillText(s.label, x + s.canvas.width / 2, pad + 24);
      ctx.drawImage(s.canvas, x, pad + labelH);
      x += s.canvas.width + gap;
    }

    const form = this.currentForm();
    const name = ['jetron', form?.type ?? 'futbolka', form?.colorId ?? ''].filter(Boolean).join('-');
    const a = document.createElement('a');
    a.download = name + '.png';
    a.href = out.toDataURL('image/png');
    a.click();
  }

  /** Один холст стороны: мокап в натуральную величину плюс все нанесения. */
  async _composeSide(sideId) {
    const form = this.currentForm();
    const src = form?.images?.[sideId];
    if (!src) return null;
    const base = await loadPic(src);
    const srcW = base.naturalWidth || base.width;
    const srcH = base.naturalHeight || base.height;
    // Макет отдаём таким же кадром, какой видит покупатель: режем те же серые поля.
    const crop = this.currentCrop();
    const sx = crop.x * srcW, sy = crop.y * srcH;
    const sw = crop.w * srcW, sh = crop.h * srcH;
    const W = Math.round(sw), H = Math.round(sh);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, sx, sy, sw, sh, 0, 0, W, H);

    const zone = this.zoneView(sideId);   // доли видимой части — совпадают с холстом кадра
    if (!zone) return c;
    const frameH = zone.box.h * H;    // высота рамки в пикселях — от неё считается кегль

    for (const d of this.layers.list(sideId)) {
      const b = printBoxOnMockup(zone.box, d);
      const bx = b.x * W, by = b.y * H, bw = b.w * W, bh = b.h * H;
      if ((d.kind ?? 'print') === 'text') {
        // Кегль повторяет экранный: высота рамки × доля высоты слоя × 0.6 (см. _applyTextSize).
        const size = Math.max(8, frameH * d.fh * 0.6);
        const family = d.fontId ? textFontFamily(d.fontId) : 'var(--font-display), Oswald, Arial, sans-serif';
        const font = '700 ' + size + 'px ' + family;
        try { await document.fonts.load(font, d.text); } catch { /* шрифт не подгрузился — рисуем запасным */ }
        ctx.save();
        ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
        ctx.font = font;
        ctx.fillStyle = d.color || '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, bx + bw / 2, by + bh / 2);
        ctx.restore();
      } else {
        const im = await loadPic(d.src);
        // На экране у принта object-fit: contain — повторяем, иначе картинку растянет.
        const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
        const k = Math.min(bw / iw, bh / ih);
        const w = iw * k, h = ih * k;
        ctx.drawImage(im, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
      }
    }
    return c;
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

/** Карточка панели. Без заголовка — секция изделия в макете клиента идёт без него. */
function section(title, note) {
  const sec = document.createElement('section');
  if (title) {
    const h = el('h3', '', title);
    if (note) h.append(el('small', '', note));
    sec.append(h);
  }
  return sec;
}

function rowLine(label, value) {
  const row = el('div', 'order__row');
  row.append(el('span', 'order__row-label', label), el('span', 'order__row-value', value));
  return row;
}


function sideLabel(config, sideId) {
  return config.sides.find(s => s.id === sideId)?.label ?? sideId;
}

/** Промис-обёртка над загрузкой картинки для сборки макета. */
function loadPic(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}