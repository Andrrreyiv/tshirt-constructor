// Что попадает в скачиваемый макет.
// Клиент 01.08: «сделал принт на футболку только на груди, а скачалась картинка и с грудью,
// и со спиной, то есть это не надо… если он на спину сделал, то тоже принт только со спины
// скачивался… если только он на две стороны сделал принты, то даст два».

/**
 * Стороны, которые нужно положить в макет.
 * @param {{id:string}[]} sides — все стороны изделия в порядке показа
 * @param {(id:string)=>boolean} hasContent — есть ли на стороне нанесения
 * @param {string} activeSide — сторона, открытая у покупателя сейчас
 *
 * Пусто везде — отдаём активную сторону. Иначе кнопка «Скачать макет» молча ничего не делает
 * и выглядит сломанной, хотя покупатель просто ещё ничего не добавил.
 * Порядок сторон сохраняем исходный: грудь всегда левее спины, как на макете у клиента.
 */
export function sidesToExport(sides, hasContent, activeSide) {
  const all = Array.isArray(sides) ? sides.filter(Boolean) : [];
  if (!all.length) return [];
  const filled = all.filter((s) => {
    try { return !!hasContent(s.id); } catch { return false; }
  });
  if (filled.length) return filled;
  const active = all.filter((s) => s.id === activeSide);
  return active.length ? active : [all[0]];
}
