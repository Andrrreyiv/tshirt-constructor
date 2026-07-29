// Настройки из админки поверх базового конфига конструктора футболок.
// Пишет их страница «Конструктор футболок» в WordPress (jetron-tshirt-admin.php):
//   admin.json  — цены печати и надписи, цвета, мокапы
//   prints.json — категории библиотеки принтов и картинки в них
// Правило то же, что и в конструкторе формы: битый раздел игнорируется целиком,
// конструктор остаётся на базовом конфиге и не падает.
// Цена САМОГО ИЗДЕЛИЯ здесь не участвует — она приходит из карточки товара WooCommerce.

export function applyTshirtAdmin(config, admin) {
  const out = clone(config);
  if (!admin || typeof admin !== 'object') return out;

  applyPrices(out, admin.prices);
  out.colors = listOr(out.colors, admin.colors, isColor);
  out.forms = listOr(out.forms, admin.forms, isForm);
  return out;
}

export function applyPrintsOverride(manifest, override) {
  const out = clone(manifest || { categories: [] });
  if (!override || !Array.isArray(override.categories) || !override.categories.length) return out;
  const clean = override.categories.filter(isCategory).map((c) => ({
    slug: String(c.slug),
    label: String(c.label),
    // Позиция без файла бесполезна: превью не покажешь и на футболку не положишь.
    items: (Array.isArray(c.items) ? c.items : []).filter((i) => i && str(i.file)).map(clone)
  }));
  if (clean.length) out.categories = clean;
  return out;
}

function applyPrices(out, prices) {
  if (!prices || typeof prices !== 'object') return;

  // Ступенчатые тарифы печати: заменяем целиком по методу, но только если пришёл
  // непустой список корректных ступеней — иначе цена печати обнулилась бы у покупателя.
  const methods = prices.print && prices.print.methods;
  if (methods && typeof methods === 'object') {
    for (const [id, m] of Object.entries(methods)) {
      if (!out.prices.print.methods[id] || !m || !Array.isArray(m.tiers)) continue;
      const tiers = m.tiers.filter(isTier).map(clone);
      if (tiers.length) out.prices.print.methods[id].tiers = tiers;
      if (str(m.label)) out.prices.print.methods[id].label = m.label;
    }
  }
  if (prices.text && typeof prices.text === 'object') {
    if (isMoney(prices.text.standalone)) out.prices.text.standalone = Number(prices.text.standalone);
    if (isPct(prices.text.combinedDiscountPct)) out.prices.text.combinedDiscountPct = Number(prices.text.combinedDiscountPct);
  }
}

// Пустой список из админки означает «не трогай», а не «удали всё».
function listOr(base, list, isValid) {
  if (!Array.isArray(list)) return base;
  const clean = list.filter(isValid).map(clone);
  return clean.length ? clean : base;
}

const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPct = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const str = (v) => typeof v === 'string' && v.trim() !== '';

const isTier = (t) => !!t && isMoney(t.price) && t.price > 0
  && typeof t.wCm === 'number' && t.wCm > 0
  && typeof t.hCm === 'number' && t.hCm > 0;

const isColor = (c) => !!c && str(c.id) && str(c.name) && str(c.hex);
const isForm = (f) => !!f && str(f.id) && str(f.type) && str(f.colorId) && str(f.color)
  && !!f.images && str(f.images.front);
const isCategory = (c) => !!c && str(c.slug) && str(c.label);

function clone(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
