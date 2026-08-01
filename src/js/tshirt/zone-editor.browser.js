// Редактор зоны печати для владельца (клиент 29.07: «мне нужно редактировать»).
// Открывается по /tshirt/?zones=edit в том же браузере, где выполнен вход в админку WordPress.
// Рамку можно двигать и тянуть за угол; пропорции физической зоны (40×50) держатся сами.
// Сохранение — в tshirt/zones.json через mu-плагин jetron-tshirt-admin.php.
//
// Браузерный слой (DOM + сеть). Чистая математика коробки — в ZoneBox.js.

import { moveBox, scaleBox, alignBoxToCm } from './ZoneBox.js?v=20260731d';
import { FULL_CROP, moveCrop, scaleCrop, cropFitsZones, minCropFor, isFullCrop } from './Crop.js?v=20260731d';
import { clampStageWidth, widthFromDrag, DEFAULT_STAGE_WIDTH } from './StageWidth.js?v=20260731d';

const AJAX_URL = '/wp-admin/admin-ajax.php';

export function initTshirtZoneEditor(app) {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('zones') !== 'edit') return null;
  const editor = new TshirtZoneEditor(app);
  editor.mount();
  return editor;
}

class TshirtZoneEditor {
  constructor(app) {
    this.app = app;
    this.nonce = null;
    this.statusEl = null;
    this.armed = new WeakSet();
    this.cropMode = false;   // правим кадр мокапа, а не зону печати
    this.cropEl = null;
    this.cropBtn = null;
    this.widthHandle = null;   // ручка ширины поля на правом крае сцены
    this.widthLabel = null;
  }

  mount() {
    this.buildBar();
    // Панель перерисовывается на каждое действие покупателя, рамки при этом пересоздаются,
    // поэтому вооружаем их заново после каждой отрисовки.
    const origRender = this.app.render.bind(this.app);
    this.app.render = (...args) => {
      const r = origRender(...args);
      this.armAll();
      if (this.cropMode) this.showCropRect();
      return r;
    };
    this.armAll();
    this.mountWidthHandle();
    this.fetchNonce();
  }

  async fetchNonce() {
    try {
      const body = new URLSearchParams({ action: 'jetron_ts_zones_boot' });
      const res = await fetch(AJAX_URL, { method: 'POST', credentials: 'include', body });
      const json = await res.json();
      this.nonce = (json && json.data && json.data.nonce) || null;
      this.setStatus(this.nonce ? 'Готово к правке.' : 'Войдите в админку WordPress.', !!this.nonce);
    } catch {
      this.setStatus('Сервер не ответил. Войдите в админку WordPress.', false);
    }
  }

  buildBar() {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', left: '10px', bottom: '10px', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px',
      borderRadius: '10px', background: 'rgba(20,41,76,0.92)', color: '#fff',
      font: '13px/1.35 system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      maxWidth: '270px'
    });

    const title = document.createElement('div');
    title.textContent = 'Редактор зоны печати';
    Object.assign(title.style, { fontWeight: '600', fontSize: '14px' });

    const hint = document.createElement('div');
    hint.textContent = 'Рамка на футболке — это зона печати: тяните её, чтобы переместить, за круг в углу — чтобы изменить размер (пропорции 40×50 держатся сами). Чтобы сама футболка стала крупнее, нажмите «Увеличить футболку».';
    Object.assign(hint.style, { opacity: '0.85', fontSize: '12px' });

    const status = document.createElement('div');
    Object.assign(status.style, { fontSize: '12px', minHeight: '16px' });
    this.statusEl = status;

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '2px' });
    row.append(
      this.mkButton('Сохранить', '#2f6fe0', () => this.save()),
      this.mkButton('Отменить правки', 'rgba(255,255,255,0.18)', () => window.location.reload())
    );

    // Вторая строка: кадрирование мокапа (клиент 30.07 на видео: «не знаю, как увеличить
    // размеры футболки»). Режет серые поля вокруг изделия, сам файл не трогает.
    const cropRow = document.createElement('div');
    Object.assign(cropRow.style, { display: 'flex', gap: '8px' });
    // Названия — словами клиента. «Кадрировать мокап» ему ничего не говорило: он искал,
    // как увеличить футболку, и не связывал это с кадрированием.
    this.cropBtn = this.mkButton('Увеличить футболку', 'rgba(224,122,31,0.92)', () => this.toggleCrop());
    cropRow.append(
      this.cropBtn,
      this.mkButton('Показать целиком', 'rgba(255,255,255,0.18)', () => this.resetCrop())
    );

    bar.append(title, hint, status, row, cropRow);
    document.body.append(bar);
  }

  mkButton(text, bg, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    Object.assign(b.style, {
      flex: '1', padding: '8px 10px', border: 'none', borderRadius: '7px', cursor: 'pointer',
      color: '#fff', background: bg, fontSize: '12px', fontWeight: '600'
    });
    b.addEventListener('click', onClick);
    return b;
  }

  setStatus(text, ok = true) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.style.color = ok ? '#8fe388' : '#ff9a9a';
  }

  /** Повесить на каждую рамку перетаскивание и уголок масштаба. */
  armAll() {
    const editors = this.app.editors || {};
    for (const view of Object.keys(editors)) {
      const frameEl = editors[view] && editors[view].frameEl;
      if (!frameEl || this.armed.has(frameEl)) continue;
      this.armed.add(frameEl);
      frameEl.style.outline = '2px solid #2f6fe0';
      frameEl.style.cursor = 'move';

      const grip = document.createElement('div');
      // Внутри рамки, а не снаружи: у .stage__canvas стоит overflow:hidden, и маркер,
      // вынесенный за край, срезается вместе с рамкой, если зону подвинуть к краю сцены.
      // Ровно на этом ловился маркер кадра (см. showCropRect).
      Object.assign(grip.style, {
        position: 'absolute', right: '3px', bottom: '3px', width: '20px', height: '20px',
        borderRadius: '50%', background: '#2f6fe0', border: '2px solid #fff',
        boxShadow: '0 1px 5px rgba(0,0,0,0.45)', cursor: 'nwse-resize', zIndex: '40',
        touchAction: 'none'
      });
      frameEl.append(grip);

      this.wireDrag(frameEl, view);
      this.wireResize(grip, frameEl, view);
    }
  }

  zoneOf(view) {
    return this.app.zoneFor(view);
  }

  /** Пиксельный размер подложки (мокапа), от которого считаются доли. */
  stageRect(frameEl) {
    return frameEl.parentElement.getBoundingClientRect();
  }

  setFrameStyle(frameEl, box) {
    Object.assign(frameEl.style, {
      left: box.x * 100 + '%', top: box.y * 100 + '%',
      width: box.w * 100 + '%', height: box.h * 100 + '%'
    });
  }

  /** Правим шаблон и просим приложение пересобрать зоны — как при старте. */
  applyBox(view, box) {
    const tpl = this.app.config.zoneTemplate.find(z => z.view === view);
    if (tpl) tpl.box = box;
    this.app.buildZones();
    this.app.render();
    this.armAll();
  }

  wireDrag(frameEl, view) {
    frameEl.addEventListener('pointerdown', (e) => {
      if (e.target !== frameEl) return; // попали в принт или в уголок — не наше дело
      const stage = this.stageRect(frameEl);
      if (!stage.width || !stage.height) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      const box0 = Object.assign({}, this.zoneOf(view).box);
      let box = box0;
      const move = (ev) => {
        box = moveBox(box0, (ev.clientX - start.x) / stage.width, (ev.clientY - start.y) / stage.height);
        this.setFrameStyle(frameEl, box);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.applyBox(view, box);
        this.setStatus('Рамка перемещена, не забудьте сохранить.');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  wireResize(grip, frameEl, view) {
    grip.addEventListener('pointerdown', (e) => {
      const stage = this.stageRect(frameEl);
      if (!stage.width || !stage.height) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = this.zoneOf(view);
      const box0 = Object.assign({}, zone.box);
      const startX = e.clientX;
      let box = box0;
      const move = (ev) => {
        const dw = (ev.clientX - startX) / stage.width;
        box = scaleBox(box0, box0.w + dw, zone.cm, stage.width / stage.height);
        this.setFrameStyle(frameEl, box);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.applyBox(view, box);
        this.setStatus('Размер изменён, не забудьте сохранить.');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  // ── Кадрирование мокапа ───────────────────────────────────────────────────
  // Пока правим кадр, картинку показываем ЦЕЛИКОМ: иначе владелец не увидит, что режет.
  // Поэтому app._suppressCrop временно отключает кадр у покупательской отрисовки.

  cropOf(formId) {
    const crops = this.app.config.crops || {};
    return crops[formId] || FULL_CROP;
  }

  toggleCrop() {
    this.cropMode = !this.cropMode;
    this.app._suppressCrop = this.cropMode;
    if (this.cropBtn) this.cropBtn.textContent = this.cropMode ? 'Готово' : 'Увеличить футболку';
    this.app.buildZones();
    this.app.render();
    this.armAll();
    if (this.cropMode) {
      this.showCropRect();
      this.setStatus('Тяните оранжевый кружок ⤡ в правом нижнем углу ВНУТРЬ — футболка станет крупнее. Саму рамку можно двигать.');
    } else {
      this.hideCropRect();
      this.setStatus('Кадр применён, не забудьте сохранить.');
    }
  }

  resetCrop() {
    const form = this.app.currentForm();
    if (!form) return;
    const crops = this.app.config.crops || (this.app.config.crops = {});
    delete crops[form.id];
    this.app.buildZones();
    this.app.render();
    this.armAll();
    if (this.cropMode) this.showCropRect();
    this.setStatus('Кадр снят, показан весь мокап. Не забудьте сохранить.');
  }

  hideCropRect() {
    if (this.cropEl && this.cropEl.parentElement) this.cropEl.remove();
    this.cropEl = null;
  }

  showCropRect() {
    this.hideCropRect();
    const stage = document.querySelector('.stage__canvas');
    const form = this.app.currentForm();
    if (!stage || !form) return;
    const crop = this.cropOf(form.id);

    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute', boxSizing: 'border-box',
      border: '2px solid #e07a1f', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
      cursor: 'move', zIndex: '50'
    });
    // ⚠️ Маркер держим ВНУТРИ рамки. Раньше он висел на `right/bottom: -9px`, то есть снаружи,
    // а стартовый кадр равен всему мокапу — и `overflow:hidden` у .stage__canvas его срезал.
    // Замер на боевом 31.07: маркер выходил за правый и нижний край сцены на 7 px каждый,
    // от круга 18 px в углу оставался кусочек ~11 px, поверх скруглённого угла и на тёмно-сером
    // фоне. Технически ухватить можно, НАЙТИ практически нельзя — и это ровно то состояние,
    // с которого начинает каждая модель. Клиент писал дважды: «не знаю, как увеличить размеры
    // футболки» (30.07) и «не понимаю, за что двигать, она не двигается» (31.07).
    // Прошлый замер «механика исправна» был верен и потому бесполезен: события слались
    // программно по координатам, то есть проверяли обработчик, а не находимость маркера.
    const grip = document.createElement('div');
    grip.textContent = '⤡';
    grip.title = 'Тяните внутрь, чтобы приблизить футболку';
    Object.assign(grip.style, {
      position: 'absolute', right: '4px', bottom: '4px', width: '26px', height: '26px',
      borderRadius: '50%', background: '#e07a1f', border: '3px solid #fff',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)', cursor: 'nwse-resize', zIndex: '51',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', font: '700 15px/1 system-ui, sans-serif', userSelect: 'none',
      touchAction: 'none'
    });
    box.append(grip);
    stage.append(box);
    this.cropEl = box;
    this.setCropStyle(crop);

    this.wireCropDrag(box, stage);
    this.wireCropResize(grip, box, stage);
  }

  setCropStyle(crop) {
    if (!this.cropEl) return;
    Object.assign(this.cropEl.style, {
      left: crop.x * 100 + '%', top: crop.y * 100 + '%',
      width: crop.w * 100 + '%', height: crop.h * 100 + '%'
    });
  }

  /** Зоны текущей модели в долях всего мокапа — кадр обязан их вместить. */
  zoneBoxes() {
    return (this.app.config.zoneTemplate || []).map((z) => this.app.zoneFor(z.view))
      .filter(Boolean).map((z) => z.box);
  }

  /** Записать кадр, если он не режет зону печати. Иначе оставить прежний и сказать почему. */
  commitCrop(crop) {
    const form = this.app.currentForm();
    if (!form) return;
    if (!cropFitsZones(crop, this.zoneBoxes())) {
      this.setCropStyle(this.cropOf(form.id));
      this.setStatus('Так нельзя: кадр обрезает зону печати. Минимум — по её границам.', false);
      return;
    }
    const crops = this.app.config.crops || (this.app.config.crops = {});
    if (isFullCrop(crop)) delete crops[form.id];
    else crops[form.id] = crop;
    this.setStatus('Кадр изменён, не забудьте сохранить.');
  }

  wireCropDrag(box, stage) {
    box.addEventListener('pointerdown', (e) => {
      if (e.target !== box) return;
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      e.preventDefault();
      const form = this.app.currentForm();
      const start = { x: e.clientX, y: e.clientY };
      const c0 = this.cropOf(form.id);
      let crop = c0;
      const move = (ev) => {
        crop = moveCrop(c0, (ev.clientX - start.x) / r.width, (ev.clientY - start.y) / r.height);
        this.setCropStyle(crop);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.commitCrop(crop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  wireCropResize(grip, box, stage) {
    grip.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      e.preventDefault();
      e.stopPropagation();
      const form = this.app.currentForm();
      const c0 = this.cropOf(form.id);
      const startX = e.clientX;
      let crop = c0;
      const move = (ev) => {
        crop = scaleCrop(c0, c0.w + (ev.clientX - startX) / r.width);
        this.setCropStyle(crop);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.commitCrop(crop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }


  // ── Ширина поля с футболкой ────────────────────────────────────────────────
  // Клиент 01.08: «мне нужно вот это поле… увеличить прямо до краёв», и он хотел
  // именно ТЯНУТЬ. Кадрирование этого дать не может: оно режет поля вокруг изделия,
  // а их всего ~1.25x запаса, дальше срезает рукава. Здесь растягивается сама сцена.

  appEl() {
    return document.getElementById('app');
  }

  currentStageWidth() {
    const cfg = this.app.config.stage;
    if (cfg && Number.isFinite(Number(cfg.width))) return clampStageWidth(cfg.width);
    const el = this.appEl();
    // Ширина из CSS, пока владелец ничего не менял.
    const css = el ? parseFloat(getComputedStyle(el).maxWidth) : NaN;
    return Number.isFinite(css) ? css : DEFAULT_STAGE_WIDTH;
  }

  applyStageWidth(px) {
    const el = this.appEl();
    if (el) el.style.maxWidth = px + 'px';
    if (this.widthLabel) this.widthLabel.textContent = px + ' px';
    // Рамки зон живут в процентах, но пересборка нужна: сцена сменила размер.
    this.app.render();
    this.armAll();
    this.positionWidthHandle();
  }

  /** Ручка на правом крае поля: вертикальная полоса, её видно и она подписана. */
  mountWidthHandle() {
    const h = document.createElement('div');
    Object.assign(h.style, {
      position: 'absolute', zIndex: '60', width: '26px', borderRadius: '13px',
      background: 'rgba(47,111,224,0.95)', border: '2px solid #fff',
      boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
      cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', font: '600 13px/1 system-ui, sans-serif', userSelect: 'none',
      touchAction: 'none'
    });
    h.textContent = '⟷';
    h.title = 'Тяните вбок — поле с футболкой станет шире или уже';

    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute', zIndex: '60', padding: '4px 8px', borderRadius: '7px',
      background: 'rgba(20,41,76,0.92)', color: '#fff',
      font: '600 12px/1 system-ui, sans-serif', pointerEvents: 'none', whiteSpace: 'nowrap'
    });
    this.widthLabel = label;
    this.widthHandle = h;
    document.body.append(h, label);
    label.textContent = Math.round(this.currentStageWidth()) + ' px';

    this.wireWidthDrag(h);
    this.positionWidthHandle();
    window.addEventListener('resize', () => this.positionWidthHandle());
    window.addEventListener('scroll', () => this.positionWidthHandle(), { passive: true });
  }

  /** Держим ручку у правого края сцены. Координаты страничные, потому что элемент в body. */
  positionWidthHandle() {
    const stage = document.getElementById('stage');
    if (!stage || !this.widthHandle) return;
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    const top = r.top + window.scrollY;
    const height = Math.max(80, Math.min(r.height, 160));
    Object.assign(this.widthHandle.style, {
      left: (r.right + window.scrollX - 13) + 'px',
      top: (top + r.height / 2 - height / 2) + 'px',
      height: height + 'px',
    });
    Object.assign(this.widthLabel.style, {
      left: (r.right + window.scrollX - 30) + 'px',
      top: (top + r.height / 2 + height / 2 + 8) + 'px',
    });
  }

  wireWidthDrag(handle) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // ⚠️ Захват указателя — попытка, а не обязанность: setPointerCapture кидает
      // NotFoundError, если указателя с таким id уже нет, и раньше это молча обрывало
      // обработчик ДО навешивания move, то есть ручка просто не тянулась.
      try { handle.setPointerCapture(e.pointerId); } catch { /* потянем и без захвата */ }
      const startX = e.clientX;
      const startWidth = this.currentStageWidth();
      // Слушаем на window, как перетаскивание рамки зоны: курсор во время тяги
      // уходит за узкую ручку, и события на самом элементе теряются.
      const move = (ev) => {
        const px = widthFromDrag(startWidth, ev.clientX - startX);
        const stage = this.app.config.stage || (this.app.config.stage = {});
        stage.width = px;
        this.applyStageWidth(px);
      };
      const up = () => {
        try { handle.releasePointerCapture(e.pointerId); } catch { /* не захватывали */ }
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.setStatus('Ширина поля изменена, не забудьте сохранить.');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** Сохраняем ВЗРОСЛУЮ зону: детская выводится из неё автоматически. */
  async save() {
    if (!this.nonce) {
      this.setStatus('Нет прав на сохранение: войдите в админку.', false);
      return;
    }
    const byAge = (this.app.config.frame && this.app.config.frame.byAge) || {};
    const adultCm = {
      w: (byAge.adult && byAge.adult.wCm) || 40,
      h: (byAge.adult && byAge.adult.hCm) || 50
    };
    const canvas = this.app.config.canvas || { width: 1, height: 1 };
    const stageAspect = canvas.width / canvas.height;
    const zones = {};
    for (const tpl of this.app.config.zoneTemplate) {
      zones[tpl.view] = alignBoxToCm(tpl.box, adultCm, stageAspect);
    }
    try {
      const body = new URLSearchParams({
        action: 'jetron_ts_zones', nonce: this.nonce, zones: JSON.stringify(zones),
        crops: JSON.stringify(this.app.config.crops || {}),
        // Ширина поля уходит тем же сохранением, что зоны и кадры (клиент 01.08).
        stage: JSON.stringify(this.app.config.stage || {})
      });
      const res = await fetch(AJAX_URL, { method: 'POST', credentials: 'include', body });
      const json = await res.json();
      if (json && json.success) {
        this.setStatus('Сохранено. Обновите страницу у покупателей.');
      } else {
        const msg = (json && json.data && json.data.message) || 'ошибка сервера';
        this.setStatus('Не сохранилось: ' + msg, false);
      }
    } catch {
      this.setStatus('Сеть не ответила, попробуйте ещё раз.', false);
    }
  }
}
