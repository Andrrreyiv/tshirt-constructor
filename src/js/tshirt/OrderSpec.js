// Спецификация заказа футболки для сервера.
//
// Приём заказа сделан по образцу конструктора ФОРМЫ: скрытая форма POST уходит
// в `?add-to-cart=<товар>`, а цену пересчитывает сервер. Правило оттуда (jetron-orders.php):
// присланное браузером число НИКОГДА не становится ценой — иначе покупатель подменит сумму
// в браузере и купит футболку за рубль. Число едет рядом только для сверки.
//
// Отсюда состав: серверу нужны ИСХОДНЫЕ ДАННЫЕ (фасон, плотность, возраст, сантиметры принтов,
// число надписей, количество), а всё ценовое он берёт из своего конфига.

const MAX_QTY = 1000; // потолок от случайного заказа «на миллион»; у формы та же идея в MIN/MAX_UNIT

/**
 * @param {object} order результат OrderBuilder.buildOrder
 * @param {{quantity?: number, withText?: boolean}} opts
 * @returns {object} спецификация; при withText — ещё и человекочитаемый specText
 */
export function orderSpec(order, opts = {}) {
  const p = (order && order.product) || {};
  const sides = (order && order.sides) || {};
  const spec = {
    type: p.type,
    typeLabel: p.typeLabel,
    densityG: p.densityG,
    colorId: p.colorId,
    color: p.color,
    // Возраст задаёт рамку печати (40×50 против 30×40), поэтому он для цены значим.
    age: p.age === 'child' ? 'child' : 'adult',
    method: order && order.method,
    hasPrint: !!(order && order.hasPrint),
    quantity: количество(opts.quantity),
    sides: {
      front: сторона(sides.front),
      back: сторона(sides.back),
    },
  };
  if (!opts.withText) return spec;
  return { ...spec, specText: текстСпецификации(order, spec) };
}

// Картинки в спецификацию не кладём: принты почти всегда data-URL (PrintEditor обрезает
// прозрачные поля и перезаписывает src), и base64 раздул бы POST до сотен килобайт.
// Менеджер увидит макет отдельным PNG — так же, как в конструкторе формы.
function сторона(s) {
  const prints = ((s && s.prints) || []).map((pr) => ({
    wCm: Math.round((pr.cm && pr.cm.w) || 0),
    hCm: Math.round((pr.cm && pr.cm.h) || 0),
  }));
  return { prints, texts: ((s && s.texts) || []).length };
}

function количество(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QTY);
}

// Текст для корзины и письма заказа: менеджеру нужно понимать состав, не открывая картинку.
function текстСпецификации(order, spec) {
  const строки = [];
  строки.push(`Футболка: ${spec.typeLabel || spec.type || '—'}, ${spec.densityG || '—'} г, ${spec.color || spec.colorId || '—'}`);
  строки.push(`Размер печати: ${spec.age === 'child' ? 'детский' : 'взрослый'}`);
  if (order && order.methodLabel) строки.push(`Нанесение: ${order.methodLabel}`);
  for (const [id, подпись] of [['front', 'Грудь'], ['back', 'Спина']]) {
    const s = (order.sides || {})[id] || {};
    const принты = (s.prints || []).map((pr) => `принт ${Math.round(pr.cm.w)}×${Math.round(pr.cm.h)} см`);
    const тексты = (s.texts || []).map((t) => `надпись «${t.text}»${t.fontName ? ` (${t.fontName})` : ''}`);
    const всё = [...принты, ...тексты];
    if (всё.length) строки.push(`${подпись}: ${всё.join(', ')}`);
  }
  строки.push(`Количество: ${spec.quantity} шт.`);
  return строки.join('\n');
}
