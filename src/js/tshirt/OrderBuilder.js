// OrderBuilder — чистая сборка состояния конструктора в сериализуемый итог заказа.
// Единый источник цены: те же StepPrice (принт, U1) и TextPrice (текст, U2), что и в UI,
// плюс база футболки ТИП×ПЛОТНОСТЬ (U3). Итог передаётся в корзину/WooCommerce (за блокером).
// Возвращает plain-объект — сервер сможет независимо пересчитать по тем же правилам.

/**
 * @param {{ config, state, layers, scalers, priceCalc, textPrice }} deps
 *  state: { type, colorId, side, age, densityG, printMethod }
 *  layers: LayerManager · scalers: {view: CmScaler}
 *  priceCalc: StepPrice · textPrice: TextPrice
 */
export function buildOrder({ config, state, layers, scalers, priceCalc, textPrice }) {
  const form = (config.forms || []).find(
    f => f.type === state.type && f.colorId === state.colorId
  );

  // U3: база = ТИП × ПЛОТНОСТЬ (fallback — первая доступная плотность типа).
  const byDensity = config.prices?.form?.[state.type] ?? {};
  let base = byDensity[String(state.densityG)];
  if (!Number.isFinite(base)) base = Object.values(byDensity)[0];
  base = Number.isFinite(base) ? base : 0;

  // U2: текст получает скидку только если в дизайне есть хоть один принт.
  const hasPrint = layers.hasKind('print');

  const sides = {};
  let printsTotal = 0;
  let textsTotal = 0;

  for (const side of config.sides.map(s => s.id)) {
    const scaler = scalers?.[side];
    const prints = [];
    const texts = [];
    for (const d of layers.list(side)) {
      if ((d.kind ?? 'print') === 'text') {
        const price = textPrice.price(hasPrint);
        texts.push({ text: d.text, color: d.color, price });
        textsTotal += price;
      } else {
        const cm = scaler ? scaler.sizeCm(d.fw, d.fh) : { w: 0, h: 0 };
        const price = priceCalc.price(cm.w, cm.h, state.printMethod);
        prints.push({ src: d.src, cm: { w: Math.round(cm.w), h: Math.round(cm.h) }, price });
        printsTotal += price;
      }
    }
    sides[side] = { prints, texts };
  }

  const total = base + printsTotal + textsTotal;

  return {
    product: {
      type: state.type,
      typeLabel: form?.typeLabel ?? state.type,
      color: form?.color ?? state.colorId,
      colorId: state.colorId,
      densityG: state.densityG,
      age: state.age,
    },
    method: state.printMethod,
    methodLabel: config.prices?.print?.methods?.[state.printMethod]?.label ?? state.printMethod,
    hasPrint,
    sides,
    price: { base, prints: printsTotal, texts: textsTotal, total },
  };
}
