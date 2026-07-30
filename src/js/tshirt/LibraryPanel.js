// LibraryPanel — библиотека готовых принтов (C17).
// Клиент 28.07: список принтов в панели превращался в «полотенце» при росте числа картинок,
// поэтому библиотека вынесена в ОТДЕЛЬНОЕ ОКНО. В панели остаётся кнопка «Выбрать принт».
// Раскладка окна ЗЕРКАЛЬНА референсу (votprikid/cosuv): у них кнопка вызова слева и категории
// слева, у нас кнопка справа в панели — значит плитка картинок СЛЕВА, категории СПРАВА
// (клиент 28.07: «нам надо зеркально сделать»).
// Сверху окна — загрузка своего файла, с перетаскиванием.

export class LibraryPanel {
  /**
   * @param {object} config — tshirt-mock-config
   * @param {{ categories:{slug,label,items:{id,file,dark}[]}[] }|null} manifest
   */
  constructor(config, manifest = null) {
    this.config = config;
    this.manifest = manifest;
    this.categories = manifest?.categories ?? [];
    this.activeSlug = ALL_SLUG;
    this.overlay = null;
  }

  get hasLibrary() {
    return this.categories.length > 0;
  }

  /** Все принты одним списком — для категории «Все картинки». */
  allItems() {
    return this.categories.flatMap(c => c.items);
  }

  /** Принты выбранной категории (ALL_SLUG — все). */
  itemsOf(slug) {
    if (slug === ALL_SLUG) return this.allItems();
    return this.categories.find(c => c.slug === slug)?.items ?? [];
  }

  /** Категории для списка в окне: «Все картинки» + папки манифеста. */
  categoryList() {
    return [
      { slug: ALL_SLUG, label: 'Все картинки', count: this.allItems().length },
      ...this.categories.map(c => ({ slug: c.slug, label: c.label, count: c.items.length }))
    ];
  }

  /**
   * Строка в панели по макету клиента 30.07: кремовый контейнер, внутри белая кнопка
   * «Добавить принт», стрелка и миниатюра.
   * thumbSrc — принт, уже положенный на активную сторону; без него показываем первый
   * из библиотеки, чтобы место миниатюры не пустовало (в макете оно занято).
   */
  renderTrigger(el, { onOpen, thumbSrc = null }) {
    el.innerHTML = '';
    const row = mk('div', 'design-row');
    const btn = mk('button', 'design-row__btn', 'Добавить принт');
    btn.type = 'button';
    row.append(btn);
    row.append(mk('span', 'design-row__arrow', '→'));
    const src = thumbSrc || this.allItems()[0]?.file;
    if (src) {
      const th = mk('img', 'design-row__thumb');
      th.src = src;
      th.alt = '';
      th.loading = 'lazy';
      row.append(th);
    }
    btn.addEventListener('click', onOpen);
    // Клик по всей плашке тоже открывает окно: в макете это одна цельная строка.
    row.addEventListener('click', (e) => { if (e.target !== btn) onOpen(); });
    el.append(row);
  }

  /** Открыть окно библиотеки. Повторный вызов не плодит окна. */
  openModal({ onPick, onUpload }) {
    if (this.overlay) return;

    const overlay = mk('div', 'libm');
    const card = mk('div', 'libm__card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Библиотека принтов');

    // Шапка
    const head = mk('div', 'libm__head');
    head.append(mk('h3', 'libm__title', 'Выберите принт'));
    const close = mk('button', 'libm__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    head.append(close);
    card.append(head);

    // Загрузка своего файла: клик по кнопке или перетаскивание в зону
    const upload = mk('div', 'libm__upload');
    const upBtn = mk('button', 'libm__upload-btn', 'Выберите файл');
    upBtn.type = 'button';
    const input = mk('input', 'libm__file');
    input.type = 'file';
    input.accept = (this.config.upload?.formats ?? ['png', 'jpeg', 'svg', 'webp'])
      .map(f => 'image/' + f).join(',');
    input.style.display = 'none';
    upload.append(upBtn, mk('span', 'libm__upload-hint', 'или перетяните файл сюда'), input);

    const take = (file) => { if (file) { onUpload(file); this.closeModal(); } };
    upBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { take(input.files?.[0]); input.value = ''; });
    upload.addEventListener('dragover', (e) => {
      e.preventDefault();
      upload.classList.add('libm__upload--over');
    });
    upload.addEventListener('dragleave', () => upload.classList.remove('libm__upload--over'));
    upload.addEventListener('drop', (e) => {
      e.preventDefault();
      upload.classList.remove('libm__upload--over');
      take(e.dataTransfer?.files?.[0]);
    });
    card.append(upload);

    // Тело: СЛЕВА плитка, СПРАВА категории (зеркально референсу — клиент 28.07)
    const body = mk('div', 'libm__body');
    const grid = mk('div', 'libm__grid');
    const cats = mk('div', 'libm__cats');
    body.append(grid, cats);
    card.append(body);

    const paint = () => {
      grid.innerHTML = '';
      const items = this.itemsOf(this.activeSlug);
      if (!items.length) {
        grid.append(mk('div', 'libm__empty', 'В этой категории пока нет картинок.'));
      }
      for (const item of items) {
        const cell = mk('button', 'libm__cell' + (item.dark ? ' libm__cell--dark' : ''));
        cell.type = 'button';
        const img = mk('img', 'libm__thumb');
        img.src = item.file;
        img.loading = 'lazy';
        img.alt = item.id;
        cell.append(img);
        cell.addEventListener('click', () => { onPick(item.file); this.closeModal(); });
        grid.append(cell);
      }
      cats.innerHTML = '';
      for (const c of this.categoryList()) {
        const row = mk('button', 'libm__cat' + (c.slug === this.activeSlug ? ' libm__cat--active' : ''));
        row.type = 'button';
        row.append(mk('span', 'libm__cat-label', c.label));
        row.append(mk('span', 'libm__cat-count', String(c.count)));
        row.addEventListener('click', () => { this.activeSlug = c.slug; paint(); });
        cats.append(row);
      }
    };
    paint();

    overlay.append(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeModal(); });
    close.addEventListener('click', () => this.closeModal());
    this._onKey = (e) => { if (e.key === 'Escape') this.closeModal(); };
    document.addEventListener('keydown', this._onKey);

    document.body.append(overlay);
    this.overlay = overlay;
    this._pinToViewport();
  }

  // На сайте конструктор стоит в iframe без своей прокрутки: его «экран» равен всей высоте
  // документа, поэтому position:fixed центрирует окно по СЕРЕДИНЕ КОНСТРУКТОРА, а не по экрану
  // покупателя. На телефоне это выглядело так, будто кнопка «Выбрать принт» не работает.
  // Поэтому во встроенном режиме кладём окно ровно на видимую часть и следим за прокруткой.
  _pinToViewport() {
    const frame = (() => { try { return window.frameElement; } catch { return null; } })();
    if (!frame || !this.overlay) return;
    const sync = () => {
      if (!this.overlay) return;
      let box;
      let viewportH;
      try {
        box = frame.getBoundingClientRect();
        viewportH = window.parent.innerHeight;
      } catch { return; }
      const top = Math.max(0, -box.top);
      const height = Math.max(240, Math.min(viewportH, box.bottom) - Math.max(0, box.top));
      this.overlay.style.position = 'absolute';
      this.overlay.style.top = top + 'px';
      this.overlay.style.bottom = 'auto';
      this.overlay.style.height = height + 'px';
      const card = this.overlay.querySelector('.libm__card');
      if (card) card.style.maxHeight = '100%';
    };
    sync();
    this._onViewport = sync;
    // Событий scroll родителя недостаточно: часть прокруток (инерция на телефоне,
    // программные переходы) их не даёт. Пока окно открыто, пересчитываем каждый кадр.
    const tick = () => {
      if (!this.overlay) return;
      sync();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    // Кадры останавливаются, когда вкладка уходит в фон, поэтому дублируем событиями.
    try {
      window.parent.addEventListener('scroll', sync, { passive: true });
      window.parent.addEventListener('resize', sync);
    } catch { /* другой домен: остаёмся на кадрах */ }
  }

  closeModal() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this._onViewport) {
      try {
        window.parent.removeEventListener('scroll', this._onViewport);
        window.parent.removeEventListener('resize', this._onViewport);
      } catch { /* уже недоступен */ }
      this._onViewport = null;
    }
  }
}

const ALL_SLUG = '__all__';

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
