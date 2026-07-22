// QualityHint — умная подсказка о качестве принта (C20).
// Показывается ТОЛЬКО для крупных принтов (эвристика разрешение-к-размеру);
// при уменьшении принта — убирается. ЗАГЛУШКА фазы 0: логика — фаза 6.

export class QualityHint {
  constructor(config) {
    this.config = config;
  }

  // TODO(фаза 6): нужна ли подсказка? true только если принт крупный И dpi низкий.
  shouldWarn(/* imgWidthPx, imgHeightPx, printCm */) {
    return false;
  }
}
