// TshirtApp — оркестратор редактора (адаптация jetron UniformApp).
// Раскладка v3 (макет клиента 28.07): сцена показывает ОДНУ активную сторону крупно,
// цвет и фасон выбираются под макетом, правая панель — параметры + липкий итог с CTA.
// Активная сторона (клик по карточке) — та, куда добавляются принт и текст.

import { PrintFrame } from '../tshirt/PrintFrame.js?v=20260920c';
import { alignBoxToCm, deriveBox } from '../tshirt/ZoneBox.js?v=20260920c';
import { CmScaler } from '../tshirt/CmScaler.js?v=20260920c';
import { visibleTypes, visibleDensities } from '../tshirt/AdminOverrides.js?v=20260920c';
import { orderSpec } from '../tshirt/OrderSpec.js?v=20260920c';
import { LayerManager } from '../tshirt/LayerManager.js?v=20260920c';
import { StepPrice } from '../tshirt/StepPrice.js?v=20260920c';
import { TextPrice } from '../tshirt/TextPrice.js?v=20260920c';
import { PrintEditor } from '../tshirt/PrintEditor.js?v=20260920c';
import { buildOrder } from '../tshirt/OrderBuilder.js?v=20260920c';
import { QualityHint } from '../tshirt/QualityHint.js?v=20260920c';
import { Recolor } from '../tshirt/Recolor.js?v=20260920c';
import { LibraryPanel } from '../tshirt/LibraryPanel.js?v=20260920c';
import { colorTone } from '../tshirt/PrintTone.js?v=20260920c';
import { sidesToExport } from '../tshirt/MockupExport.js?v=20260920c';
import { printBoxOnMockup } from '../tshirt/BoxFit.js?v=20260920c';
import { zoneInCrop, mockupTransform, FULL_CROP } from '../tshirt/Crop.js?v=20260920c';
import { textFontFamily } from '../tshirt/PrintEditor.js?v=20260920c';
import { forcedMethod } from '../tshirt/PrintMethod.js?v=20260920c';
import { PanelAccordion } from './PanelAccordion.js?v=20260920c';

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
    };

    // Раскрывающиеся поля (шрифты, таблица размеров, детализация) держит один аккордеон:
    // клиент 26.08 требует, чтобы клик по любому другому полю сворачивал открытое.
    this.panels = new PanelAccordion();
    /** @type {Record<string, {root: Element, apply: (open: boolean) => void}>} */
    this.panelRefs = {};

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
    this._guardImages();
    this.buildZones();
    this._wireAccordion();
    this.render();
  }

  /**
   * Зарегистрировать раскрывающееся поле и сразу привести его к состоянию аккордеона.
   * Панель пересобирается на каждом действии, поэтому раскрытое поле обязано пережить
   * пересборку, а свёрнутое — не всплыть обратно.
   */
  _registerPanel(name, root, apply) {
    this.panelRefs[name] = { root, apply };
    apply(this.panels.isOpen(name));
  }

  /**
   * Единственный сторож на всю страницу: клик мимо открытого поля его сворачивает.
   * Клиент 26.08 (голос 11-13-26): «а потом перешёл к другому полю… в любое поле кликнул —
   * то вот это поле должно сворачиваться… чтобы нам пространство не расширять».
   *
   * ⚠️ Фаза ПЕРЕХВАТА, а не всплытия: обработчик самой кнопки обязан сработать ПОСЛЕ нас,
   * иначе клик по чужой кнопке открыл бы её поле, а мы бы тут же его закрыли.
   * ⚠️ Подписка вешается ОДИН раз в start(), а не в renderPanel(): панель пересобирается
   * на каждом действии, и подписки оттуда копились бы десятками.
   */
  _wireAccordion(doc = (typeof document === 'undefined' ? null : document)) {
    if (!doc) return;
    doc.addEventListener('click', (e) => {
      const ref = this.panelRefs[this.panels.open];
      // Кнопка поля лежит внутри его же корня, поэтому клик по ней считается «внутри»:
      // сворачивать обязан её собственный toggle, иначе выйдет закрыл-и-сразу-открыл.
      const inside = !!(ref && ref.root && ref.root.contains(e.target));
      if (this.panels.closeIfOutside(inside)) this._syncPanels();
    }, true);
  }

  /** Единственная точка правды: развернуть открытое поле, свернуть все прочие. */
  _syncPanels() {
    for (const name of Object.keys(this.panelRefs)) {
      this.panelRefs[name].apply(this.panels.isOpen(name));
    }
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
          // Порядок важен: onRemove правит state, и уже ПОСЛЕ него onChange
          // пересобирает панель — иначе поле ввода отрисовалось бы со старым текстом.
          onRemove: (d) => this.forgetLayer(d),
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
    // Подпись и видимость фасона идут из настроек админки (раздел formTypes), значение — из
    // каталога изделий. Клиент 12.09: «Короткий рукав поменять на "Базовая"», «добавить третью
    // кнопку "Длинный рукав"», «дать возможность отключать эти кнопки из видимости».
    return visibleTypes(this.config);
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
    // Узлы прежней сборки выброшены — ссылки на них тоже, иначе сторож аккордеона
    // держал бы уже мёртвый корень и `contains` всегда врал бы «клик снаружи».
    this.panelRefs = {};

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
    // Скрытые в админке плотности покупателю не показываем, но из каталога не удаляем:
    // цена по ним могла уже уйти в заказ.
    product.append(this.segField(null,
      visibleDensities(c).map(d => ({ value: d.g, label: d.g + ' г', sub: d.label.split('—')[1]?.trim() })),
      this.state.densityG, v => { this.state.densityG = Number(v); this.render(); }));
    // Превью сторон и выбор стороны: в макете клиента они идут сразу под плотностью.
    product.append(this.sidePreviewField());

    // Дизайн: принт, затем надпись, затем метод нанесения — порядок из макета клиента.
    // Подпись «до N принтов на сторону» убрана 30.07: в макете её нет, а потолок
    // и так виден по сообщению при попытке добавить третий принт.
    product.append(this.libraryField());
    product.append(this.textField());
    // Метод нанесения НЕ выбирается: он выведен из того, что покупатель положил на футболку.
    // Клиент 25.08: «не надо ему выбора такой ошибочный давать… она плёнкой дешевле,
    // они будут тыкать плёнкой, а потом лишнее объяснять им, что плёнкой не получится».
    // Гнездо постоянное, содержимое обновляет refreshMethodField(): набор надписи идёт
    // в тихом режиме и панель целиком не пересобирает.
    this.methodSlot = el('div', 'method-slot');
    product.append(this.methodSlot);
    this.refreshMethodField();
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

  /**
   * Собрать сериализуемый итог заказа из текущего состояния (единый источник цены).
   * Метод нанесения догоняется ЗДЕСЬ, а не только в панели: набор надписи идёт в тихом
   * режиме (панель не пересобирается, чтобы не слетал фокус), и цена иначе считалась бы
   * по прежнему методу.
   */
  currentOrder() {
    this.syncPrintMethod();
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
    // Клиент 26.08: «если он детализацию открыл, а потом пошёл опять нажимать другие
    // кнопки, то детализация тоже автоматически схлопывается в изначальную строчку».
    // `<details>` раскрывает сам браузер, поэтому состояние догоняем из события toggle.
    // Рекурсии нет: apply меняет `open`, только если он и правда другой, а обработчик
    // на уже согласованном состоянии ничего не делает.
    this._registerPanel('details', details, (open) => {
      if (details.open !== open) details.open = open;
    });
    details.addEventListener('toggle', () => {
      if (details.open) { this.panels.openOnly('details'); this._syncPanels(); }
      else if (this.panels.isOpen('details')) this.panels.toggle('details');
    });
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
    cta.onclick = () => this.showOrder();
    sec.append(cta);
    sec.append(el('div', 'hint price-note', 'Цена предварительная. Менеджер подтвердит перед оплатой.'));

    return sec;
  }

  /**
   * Строка надписи. Клиент 20.09 голосом о ДВУХ вещах сразу:
   *   1. «где поле добавить текст, как-то его выделить, а то его по факту нет» — поле было
   *      без рамки и фона на кремовой плашке и читалось как подпись, а не как поле ввода;
   *   2. «можете эти кнопки в конструктор футболок добавить» — те же две кнопки «Шрифт»
   *      и «Цвет», что сделаны 20.09 в конструкторе формы вместо мелкой ссылки.
   * Поэтому вместо бейджа «Шрифт и цвет» под полем стоят две кнопки, и на каждой видно
   * текущее значение (имя шрифта, кружок цвета) ещё до нажатия.
   * ⛔ Механика прежняя: список выезжает ВНИЗ прямо в поле и сдвигает блоки под собой,
   * всплывающих окон поверх футболки нет. Открыта всегда ровно одна панель.
   * Выбор цвета остаётся полным RGB-пикером (U8), а не набором свотчей.
   */
  textField() {
    const field = el('div', 'field');

    const row = el('div', 'design-row design-row--text');
    const input = el('input', 'design-row__input');
    input.type = 'text';
    // Клиент 20.09 (голосовое 14:42): «эту фразу добавить текст нужно вставить в поле, где
    // написано например Маша… убрать надпись добавить текст, она не нужна, просто мы внутри
    // в этом поле напишем добавить текст, и люди и так поймут».
    input.placeholder = 'Добавить текст';
    input.value = this.state.textInput;
    input.setAttribute('aria-label', 'Текст надписи');
    // Клиент 01.08: «убрать кнопочку добавить, она очень сильно сужает поле… как только
    // он начал что-то печатать, автоматически всё переносится на футболку, и он сразу
    // видит, что печатает». Кнопки больше нет, надпись живёт прямо во время набора.
    input.addEventListener('input', () => this.liveText(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

    row.append(input);

    // Кнопки живут ВНУТРИ бежевой плашки, на всю её ширину, и сделаны тем же сегментом,
    // что «Грудь / Спина» (клиент 20.09: «они не выходят из этого блока… они отдельно
    // и на всю ширину самого этого блока… вместо грудь и спина… кнопку шрифт в белом фоне
    // залить, а цвет сделать залипшим»). Выбранная кнопка залита белым, как там.
    const seg = el('div', 'seg text-seg');
    const fontBtn = el('button', 'seg__btn');
    fontBtn.type = 'button';
    fontBtn.append(document.createTextNode('Шрифт'), el('small', '', this.currentFontName()));
    const colorBtn = el('button', 'seg__btn');
    colorBtn.type = 'button';
    const dot = el('small', 'text-seg__dot');
    dot.style.background = this.state.textColor;
    colorBtn.append(document.createTextNode('Цвет'), dot);
    seg.append(fontBtn, colorBtn);
    row.append(seg);
    field.append(row);

    const opts = el('div', 'text-opts');
    const fontBox = this.fontList();
    opts.append(fontBox);
    // Клиент 20.09: «может тогда уже всё сделаем как здесь, сможете добавить эти же цвета
    // и убрать надпись Цвет надписи» — показывал конструктор ФОРМЫ. Поэтому здесь те же семь
    // свотчей, что у формы, и без подписи над ними.
    // ⚠️ Это отменяет U8 ТЗ (полный RGB-пикер) по прямой просьбе клиента. Вернуть пикер =
    // вернуть input[type=color] сюда же.
    // ⚠️ Названия шрифтов от цвета надписи НЕ красим. Клиент 26.08 (голос 11-05-58): «сделал
    // футболку чёрный и поменял шрифт на белый цвет… где поля выбор шрифтов, они стали белыми,
    // их вообще не видно». Цвет образцов задан в CSS и от state не зависит.
    const colorRow = el('div', 'text-opts__color');
    for (const тон of this.config.textColors ?? []) {
      const выбран = String(тон.hex).toLowerCase() === String(this.state.textColor).toLowerCase();
      const sw = el('button', 'swatch swatch--text' + (выбран ? ' swatch--active' : ''));
      sw.type = 'button';
      sw.style.background = тон.hex;
      sw.title = тон.name;
      sw.setAttribute('aria-label', 'Цвет надписи: ' + тон.name);
      sw.setAttribute('aria-pressed', String(выбран));
      sw.addEventListener('click', () => {
        this.state.textColor = тон.hex;
        dot.style.background = тон.hex; // кружок на кнопке «Цвет» — сразу, до перерисовки
        this.restyleTextLayers({ color: тон.hex });
        this.render();
      });
      colorRow.append(sw);
    }
    opts.append(colorRow);
    field.append(opts);

    // Корень поля — весь `field`: и кнопки, и список шрифтов, и пикер цвета. Клик по
    // любому из них считается «внутри», а значит выбор шрифта список не захлопывает.
    // Какая из двух панелей раскрыта, помнит `_textPanel`: render() пересобирает поле
    // целиком, и без этого список схлопывался бы после каждого выбора шрифта.
    this._registerPanel('text', field, (open) => {
      const какая = open ? (this._textPanel || 'font') : '';
      if (!open) this._textPanel = '';
      opts.hidden = !open;
      fontBox.hidden = какая !== 'font';
      colorRow.hidden = какая !== 'color';
      fontBtn.className = 'seg__btn' + (какая === 'font' ? ' seg__btn--active' : '');
      colorBtn.className = 'seg__btn' + (какая === 'color' ? ' seg__btn--active' : '');
      fontBtn.setAttribute('aria-pressed', String(какая === 'font'));
      colorBtn.setAttribute('aria-pressed', String(какая === 'color'));
    });
    // Повторное нажатие той же кнопки закрывает, соседняя — подменяет содержимое.
    const переключить = (какая) => {
      if (this._textPanel === какая && this.panels.isOpen('text')) {
        this.panels.toggle('text');
        this._textPanel = '';
      } else {
        this._textPanel = какая;
        this.panels.openOnly('text');
      }
      this._syncPanels();
    };
    fontBtn.addEventListener('click', () => переключить('font'));
    colorBtn.addEventListener('click', () => переключить('color'));
    return field;
  }

  /** Имя текущего шрифта — оно стоит прямо на кнопке «Шрифт». */
  currentFontName() {
    const id = this.currentFontId();
    const f = (this.config.fonts ?? []).find((x) => x.id === id);
    return f ? f.name : '';
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
      // Цвет образца НЕ берётся из state.textColor: на белой надписи список пропадал
      // на белом фоне панели (клиент 26.08). Название шрифта всегда тёмное, из CSS.
      btn.append(sample);
      btn.addEventListener('click', () => {
        this.state.fontId = f.id;
        this.restyleTextLayers({ fontId: f.id });
        this.render();
      });
      box.append(btn);
    }
    return box;
  }

  /**
   * Переодеть УЖЕ созданные надписи: сперва дескрипторы (иначе следующая перерисовка
   * вернёт старое), затем живые узлы обеих сторон по месту.
   * ⚠️ Клиент 25.08: «я меняю шрифты, а надпись не меняется… только изначально, когда
   * выбрал шрифт, он тем шрифтом и написал». Возвращает число тронутых надписей.
   */
  restyleTextLayers(patch) {
    const n = this.layers.restyleKind('text', patch);
    for (const ed of Object.values(this.editors)) {
      if (ed && typeof ed.refreshTextStyle === 'function') ed.refreshTextStyle();
    }
    return n;
  }

  /**
   * Догнать метод нанесения содержимым футболки. Возвращает выведенный метод либо null,
   * если на футболке пусто (тогда состояние не трогаем: цена печати всё равно нулевая).
   * ⚠️ Клиент 25.08: «не надо ему выбора такой ошибочный давать, она плёнкой дешевле,
   * они будут тыкать плёнкой, а потом лишнее объяснять им, что это плёнкой не получится».
   */
  syncPrintMethod() {
    const m = forcedMethod({
      hasPrint: this.layers.hasKind('print'),
      hasText: this.layers.hasKind('text'),
    });
    if (m) this.state.printMethod = m;
    return m;
  }

  /**
   * Поле метода нанесения. Выбора здесь НЕТ: показывается ровно один метод, выведенный
   * из содержимого футболки. Клиент 25.08: «просто залипшую кнопку плёнкой, и всё,
   * ничем поменять не может… если он выбрал принт, там кнопку плёнка убираем».
   */
  methodField() {
    const id = this.syncPrintMethod();
    if (!id) return null; // на пустой футболке печатать нечего
    const methods = this.config.prices?.print?.methods ?? {};
    const label = methods[id]?.label ?? id;
    // onPick пустой: кнопка одна и уже активна, нажимать нечего.
    return this.segField(null, [{ value: id, label }], id, () => {});
  }

  /**
   * Перерисовать ТОЛЬКО поле метода, не трогая остальную панель.
   * ⚠️ Набор надписи идёт в тихом режиме: renderPanel() пересоздал бы поле ввода и фокус
   * слетел бы на каждом символе. Без этого обновления покупатель печатал «Маша», цена
   * становилась плёночной, а строки «Плёнкой» на экране не было до первого клика
   * по любому другому полю (поймано глазами в браузере 25.08, тесты этого не видели).
   */
  refreshMethodField() {
    const slot = this.methodSlot;
    if (!slot) return;
    const field = this.methodField();
    slot.replaceChildren(...(field ? [field] : []));
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

  /**
   * Слой убрали крестиком прямо с футболки. Клиент 26.08 (голос): «на футболке удаляю
   * смирнов, а в поле текст слово смирнов остаётся… пусть это слово тоже удалится»,
   * причина у него та же, что и у нас: «обратно уже вернуть не можем… оно уже ни к чему».
   * Принтов это не касается — у них своего поля ввода нет.
   * @returns {boolean} поле ввода очищено
   */
  forgetLayer(d) {
    if ((d?.kind ?? 'print') !== 'text') return false;
    // Поле описывает ровно одну надпись — ту, что правится на лету. Крестик на чужой
    // (она осталась на другой стороне) поле не трогает: там текст ещё жив.
    if (this.state.liveTextId && this.state.liveTextId !== d.id) return false;
    this.state.textInput = '';
    this.state.liveTextId = null;
    return true;
  }

  /** Принт, уже положенный на активную сторону — он и показывается миниатюрой в строке. */
  activePrintSrc() {
    const prints = this.layers.list(this.state.side).filter(d => (d.kind ?? 'print') === 'print');
    return prints.length ? prints[prints.length - 1].src : null;
  }

  /**
   * Замедлитель против сохранения принта: правая кнопка и перетаскивание на картинках
   * конструктора. Клиент 01.08 просил «чтобы никаких возможностей скачать принт не было».
   * ⚠️ Честно: это НЕ защита. Адрес файла виден в инструментах разработчика, и обойти
   * можно за десять секунд. Настоящая защита уже стоит и работает иначе: браузеру отдаётся
   * превью 467×600, тогда как оригинал 3111×4000 лежит только на сервере, и перепечатать
   * с превью нельзя. Вешаем на document один раз, чтобы не плодить слушателей на перерисовках.
   */
  _guardImages() {
    if (this._imgGuardOn) return;
    this._imgGuardOn = true;
    const SEL = '.stage__img, .pf-print__img, .sideprev__img, .sideprev__print, .libm__thumb, .design-row__thumb';
    document.addEventListener('contextmenu', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest(SEL)) e.preventDefault();
    });
    document.addEventListener('dragstart', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest(SEL)) e.preventDefault();
    });
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
    toggle.append(el('span', '', 'Таблица размеров'), el('span', 'chev', '▾'));

    const body = el('div', 'sizes-body');

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

    // Клиент 26.08: «нажал посмотреть, а дальше пошёл кликать другие кнопочки — таблица
    // размеров тоже должна схлопываться, чтобы нам пространство не расширять».
    this._registerPanel('sizes', field, (open) => {
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.addEventListener('click', () => {
      this.panels.toggle('sizes');
      this._syncPanels();
    });

    field.append(toggle, body);
    return field;
  }

  // ── Оформление заказа ────────────────────────────────────────────────────
  // Сделано по образцу конструктора ФОРМЫ (app.browser.js: showOrder + jetron-orders.php).
  // Главное правило оттуда: сумма из браузера НИКОГДА не становится ценой — она едет рядом
  // только для сверки, а цену пересчитывает сервер по спецификации.

  /** Настройки товара WooCommerce. Нет файла (стенд без WP) — работаем без корзины. */
  async _wooConfig() {
    if (this._woo !== undefined) return this._woo;
    try {
      const r = await fetch('woo.json', { cache: 'no-store' });
      // 404 запоминаем: на стенде без WordPress файла нет и не будет.
      this._woo = r.ok ? await r.json() : null;
    } catch {
      return null; // сорванный запрос не кешируем — вдруг сеть моргнула
    }
    return this._woo;
  }

  showOrder() {
    const order = this.currentOrder();
    if (!this.layers.list('front').length && !this.layers.list('back').length) {
      // Пустая футболка без нанесений — это обычный товар из каталога, не конструктор.
      this._orderNote('Добавьте принт или надпись — иначе заказывать нечего.');
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'order-overlay';
    const card = document.createElement('div');
    card.className = 'order-card';
    const spec = orderSpec(order, { quantity: 1, withText: true });
    card.innerHTML = `
      <h3>Проверьте заказ</h3>
      <pre class="order-spec">${escapeHtml(spec.specText)}</pre>
      <label class="order-qty">Количество
        <input type="number" min="1" max="1000" step="1" value="1" id="ts-qty">
      </label>
      <p class="order-total">Предварительно: <b id="ts-total">${order.price.total} ₽</b> за штуку</p>
      <p class="hint">Точную сумму подтвердит менеджер: цену пересчитывает сервер.</p>
      <div class="order-actions">
        <button type="button" class="cta" id="ts-confirm">В корзину</button>
        <button type="button" class="ghost" id="ts-cancel">Отмена</button>
      </div>
      <p class="order-error" id="ts-err" hidden></p>`;
    overlay.append(card);
    document.body.append(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    card.querySelector('#ts-cancel').onclick = close;
    card.querySelector('#ts-confirm').onclick = () => this._submitOrder(card, close);
  }

  async _submitOrder(card, close) {
    const btn = card.querySelector('#ts-confirm');
    const err = card.querySelector('#ts-err');
    btn.disabled = true;
    try {
      const woo = await this._wooConfig();
      const order = this.currentOrder();
      const qty = Number(card.querySelector('#ts-qty').value);
      const spec = orderSpec(order, { quantity: qty, withText: true });
      if (!woo || !woo.productId) {
        // Стенд без WordPress: заказ собран, но корзины нет — честно об этом говорим.
        err.hidden = false;
        err.textContent = 'Корзина недоступна на этом стенде. Заказ собран, свяжитесь с менеджером.';
        btn.disabled = false;
        return;
      }
      const png = await this.mockupDataURL();
      const base = String(woo.siteUrl || '').replace(/\/$/, '');
      const form = document.createElement('form');
      form.method = 'POST';
      form.target = '_top'; // конструктор живёт в iframe — уводим ВСЮ страницу в корзину
      form.action = `${base}/?add-to-cart=${encodeURIComponent(woo.productId)}`;
      const add = (n, v) => {
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = n; i.value = v;
        form.append(i);
      };
      add('quantity', String(spec.quantity));
      add('tshirt_spec', spec.specText);
      // ⚠️ Ценой это не станет: сервер пересчитывает сам, число едет для сверки.
      add('tshirt_total', String(order.price.total));
      add('tshirt_order', JSON.stringify({ ...spec, specText: undefined }));
      if (png) add('tshirt_png', png);
      document.body.append(form);
      form.submit();
      close();
    } catch (e) {
      err.hidden = false;
      err.textContent = 'Не получилось отправить заказ. Попробуйте ещё раз.';
      btn.disabled = false;
    }
  }

  _orderNote(текст) {
    const note = document.createElement('div');
    note.className = 'order-note';
    note.textContent = текст;
    document.body.append(note);
    setTimeout(() => note.remove(), 3200);
  }

  // ── Скачать макет (клиент 30.07) ─────────────────────────────────────────
  // Конструктор футболок рисует нанесения обычным DOM, а не Fabric, поэтому холст
  // собираем вручную: мокап в натуральную величину, поверх принты и надписи по тем же
  // долям, что и на экране (printBoxOnMockup — та же математика, что в превью сторон).
  async downloadMockup() {
    // Клиент 01.08: «сделал принт только на груди, а скачалась картинка и с грудью, и со
    // спиной… зачем ему спина». Берём только те стороны, на которых что-то есть. Если пусто
    // везде (покупатель ничего не добавил), отдаём активную сторону — иначе кнопка молча
    // ничего не делает и выглядит сломанной.
    const wanted = sidesToExport(
      this.config.sides,
      (id) => this.layers.list(id).length > 0,
      this.state.side
    );

    const собрано = await this._composeMockup(wanted);
    if (!собрано) return;
    const { out, sides } = собрано;
    const form = this.currentForm();
    // В имя файла добавляем сторону, когда она одна: у печатника не должно быть вопросов,
    // грудь это или спина, если покупатель прислал два файла из разных заходов.
    const sidePart = sides.length === 1 ? sides[0].id : '';
    const name = ['jetron', form?.type ?? 'futbolka', form?.colorId ?? '', sidePart]
      .filter(Boolean).join('-');
    const a = document.createElement('a');
    a.download = name + '.png';
    a.href = out.toDataURL('image/png');
    a.click();
  }

  /**
   * Общий холст макета: стороны с нанесениями рядом, с подписями, на белом фоне.
   * Вынесено из downloadMockup, чтобы ТОТ ЖЕ макет уходил в заказ — у конструктора формы
   * менеджер тоже видит картинку (поле jetron_png), иначе по тексту непонятно, что печатать.
   */
  async _composeMockup(wanted) {
    const sides = [];
    for (const side of wanted) {
      const c = await this._composeSide(side.id);
      if (c) sides.push({ label: side.label, id: side.id, canvas: c });
    }
    if (!sides.length) return null;

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
    return { out, sides };
  }

  /**
   * Макет для заказа. JPEG, а не PNG: у формы так же (mockupDataURL 'image/jpeg', 0.85) —
   * PNG композита с фотомокапом весит единицы мегабайт и упирается в лимит плагина.
   */
  async mockupDataURL(type = 'image/jpeg', quality = 0.85) {
    const wanted = sidesToExport(
      this.config.sides,
      (id) => this.layers.list(id).length > 0,
      this.state.side
    );
    const собрано = await this._composeMockup(wanted);
    return собрано ? собрано.out.toDataURL(type, quality) : null;
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
    // Метод нанесения меняется ровно тогда же, когда цена: содержимое футболки задаёт оба.
    this.refreshMethodField();
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

// Спецификация уходит в <pre>, а в ней текст покупателя (надписи). Экранируем.
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
