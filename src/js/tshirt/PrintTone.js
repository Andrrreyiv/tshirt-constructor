// Подбор принтов под цвет изделия (клиент 01.08, два голосовых).
// Дословно: «какой смысл ему показывать принты для чёрных футболок», когда выбрана белая,
// и «есть принты третьей категории, которые туда и туда».
//
// Модель: у принта ТРИ состояния вместо прежней галочки «тёмный» — для светлых, для тёмных
// и для любых. Старый флаг `dark` продолжаем понимать, иначе разметка, которую владелец уже
// проделал руками, пропала бы: dark=true читается как «для тёмных», отсутствие — «для светлых».
// Поэтому переносить ничего не нужно, достаточно доотметить универсальные.
//
// ⚠️ Универсальный принт — это не «красиво на обоих», а ПРОЗРАЧНЫЙ ФОН. Картинка с залитым
// белым фоном на чёрной футболке даёт белый прямоугольник. Та же формулировка выведена
// подсказкой в админке, иначе разметка поедет и её придётся переделывать.

export const LIGHT = 'light';
export const DARK = 'dark';
export const ANY = 'any';

const TONES = [LIGHT, DARK, ANY];

/** Тон принта. Незнакомое значение и мусор трактуем как «для светлых» — так вело себя прежнее поле. */
export function printTone(item) {
  if (!item || typeof item !== 'object') return LIGHT;
  if (TONES.indexOf(item.tone) !== -1) return item.tone;
  return item.dark ? DARK : LIGHT;
}

/**
 * Тон изделия. Берём явный `tone` цвета, иначе считаем по яркости hex.
 * Расчёт по яркости нужен как запас: владелец добавляет цвета через админку и тон у них
 * может быть не проставлен, а библиотека всё равно обязана отфильтроваться разумно.
 */
export function colorTone(color) {
  if (!color || typeof color !== 'object') return LIGHT;
  if (color.tone === LIGHT || color.tone === DARK) return color.tone;

  const hex = String(color.hex || '').trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return LIGHT;

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Воспринимаемая яркость: глаз сильнее всего реагирует на зелёный, слабее всего на синий.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum >= 0.5 ? LIGHT : DARK;
}

/** Подходит ли принт изделию этого тона. Универсальный подходит всегда. */
export function fitsTone(item, tone) {
  const t = printTone(item);
  return t === ANY || t === tone;
}

/**
 * Категории, отфильтрованные под тон изделия. Категории, где после отбора не осталось
 * ни одной картинки, выбрасываем: иначе покупатель откроет её и увидит пустоту (клиент
 * просил «чтобы не открывались пустыми»). Исходный массив не мутируем.
 */
export function filterCategories(categories, tone) {
  const out = [];
  for (const c of Array.isArray(categories) ? categories : []) {
    if (!c || !Array.isArray(c.items)) continue;
    const items = c.items.filter((i) => fitsTone(i, tone));
    if (items.length) out.push({ ...c, items });
  }
  return out;
}

/** Сколько картинок скрыто отбором — для ссылки «показать остальные». 0 = прятать нечего. */
export function hiddenCount(categories, tone) {
  let all = 0;
  let fit = 0;
  for (const c of Array.isArray(categories) ? categories : []) {
    if (!c || !Array.isArray(c.items)) continue;
    all += c.items.length;
    fit += c.items.filter((i) => fitsTone(i, tone)).length;
  }
  return all - fit;
}
