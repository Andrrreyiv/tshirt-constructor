// main.browser.js — точка входа (как jetron): fetch конфига → валидация → App.start().
// ЗАГЛУШКА фазы 0: поток запуска задан, UI-механики подключаются по фазам.

import { validateConfig } from './core/ConfigLoader.js?v=20260730f';
import { TshirtApp } from './ui/TshirtApp.js?v=20260730f';
import { applyTshirtAdmin, applyPrintsOverride } from './tshirt/AdminOverrides.js?v=20260730f';
import { applyZonesOverride } from './tshirt/AdminOverrides.js?v=20260730f';
import { initTshirtZoneEditor } from './tshirt/zone-editor.browser.js?v=20260730f';

// Версия и у данных: без неё браузер отдавал старый конфиг из кеша, и правки не доезжали.
const CONFIG_URL = 'src/config/tshirt-mock-config.json?v=20260730f';

async function boot() {
  const res = await fetch(CONFIG_URL);
  if (!res.ok) throw new Error(`Конфиг не загружен: ${res.status}`);
  const config = await res.json();

  // Настройки из админ-страницы WordPress (jetron-tshirt-admin.php). Файла нет (демо на
  // GitHub Pages) или раздел битый — молча остаёмся на базовом конфиге.
  let config2 = config;
  try {
    const ares = await fetch('admin.json', { cache: 'no-store' });
    if (ares.ok) config2 = applyTshirtAdmin(config, await ares.json());
  } catch { /* админка не настроена */ }
  Object.assign(config, config2);

  // Зона печати, поправленная владельцем в редакторе (/tshirt/?zones=edit).
  try {
    const zres = await fetch('zones.json', { cache: 'no-store' });
    if (zres.ok) Object.assign(config, applyZonesOverride(config, await zres.json()));
  } catch { /* зону не правили */ }

  const { ok, errors } = validateConfig(config);
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error('[boot] конфиг невалиден:', errors);
    throw new Error('Валидация конфига провалена');
  }

  // Библиотека принтов (11 категорий = фильтры). Необязательна — при отсутствии
  // панель покажет только загрузку своего файла.
  let manifest = null;
  try {
    const mres = await fetch('src/config/prints-manifest.json?v=20260730f');
    if (mres.ok) manifest = await mres.json();
    // Категории и картинки, заведённые владельцем в админке, перекрывают базовую библиотеку.
    const pres = await fetch('prints.json', { cache: 'no-store' });
    if (pres.ok) manifest = applyPrintsOverride(manifest, await pres.json());
  } catch { /* библиотека опциональна */ }

  const app = new TshirtApp({
    config,
    viewsEl: document.getElementById('views'),
    panelEl: document.getElementById('panel'),
    colorEl: document.getElementById('colorpick'),
    manifest
  });
  app.start();

  // Админ-режим правки рамки печати. Покупатель его не видит: нужен ?zones=edit и вход в WP.
  window.__tshirtZoneEditor = initTshirtZoneEditor(app);

  window.__tshirtApp = app; // отладка
  return app;
}

boot().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[boot] ошибка запуска:', err);
});
