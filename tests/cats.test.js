// Проверка категорий в интерфейсе. Запуск: node tests/cats.test.js [папка_для_скриншотов]
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert'), fs = require('fs');
const URL = 'file://' + path.join(__dirname, '..', 'www', 'index.html');
const SHOTS = process.argv[2], MP = 'Мой сейф 2026: синий кот!';
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const step = m => console.log('  ✓', m), shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const tap = t => page.locator('.btn', { hasText: t }).first().click(), body = () => page.locator('#app').innerText();
  const chips = () => page.locator('.chip').allInnerTexts();
  const dlgTap = t => page.locator('.dlg .btn', { hasText: t }).click();
  const addEntry = async (title, cat) => { await tap('Добавить'); await page.waitForSelector('text=Новая запись'); await page.locator('#app input[type=text]').first().fill(title); if (cat) await page.locator('select.inp').selectOption(cat); await tap('Сохранить'); await page.waitForSelector('.search'); };

  await page.goto(URL);
  const pw = page.locator('#app input[type=password]'); await pw.nth(0).fill(MP); await pw.nth(1).fill(MP); await page.locator('.chk').click(); await tap('Создать сейф'); await page.waitForSelector('.search');
  assert.deepStrictEqual((await chips()).slice(0, 4), ['Все', 'Общее', 'Почта', 'Соцсети']); step('новый сейф: стандартные категории видны как фильтры');

  // создание из фильтра («＋ Группа»)
  await page.locator('.chip', { hasText: 'Группа' }).click(); await page.waitForSelector('.dlg');
  await dlgTap('Создать'); assert.ok((await page.locator('.dlg .msg').innerText()).includes('Введите название')); step('пустое название отклоняется');
  await page.locator('.dlg input').fill('  работа '); await dlgTap('Создать'); assert.ok((await page.locator('.dlg .msg').innerText()).includes('уже есть')); step('дубликат (без учёта регистра) отклоняется');
  await page.locator('.dlg input').fill('Семья'); await dlgTap('Создать'); await page.waitForSelector('.chip.on:has-text("Семья")'); step('«Семья» создана и выбрана как фильтр');
  await shot('c1-chips');

  // запись попадает в выбранную категорию по умолчанию
  await tap('Добавить'); await page.waitForSelector('text=Новая запись'); assert.strictEqual(await page.locator('select.inp').inputValue(), 'Семья'); step('в форме по умолчанию выбрана текущая категория');
  await page.locator('#app input[type=text]').first().fill('Wi-Fi дома'); await tap('Сохранить'); await page.waitForSelector('.row');
  await page.locator('.chip', { hasText: 'Все' }).click(); await addEntry('Gmail', 'Почта'); await addEntry('Яндекс', 'Почта');

  // новая категория из формы записи
  await tap('Добавить'); await page.locator('#app input[type=text]').first().fill('Госуслуги'); await page.locator('select.inp').selectOption('__new'); await page.locator('input[placeholder="Название категории"]').fill('государство'); await tap('Сохранить'); await page.waitForSelector('.row');
  assert.ok((await chips()).includes('государство')); step('категория, созданная прямо в форме записи, появилась в фильтрах');

  // экран «Категории»
  await page.locator('.bar .btn.sq').nth(1).click(); await page.locator('.set', { hasText: 'Категории' }).click(); await page.waitForSelector('text=Новая категория');
  const t = await body(); assert.ok(t.includes('Почта') && t.includes('2 записи') && t.includes('1 запись') && t.includes('0 записей')); step('экран категорий: счётчики записей'); await shot('c2-cats');
  await page.locator('.set', { hasText: 'Семья' }).click(); await page.waitForSelector('.dlg'); await shot('c3-cat-dialog');
  await page.locator('.dlg input').fill('Почта'); await dlgTap('Сохранить название'); assert.ok((await page.locator('.dlg .msg').innerText()).includes('уже есть')); step('переименование в существующее имя отклоняется');
  await page.locator('.dlg input').fill('Дом и семья'); await dlgTap('Сохранить название'); await page.waitForSelector('.set:has-text("Дом и семья")'); assert.ok((await body()).includes('1 запись')); step('переименование: записи переехали вместе с названием');
  await tap('Новая категория'); await page.locator('.dlg input').fill('Пустая'); await dlgTap('Создать'); await page.waitForSelector('.set:has-text("Пустая")'); step('создание на экране категорий');

  // удаление пустой
  await page.locator('.set', { hasText: 'Пустая' }).click(); await dlgTap('Удалить категорию'); await page.waitForSelector('.dlg:has-text("пуста")'); await dlgTap('Удалить'); await page.waitForTimeout(300); assert.ok(!(await body()).includes('Пустая')); step('удаление пустой категории');
  // удаление с переносом
  await page.locator('.set', { hasText: 'Почта' }).click(); await dlgTap('Удалить категорию'); await page.waitForSelector('.dlg select'); assert.strictEqual(await page.locator('.dlg select').inputValue(), 'Общее');
  await page.locator('.dlg select').selectOption('Работа'); await shot('c4-delete-cat'); await dlgTap('Удалить'); await page.waitForTimeout(300);
  assert.ok(!(await page.locator('.set').allInnerTexts()).some(x => x.startsWith('Почта'))); assert.ok((await page.locator('.set', { hasText: 'Работа' }).innerText()).includes('2 записи')); step('удаление с переносом: 2 записи переехали в «Работа», ничего не потеряно');

  // сохранение после блокировки
  await page.goBack(); await page.goBack(); await page.waitForSelector('.search'); await tap('Заблокировать').catch(() => { }); await page.locator('.bar .btn.sq').first().click();
  await page.waitForSelector('text=Введите мастер-пароль'); await page.locator('#app input[type=password]').fill(MP); await tap('Открыть'); await page.waitForSelector('.search');
  const c2 = await chips(); assert.ok(c2.includes('Дом и семья') && c2.includes('государство') && !c2.includes('Почта') && !c2.includes('Пустая')); step('после блокировки и входа категории сохранились');
  await page.locator('.chip', { hasText: 'Работа' }).click(); assert.strictEqual(await page.locator('.row').count(), 2); step('фильтр по категории с перенесёнными записями');

  // резервная копия содержит категории; импорт в чистый сейф переносит их
  await page.locator('.bar .btn.sq').nth(1).click(); await page.locator('.set', { hasText: 'Резервная копия' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), tap('Сохранить копию')]); const f = path.join(SHOTS || '/tmp', 'cats-backup.sejf'); await dl.saveAs(f);
  await page.evaluate(() => { localStorage.clear(); }); await page.reload();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), tap('У меня есть резервная копия')]); await fc.setFiles(f);
  await page.waitForSelector('.dlg'); await page.locator('.dlg input').fill(MP); await dlgTap('Восстановить'); await page.waitForSelector('.search');
  const c3 = await chips(); assert.ok(c3.includes('Дом и семья') && c3.includes('государство') && !c3.includes('Почта')); assert.strictEqual(await page.locator('.row').count(), 4); step('восстановление из копии: записи (4) и категории на месте');

  // старый сейф (без списка категорий) открывается и получает категории
  await page.evaluate(() => localStorage.clear()); await page.reload();
  const old = await page.evaluate(async MP => {
    const code = document.querySelector('script:not([src])').textContent; // функции шифрования из страницы
    const v = await createVault(MP, { entries: [{ id: 'z', title: 'Старая запись', login: '', password: 'p', url: '', note: '', cat: 'Моя старая группа', created: 1, updated: 1 }] });
    localStorage.setItem('sejf.vault.v1', JSON.stringify(v.blob)); return true;
  }, MP);
  await page.reload(); await page.locator('#app input[type=password]').fill(MP); await tap('Открыть'); await page.waitForSelector('.search');
  const c4 = await chips(); assert.ok(c4.includes('Моя старая группа') && c4.includes('Почта')); step('сейф версии 1.0 (без списка категорий) открывается: свои категории сохранены, стандартные добавлены');

  await br.close(); console.log('\nОшибки JS:', errors.length ? errors : 'нет'); assert.strictEqual(errors.length, 0);
})().catch(e => { console.error('\n✗ ПРОВАЛ:', e.message); process.exit(1); });
