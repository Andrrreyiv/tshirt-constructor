// StepPrice — ступенчатая цена нанесения принта (U1, ответ клиента 22.07).
export class StepPrice {
  /** @param {{ method:string, rule:string, methods:Record<string,{tiers:{wCm:number,hCm:number,price:number}[]}> }} config */
  constructor(config) {
    this.config = config;
    this.methods = config?.methods ?? {};
  }

  /** Цена нанесения принта wCm×hCm выбранным методом (min-containing, с потолком). */
  price(wCm, hCm, method = this.config?.method) {
    if (!(wCm > 0) || !(hCm > 0)) return 0;
    const tiers = this.methods[method]?.tiers ?? [];
    if (tiers.length === 0) return 0;

    const containing = tiers.filter(t => t.wCm >= wCm && t.hCm >= hCm);
    if (containing.length > 0) {
      return Math.min(...containing.map(t => t.price));
    }
    // Больше всех рамок — потолок (максимальная цена тарифной сетки).
    return Math.max(...tiers.map(t => t.price));
  }
}
