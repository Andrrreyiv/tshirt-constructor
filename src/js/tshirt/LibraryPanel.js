// LibraryPanel — библиотека готовых принтов с фильтром по категориям (C17, ответ 15-05-34).
// Каждая папка из Принты.zip = категория-фильтр. Клиент дозагрузит остальное через админку.
// Плюс загрузка своего файла. Выбор принта → onPick(src).

export class LibraryPanel {
  /**
   * @param {object} config — tshirt-mock-config
   * @param {{ categories:{slug,label,items:{id,file,dark}[]}[] }|null} manifest
   */
  constructor(config, manifest = null) {
    this.config = config;
    this.manifest = manifest;
    this.categories = manifest?.categories ?? [];
    this.activeSlug = this.categories[0]?.slug ?? null;
  }

  /** Есть ли данные библиотеки. */
  get hasLibrary() {
    return this.categories.length > 0;
  }

  /** Принты выбранной категории. */
  itemsOf(slug) {
    return this.categories.find(c => c.slug === slug)?.items ?? [];
  }

  /**
   * Отрисовать панель: загрузка + чипы категорий + сетка превью.
   * @param {HTMLElement} el
   * @param {{ onPick:(src:string)=>void, onUpload:(file:File)=>void }} handlers
   */
  render(el, { onPick, onUpload }) {
    el.innerHTML = '';

    // Загрузка своего файла
    const up = mk('div', 'lib__upload');
    const upBtn = mk('button', 'lib__upload-btn', '＋ Загрузить свой принт');
    const input = mk('input', 'lib__file');
    input.type = 'file';
    input.accept = (this.config.upload?.formats ?? ['png', 'jpeg', 'svg', 'webp'])
      .map(f => `image/${f}`).join(',');
    input.style.display = 'none';
    upBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files?.[0]) onUpload(input.files[0]);
      input.value = '';
    });
    up.append(upBtn, input);
    el.append(up);

    if (!this.hasLibrary) {
      el.append(mk('div', 'hint', 'Библиотека принтов подгрузится из админки.'));
      return;
    }

    // Чипы категорий
    const chips = mk('div', 'lib__chips');
    for (const cat of this.categories) {
      const chip = mk('button',
        'lib__chip' + (cat.slug === this.activeSlug ? ' lib__chip--active' : ''),
        `${cat.label} (${cat.items.length})`);
      chip.addEventListener('click', () => {
        this.activeSlug = cat.slug;
        this.render(el, { onPick, onUpload });
      });
      chips.append(chip);
    }
    el.append(chips);

    // Сетка превью
    const grid = mk('div', 'lib__grid');
    for (const item of this.itemsOf(this.activeSlug)) {
      const cell = mk('button', 'lib__cell' + (item.dark ? ' lib__cell--dark' : ''));
      const img = mk('img', 'lib__thumb');
      img.src = item.file;
      img.loading = 'lazy';
      img.alt = item.id;
      cell.append(img);
      cell.addEventListener('click', () => onPick(item.file));
      grid.append(cell);
    }
    el.append(grid);
  }
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
