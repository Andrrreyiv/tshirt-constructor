// Просмотр принта крупно — модель без DOM.
//
// Клиент 09.09 (голосовое 14:19): «когда выбираешь принт на футболку, человек по сути
// не может этот принт разглядеть… нет кнопочки, как в Ютубе, увеличить… чтобы принт
// открылся, ну как бы НЕ НА ВЕСЬ ЭКРАН, а хотя бы в доступное обозримое поле».
// Замер боевого 10.09: плитка 138×138 при файле 622×800…1596×1500 — ужато в 4,5-5,8 раза.
//
// Логика вынесена сюда, а не оставлена в обработчиках LibraryPanel, по той же причине,
// что и PanelAccordion: состояние «что показываем и где мы в списке» проверяется тестами
// без браузера, а DOM-слой остаётся тонким.
export class PrintPreview {
  constructor() {
    this.items = [];
    this.index = -1;
  }

  /**
   * Открыть просмотр на позиции `index` списка `items`.
   * Пустой список молча не открывается: отбор по тону умеет спрятать всю категорию,
   * и показывать в этом случае нечего.
   * Индекс за границами прижимается к краю — вызывающему коду не нужно его стеречь.
   */
  open(items, index) {
    if (!Array.isArray(items) || items.length === 0) return;
    this.items = items;
    this.index = clamp(index, 0, items.length - 1);
  }

  get isOpen() {
    return this.index >= 0;
  }

  get current() {
    return this.isOpen ? this.items[this.index] : null;
  }

  /**
   * Листание зациклено, а не упирается в край: в категории «Все картинки» их 82,
   * и молчащая кнопка на последней читается как поломка, а не как конец списка.
   */
  next() {
    if (!this.isOpen) return;
    this.index = (this.index + 1) % this.items.length;
  }

  prev() {
    if (!this.isOpen) return;
    this.index = (this.index - 1 + this.items.length) % this.items.length;
  }

  /** Файл картинки, которая сейчас на экране. Листание само по себе ничего не выбирает. */
  pick() {
    return this.current ? this.current.file : null;
  }

  close() {
    this.items = [];
    this.index = -1;
  }
}

function clamp(n, lo, hi) {
  const v = Number.isFinite(n) ? n : lo;
  return Math.min(hi, Math.max(lo, v));
}
