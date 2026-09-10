// LibraryPanel — библиотека готовых принтов (C17).
// Клиент 28.07: список принтов в панели превращался в «полотенце» при росте числа картинок,
// поэтому библиотека вынесена в ОТДЕЛЬНОЕ ОКНО. В панели остаётся кнопка «Выбрать принт».
// Раскладка окна ЗЕРКАЛЬНА референсу (votprikid/cosuv): у них кнопка вызова слева и категории
// слева, у нас кнопка справа в панели — значит плитка картинок СЛЕВА, категории СПРАВА
// (клиент 28.07: «нам надо зеркально сделать»).
// Сверху окна — загрузка своего файла, с перетаскиванием.

import { LIGHT, DARK, ANY, printTone, filterCategories, hiddenCount } from './PrintTone.js?v=20260826a';
import { PrintPreview } from './PrintPreview.js?v=20260910a';

/**
 * Куда положить окно библиотеки, когда конструктор стоит в iframe без своей прокрутки.
 * `box` — рамка iframe в координатах РОДИТЕЛЬСКОЙ страницы, `viewportH` — высота её экрана.
 *
 * ⚠️ Клиент 25.08 (видео): «Видишь, ползёт вниз, вот этот экран. Он ползёт, ползёт и он
 * ползёт до бесконечности». Причина была в `position: absolute`. Абсолютный элемент входит
 * в `scrollHeight` документа, а скрипт сайта подгоняет высоту iframe под эту же величину:
 * прокрутили вниз → top вырос → документ стал выше → сайт увеличил рамку → следующий кадр
 * сдвинул окно ещё ниже. Петля на 60 кадрах в секунду.
 * `fixed` из высоты документа выпадает, поэтому кормить петлю нечем, а на экране окно
 * встаёт туда же: внутри iframe прокрутки нет, scrollY всегда 0.
 */
export function pinStyle(box, viewportH) {
  const top = Math.max(0, -box.top);
  const height = Math.max(240, Math.min(viewportH, box.bottom) - Math.max(0, box.top));
  return { position: 'fixed', top, height };
}

/**
 * Что делает клавиша при открытой библиотеке. Вынесено из обработчика, чтобы иерархия
 * проверялась тестом без браузера — как pinStyle выше.
 *
 * Смысл иерархии: пока принт открыт крупно, Esc гасит ТОЛЬКО просмотр. Иначе покупатель,
 * закрывая увеличенную картинку, вылетал бы из библиотеки целиком и искал бы её заново.
 */
export function keyAction(key, previewOpen) {
  if (previewOpen) {
    if (key === 'Escape') return 'closePreview';
    if (key === 'ArrowRight') return 'next';
    if (key === 'ArrowLeft') return 'prev';
    return 'none';
  }
  return key === 'Escape' ? 'closeModal' : 'none';
}

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
    // Тон выбранного изделия. null = отбор не применяем (тон ещё не сообщили).
    this.tone = null;
    // Покупатель нажал «показать остальные» — временно снимаем отбор до смены цвета.
    this.showAll = false;
    // Просмотр принта крупно (клиент 09.09). Модель отдельно, DOM ниже.
    this.preview = new PrintPreview();
  }

  /**
   * Сообщить тон выбранного изделия. Вызывается при выборе цвета футболки.
   * Смена цвета сбрасывает «показать остальные»: иначе выбрал чёрную, раскрыл всё,
   * вернулся на белую — и отбор молча не работает.
   */
  setTone(tone) {
    if (tone === this.tone) return;
    this.tone = tone;
    this.showAll = false;
    // Активная категория могла исчезнуть после отбора — не оставляем окно пустым.
    if (!this.categoryList().some((c) => c.slug === this.activeSlug)) {
      this.activeSlug = ALL_SLUG;
    }
  }

  /** Категории с учётом отбора по тону. Источник для всех остальных методов. */
  visibleCategories() {
    if (!this.tone || this.showAll) return this.categories;
    return filterCategories(this.categories, this.tone);
  }

  /** Сколько картинок сейчас спрятано отбором. */
  hiddenNow() {
    if (!this.tone || this.showAll) return 0;
    return hiddenCount(this.categories, this.tone);
  }

  get hasLibrary() {
    return this.categories.length > 0;
  }

  /** Все принты одним списком — для категории «Все картинки». */
  allItems() {
    return this.visibleCategories().flatMap(c => c.items);
  }

  /** Принты выбранной категории (ALL_SLUG — все). */
  itemsOf(slug) {
    if (slug === ALL_SLUG) return this.allItems();
    return this.visibleCategories().find(c => c.slug === slug)?.items ?? [];
  }

  /** Категории для списка в окне: «Все картинки» + папки манифеста. */
  categoryList() {
    return [
      { slug: ALL_SLUG, label: 'Все картинки', count: this.allItems().length },
      ...this.visibleCategories().map(c => ({ slug: c.slug, label: c.label, count: c.items.length }))
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
      items.forEach((item, idx) => {
        // Тёмная подложка плитки: у принта для тёмных всегда, у универсального — когда
        // выбрано тёмное изделие. Так покупатель видит картинку в том окружении,
        // в котором она и напечатается.
        const t = printTone(item);
        const onDark = t === DARK || (t === ANY && this.tone === DARK);
        // ⚠️ Лупа — СЕСТРА кнопки выбора, а не вложена в неё. Кнопка внутри кнопки
        // невалидна, и клик по лупе всплывал бы в выбор: принт молча лёг бы на футболку,
        // а окно закрылось — ровно то, чего покупатель не просил.
        const wrap = mk('div', 'libm__cellwrap');
        const cell = mk('button', 'libm__cell' + (onDark ? ' libm__cell--dark' : ''));
        cell.type = 'button';
        const img = mk('img', 'libm__thumb');
        img.src = item.file;
        img.loading = 'lazy';
        img.alt = item.id;
        cell.append(img);
        cell.addEventListener('click', () => { onPick(item.file); this.closeModal(); });
        const zoom = mk('button', 'libm__zoom');
        zoom.type = 'button';
        zoom.title = 'Посмотреть крупнее';
        zoom.setAttribute('aria-label', 'Посмотреть принт крупнее: ' + item.id);
        zoom.innerHTML = LOUPE_SVG;
        zoom.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openPreview(items, idx, onPick);
        });
        wrap.append(cell, zoom);
        grid.append(wrap);
      });

      // Клиент 01.08 просил показывать только подходящие. Ссылку оставляем как страховку:
      // принт, помеченный не тем тоном, иначе пропал бы с сайта совсем и заметили бы нескоро.
      const hidden = this.hiddenNow();
      if (hidden > 0) {
        const more = mk('button', 'libm__more', 'Показать остальные (' + hidden + ')');
        more.type = 'button';
        more.title = 'Принты, рассчитанные на другой цвет футболки';
        more.addEventListener('click', () => { this.showAll = true; paint(); });
        grid.append(more);
      } else if (this.showAll && this.tone) {
        const less = mk('button', 'libm__more', 'Показать только подходящие');
        less.type = 'button';
        less.addEventListener('click', () => {
          this.showAll = false;
          if (!this.categoryList().some((c) => c.slug === this.activeSlug)) this.activeSlug = ALL_SLUG;
          paint();
        });
        grid.append(less);
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
    // Иерархия клавиш. Пока открыт просмотр, Esc гасит ТОЛЬКО его: иначе покупатель,
    // закрывая увеличенную картинку, вылетал бы из библиотеки целиком и искал бы её заново.
    this._onKey = (e) => {
      switch (keyAction(e.key, this.preview.isOpen)) {
        case 'closePreview': this._closePreview(); break;
        case 'next': this.preview.next(); this._paintPreview(); break;
        case 'prev': this.preview.prev(); this._paintPreview(); break;
        case 'closeModal': this.closeModal(); break;
        default: break;
      }
    };
    document.addEventListener('keydown', this._onKey);

    document.body.append(overlay);
    this.overlay = overlay;
    this._pinToViewport();
  }

  // На сайте конструктор стоит в iframe без своей прокрутки: его «экран» равен всей высоте
  // документа, поэтому обычный `fixed` с `inset: 0` растянул бы окно по СЕРЕДИНЕ
  // КОНСТРУКТОРА, а не по экрану покупателя. На телефоне это выглядело так, будто кнопка
  // «Выбрать принт» не работает. Поэтому положение считаем сами — см. pinStyle.
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
      const pin = pinStyle(box, viewportH);
      this.overlay.style.position = pin.position;
      this.overlay.style.top = pin.top + 'px';
      this.overlay.style.bottom = 'auto';
      this.overlay.style.height = pin.height + 'px';
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

  /**
   * Показать принт крупно. Слой живёт ВНУТРИ overlay, а не в body: положение окна
   * в iframe пересчитывает _pinToViewport, и отдельный узел снаружи за ним не поехал бы.
   *
   * ⚠️ Показываем ТОТ ЖЕ файл, что и в плитке. В библиотеку сознательно отдаётся
   * уменьшенное превью, а не оригинал 3111×4000 (см. .libm__thumb в app.css): 800 px
   * по высоте — это ~7 см при 300 dpi, перепечатать с них нельзя. «Увеличить» не должно
   * означать «отдать исходник» — иначе вся библиотека клиента утекает одним кликом.
   */
  _openPreview(items, index, onPick) {
    if (!this.overlay) return;
    this.preview.open(items, index);
    if (!this.preview.isOpen) return;

    const layer = mk('div', 'libp');
    const box = mk('div', 'libp__box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Просмотр принта');

    const close = mk('button', 'libp__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть просмотр');
    close.addEventListener('click', () => this._closePreview());

    const prev = mk('button', 'libp__nav libp__nav--prev', '‹');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Предыдущий принт');
    prev.addEventListener('click', () => { this.preview.prev(); this._paintPreview(); });

    const next = mk('button', 'libp__nav libp__nav--next', '›');
    next.type = 'button';
    next.setAttribute('aria-label', 'Следующий принт');
    next.addEventListener('click', () => { this.preview.next(); this._paintPreview(); });

    const img = mk('img', 'libp__img');
    img.alt = '';

    const foot = mk('div', 'libp__foot');
    const counter = mk('span', 'libp__counter');
    const take = mk('button', 'libp__take', 'Выбрать этот принт');
    take.type = 'button';
    take.addEventListener('click', () => {
      const file = this.preview.pick();
      if (!file) return;
      onPick(file);
      this.closeModal();
    });
    foot.append(counter, take);

    box.append(close, prev, img, next, foot);
    layer.append(box);
    // Клик мимо картинки закрывает ТОЛЬКО просмотр: библиотека под ним остаётся открытой.
    layer.addEventListener('click', (e) => { if (e.target === layer) this._closePreview(); });

    this.overlay.append(layer);
    this.previewEl = layer;
    this._paintPreview();
  }

  /** Перерисовать содержимое просмотра под текущий принт (открытие и листание). */
  _paintPreview() {
    const layer = this.previewEl;
    const item = this.preview.current;
    if (!layer || !item) return;
    const img = layer.querySelector('.libp__img');
    img.src = item.file;
    img.alt = item.id;
    // Та же тёмная подложка, что у плитки: белый принт на белом фоне иначе исчезает.
    const t = printTone(item);
    const onDark = t === DARK || (t === ANY && this.tone === DARK);
    layer.querySelector('.libp__box').classList.toggle('libp__box--dark', onDark);
    layer.querySelector('.libp__counter').textContent =
      (this.preview.index + 1) + ' из ' + this.preview.items.length;
    // Одна картинка в категории — листать некуда, кнопки прячем.
    const alone = this.preview.items.length < 2;
    layer.querySelector('.libp__nav--prev').hidden = alone;
    layer.querySelector('.libp__nav--next').hidden = alone;
  }

  _closePreview() {
    this.preview.close();
    if (this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
    }
  }

  closeModal() {
    if (!this.overlay) return;
    this._closePreview();
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

// Лупа с плюсом — тот же смысл, что кнопка увеличения у видеоплеера, с которой клиент
// и сравнивал («знаете, как в Ютубе, увеличить»). Инлайн, чтобы не тянуть шрифт иконок.
const LOUPE_SVG = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false">'
  + '<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/>'
  + '<path d="M8.5 6v5M6 8.5h5M12.8 12.8L17 17" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round"/></svg>';

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
