// Recolor — программная перекраска футболки + варёнка-overlay (C4).
// Белый/чёрный/сл.кость — фото-мокапы. Прочие цвета — tint/multiply по белому мокапу.
// «Варёнка» — наложение полупрозрачной текстуры. ЗАГЛУШКА фазы 0: логика — фаза 6.
// База уже проверена: 2 спины (base ivory, over black) восстановлены этим методом (U13).

export class Recolor {
  constructor(config) {
    this.config = config;
  }

  // TODO(фаза 6): применить перекраску (multiply factor по hex цвета) к мокапу.
  applyTint(/* imageEl, hex */) {
    return null;
  }

  // TODO(фаза 6): наложить overlay-текстуру варёнки (U7 — образец от клиента).
  applyTieDye(/* imageEl, textureEl */) {
    return null;
  }
}
