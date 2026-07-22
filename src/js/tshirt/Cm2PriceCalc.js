// Cm2PriceCalc — цена принта по площади в см² (C14).
// Плавно, не ступенями по формату. Точка 10x10=300. Кусочно-линейная по grid[]
// ИЛИ единая ставка ₽/см². ЗАГЛУШКА фазы 0: сетка ждёт U1, пока ratePerCm2.

export class Cm2PriceCalc {
  /**
   * @param {{ seedPoint:{wCm,hCm,price}, ratePerCm2:number, grid:Array }} printPrices
   */
  constructor(printPrices) {
    this.cfg = printPrices;
  }

  // TODO(фаза 2): цена по площади см². Пока — ставка ratePerCm2 (заглушка, U1).
  price(/* areaCm2 */) {
    return 0;
  }

  // TODO(фаза 2): кусочно-линейная интерполяция по grid[] (10x10=300, A5, A4, A3).
  interpolate(/* areaCm2 */) {
    return 0;
  }
}
