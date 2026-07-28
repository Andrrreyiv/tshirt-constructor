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

  /** Кнопка в панели: «Выбрать принт →» с миниатюрой (макет клиента). */
  renderTrigger(el, { onOpen }) {
    el.innerHTML = '';
    const btn = mk('button', 'lib-open');
    btn.type = 'button';
    btn.append(mk('span', 'lib-open__label', 'Выбрать принт'));
    btn.append(mk('span', 'lib-open__arrow', '→'));
    const first = this.allItems()[0];
    if (first) {
      const th = mk('img', 'lib-open__thumb');
      th.src = first.file;
      th.alt = '';
      th.loading = 'lazy';
      btn.append(th);
    }
    btn.addEventListener('click', onOpen);
    el.append(btn);
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
  }

  closeModal() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
  }
}

const ALL_SLUG = '__all__';

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
