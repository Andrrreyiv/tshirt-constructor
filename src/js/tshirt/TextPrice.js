// TextPrice — цена текстового слоя (U2, ответ клиента 22.07).
// standalone — базовая цена текста; при наличии принта в дизайне текст получает
// скидку combinedDiscountPct (регулируемая опция админки). Логотип/принт — по StepPrice.

export class TextPrice {
  /** @param {{ standalone:number, combinedDiscountPct:number }} config */
  constructor(config) {
    this.standalone = config?.standalone ?? 0;
    this.discountPct = config?.combinedDiscountPct ?? 0;
  }

  /** Цена одного текста. hasPrint=true → применяется скидка комбо. */
  price(hasPrint) {
    if (!hasPrint) return this.standalone;
    return Math.round(this.standalone * (1 - this.discountPct / 100));
  }
}
