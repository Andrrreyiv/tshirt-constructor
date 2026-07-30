// Редактор зоны печати для владельца (клиент 29.07: «мне нужно редактировать»).
// Открывается по /tshirt/?zones=edit в том же браузере, где выполнен вход в админку WordPress.
// Рамку можно двигать и тянуть за угол; пропорции физической зоны (40×50) держатся сами.
// Сохранение — в tshirt/zones.json через mu-плагин jetron-tshirt-admin.php.
//
// Браузерный слой (DOM + сеть). Чистая математика коробки — в ZoneBox.js.

import { moveBox, scaleBox, alignBoxToCm } from './ZoneBox.js?v=20260730b';

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
  }

  mount() {
    this.buildBar();
    // Панель перерисовывается на каждое действие покупателя, рамки при этом пересоздаются,
    // поэтому вооружаем их заново после каждой отрисовки.
    const origRender = this.app.render.bind(this.app);
    this.app.render = (...args) => {
      const r = origRender(...args);
      this.armAll();
      return r;
    };
    this.armAll();
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
    hint.textContent = 'Тяните рамку, чтобы переместить, за круг в углу — чтобы изменить размер. Пропорции 40×50 держатся сами.';
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

    bar.append(title, hint, status, row);
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
      Object.assign(grip.style, {
        position: 'absolute', right: '-9px', bottom: '-9px', width: '18px', height: '18px',
        borderRadius: '50%', background: '#2f6fe0', border: '2px solid #fff',
        cursor: 'nwse-resize', zIndex: '40'
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
      e.preventDefault();
      const stage = this.stageRect(frameEl);
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
      e.preventDefault();
      e.stopPropagation();
      const stage = this.stageRect(frameEl);
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
        action: 'jetron_ts_zones', nonce: this.nonce, zones: JSON.stringify(zones)
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
