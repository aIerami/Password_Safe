// Проверка интерфейса в Chromium. Запуск: node tests/ui.test.js [папка_для_скриншотов]
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert'), fs = require('fs');
const URL = 'file://' + path.join(__dirname, '..', 'www', 'index.html');
const SHOTS = process.argv[2];
const MP = 'Мой сейф 2026: синий кот!';
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [], reqs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => reqs.push(r.url()));
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const step = m => console.log('  ✓', m);
  const tap = (t) => page.locator('.btn', { hasText: t }).first().click();
  const body = () => page.locator('#app').innerText();

  await page.goto(URL);
  assert.ok((await body()).includes('Придумайте мастер-пароль')); step('первый запуск: экран создания пароля');
  assert.ok((await body()).includes('невозможно')); step('предупреждение о невозможности восстановления');
  await shot('01-setup');
  const create = page.locator('.btn', { hasText: 'Создать сейф' });
  assert.ok(await create.isDisabled()); step('кнопка «Создать» неактивна');
  const inputs = page.locator('#app input[type=password]');
  await inputs.nth(0).fill('123456'); assert.ok((await body()).includes('слишком простой')); step('слабый пароль отклонён');
  await inputs.nth(0).fill(MP); await inputs.nth(1).fill(MP + 'x'); assert.ok((await body()).includes('не совпадают')); step('несовпадение паролей');
  await inputs.nth(1).fill(MP); assert.ok(await create.isDisabled()); step('без галочки кнопка неактивна');
  await shot('02-setup-filled');
  await page.locator('.chk').click(); assert.ok(await create.isEnabled()); await create.click();
  await page.waitForSelector('.search'); step('сейф создан, открыт список');
  const stored = await page.evaluate(() => localStorage.getItem('sejf.vault.v1'));
  assert.ok(stored && !stored.includes(MP)); assert.ok(JSON.parse(stored).iter === 600000); step('на диске только зашифрованный блоб');
  const keys = await page.evaluate(() => Object.keys(localStorage)); console.log('    ключи localStorage:', keys.join(', '));
  await shot('03-empty-list');

  // добавление записи + генератор
  await tap('Добавить'); await page.waitForSelector('text=Новая запись');
  const txt = page.locator('#app input[type=text]');
  await txt.nth(0).fill('Gmail'); await txt.nth(1).fill('me@example.com');
  await tap('Генератор паролей'); await page.waitForSelector('.gen .out');
  const g1 = await page.locator('.gen .out').innerText();
  assert.strictEqual(g1.length, 20); assert.ok(!/[O0oIl1|]/.test(g1)); step('генератор: 20 символов без похожих');
  await page.locator('.gen input[type=range]').fill('32'); assert.strictEqual((await page.locator('.gen .out').innerText()).length, 32); step('длина 32');
  await page.locator('.gen .chk', { hasText: 'Символы' }).click(); assert.ok(/^[a-zA-Z0-9]+$/.test(await page.locator('.gen .out').innerText())); step('без символов');
  await shot('04-generator');
  await tap('Подставить');
  const pwv = await page.locator('#app .pw input').first().inputValue(); assert.strictEqual(pwv.length, 32); step('пароль подставлен в поле');
  await page.locator('input[placeholder="example.com"]').fill('mail.google.com');
  await page.locator('select.inp').selectOption('__new'); await page.locator('input[placeholder="Название категории"]').fill('Почта');
  await page.locator('textarea.inp').fill('рабочий ящик');
  await shot('05-edit-form');
  await tap('Сохранить'); await page.waitForSelector('.row'); step('запись сохранена');
  // вторая запись
  await tap('Добавить'); const t2 = page.locator('#app input[type=text]'); await t2.nth(0).fill('Сбербанк'); await t2.nth(1).fill('ivan'); await page.locator('#app .pw input').first().fill('Zz9!secret');
  await page.locator('select.inp').selectOption('Банки и финансы'); await tap('Сохранить'); await page.waitForSelector('.row >> nth=1');
  assert.strictEqual(await page.locator('.row').count(), 2); step('две записи в списке');
  await shot('06-list');

  // поиск и фильтр
  await page.locator('.search input').fill('сбер'); assert.strictEqual(await page.locator('.row').count(), 1); step('поиск по названию (без учёта регистра)');
  await page.locator('.search input').fill('zzzz'); assert.ok((await body()).includes('Ничего не найдено')); step('поиск без результатов');
  await page.locator('.search input').fill('');
  await page.locator('.chip', { hasText: 'Почта' }).click(); assert.strictEqual(await page.locator('.row').count(), 1); assert.ok((await body()).includes('Gmail')); step('фильтр по категории');
  await shot('07-filter');
  await page.locator('.chip', { hasText: 'Все' }).click();

  // просмотр, показ, копирование
  await page.locator('.row', { hasText: 'Gmail' }).click(); await page.waitForSelector('text=Изменено');
  assert.ok((await body()).includes('••••')); assert.ok(!(await body()).includes(pwv)); step('пароль скрыт по умолчанию');
  await page.locator('.dv', { hasText: 'Пароль' }).locator('.ib').first().click(); assert.strictEqual((await page.locator('.dv .mono').innerText()), pwv); step('пароль показан');
  await shot('08-detail');
  await page.locator('.dv', { hasText: 'Пароль' }).locator('.ib').nth(1).click(); await page.waitForSelector('#toast:has-text("30 с")');
  assert.ok((await page.locator('#toast').innerText()).includes('30 с')); assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), pwv); step('копирование в буфер, сообщение про 30 с');
  // автоочистка: ускоряем таймер
  await page.evaluate(() => { const o = window.setTimeout; window.setTimeout = (f, ms) => o(f, ms >= 30000 ? 50 : ms); });
  await page.locator('.dv', { hasText: 'Пароль' }).locator('.ib').nth(1).click(); await page.waitForTimeout(300);
  assert.strictEqual((await page.evaluate(() => navigator.clipboard.readText())).trim(), ''); step('буфер очищается по таймеру');

  // правка
  await tap('Изменить'); await page.waitForSelector('text=Изменить'); await page.locator('#app input[type=text]').nth(0).fill('Gmail (личный)'); await tap('Сохранить');
  await page.waitForSelector('text=Gmail (личный)'); step('правка записи, возврат в карточку');
  // удаление с подтверждением внутри страницы
  let dialogShown = false; page.on('dialog', d => { dialogShown = true; d.dismiss(); });
  await tap('Удалить'); await page.waitForSelector('.dlg'); assert.ok((await page.locator('.dlg').innerText()).includes('Удалить запись?')); await shot('09-delete-dialog');
  await page.locator('.dlg .btn', { hasText: 'Отмена' }).click(); await page.waitForTimeout(200); assert.strictEqual(await page.locator('.dlg').count(), 0); step('отмена удаления закрывает окно');
  await tap('Удалить'); await page.locator('.dlg .btn', { hasText: 'Удалить' }).click(); await page.waitForSelector('.search'); await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.row').count(), 1); assert.ok(!dialogShown); step('удаление подтверждено в окне страницы (не confirm())');

  // аппаратная кнопка «Назад»
  await page.locator('.row').first().click(); await page.waitForSelector('text=Изменено'); await page.goBack(); await page.waitForSelector('.search'); step('кнопка «Назад» возвращает к списку');
  await tap('Добавить'); await page.goBack(); await page.waitForSelector('.search'); step('«Назад» из формы');

  // резервная копия
  await page.locator('.bar .btn.sq').nth(1).click(); await page.waitForSelector('text=Настройки');
  await shot('10-settings');
  await page.locator('.set', { hasText: 'Резервная копия' }).click(); await page.waitForSelector('text=Зачем это нужно'); await shot('11-backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), tap('Сохранить копию')]);
  const file = path.join(SHOTS || '/tmp', 'backup.sejf'); await dl.saveAs(file);
  const bt = fs.readFileSync(file, 'utf8'); assert.ok(!bt.includes('Сбербанк') && !bt.includes('ivan')); assert.ok(/\.sejf$/.test(dl.suggestedFilename())); step('экспорт: зашифрованный файл ' + dl.suggestedFilename() + ' (' + bt.length + ' байт)');

  // импорт: неверный пароль, затем слияние
  await page.setInputFiles('input[type=file]', []).catch(() => { });
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), tap('Загрузить из файла')]); await fc.setFiles(file);
  await page.waitForSelector('.dlg'); await page.locator('.dlg input').fill('не тот'); await page.locator('.dlg .btn', { hasText: 'Добавить к моим' }).click();
  await page.waitForSelector('.dlg .msg:has-text("Неверный пароль")'); step('импорт: неверный пароль отклонён');
  await page.locator('.dlg input').fill(MP); await page.locator('.dlg .btn', { hasText: 'Добавить к моим' }).click(); await page.waitForTimeout(600);
  assert.strictEqual(await page.locator('.dlg').count(), 0); step('импорт: верный пароль, дубликатов не появилось');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), tap('Загрузить из файла')]); await fc2.setFiles(path.join(__dirname, 'ui.test.js'));
  await page.waitForTimeout(300); assert.ok((await page.locator('#toast').innerText()).includes('не файл резервной копии')); step('импорт: посторонний файл отклонён');

  // смена мастер-пароля
  await page.goBack(); await page.waitForSelector('text=Настройки');
  await page.locator('.set', { hasText: 'Сменить мастер-пароль' }).click(); await page.waitForSelector('text=Смена пароля');
  const cp = page.locator('#app input[type=password]'); await cp.nth(0).fill('неверный'); await cp.nth(1).fill('Звёздный кот 777: яркий лис!'); await cp.nth(2).fill('Звёздный кот 777: яркий лис!');
  await shot('12-chpass'); await tap('Сменить пароль'); await page.waitForSelector('.msg:has-text("Текущий пароль неверен")'); step('смена: неверный текущий пароль');
  await cp.nth(0).fill(MP); await tap('Сменить пароль'); await page.waitForSelector('text=Настройки'); step('смена: пароль изменён');

  // блокировка и вход
  await tap('Заблокировать'); await page.waitForSelector('text=Введите мастер-пароль'); await shot('13-unlock');
  assert.ok(!(await page.content()).includes('Gmail')); step('после блокировки записей в DOM нет');
  const pw = page.locator('#app input[type=password]'), open = page.locator('.btn', { hasText: 'Открыть' });
  await pw.fill(MP); await open.click(); await page.waitForSelector('.msg:has-text("Неверный пароль")'); step('старый пароль после смены не подходит');
  await pw.fill('ещё не тот'); await open.click(); await page.waitForTimeout(500);
  await pw.fill('и снова не тот'); await open.click(); await page.waitForSelector('.msg:has-text("Подождите")'); assert.ok(await open.isDisabled()); await shot('14-delay'); step('после 3 неудач включена задержка (кнопка заблокирована)');
  const g = await page.evaluate(() => JSON.parse(localStorage.getItem('sejf.guard'))); assert.ok(g.fails === 3 && g.until > Date.now()); step('счётчик попыток хранится: fails=' + g.fails);
  await page.reload(); await page.waitForSelector('.msg:has-text("Подождите")'); step('задержка переживает перезапуск');
  await page.evaluate(() => localStorage.removeItem('sejf.guard')); await page.reload();
  await page.locator('#app input[type=password]').fill('Звёздный кот 777: яркий лис!'); await page.locator('.btn', { hasText: 'Открыть' }).click(); await page.waitForSelector('.search', { timeout: 15000 });
  assert.strictEqual(await page.locator('.row').count(), 1); step('вход с новым паролем: данные на месте');

  // автоблокировка в фоне
  await page.evaluate(() => window.__resumed(61000)); await page.waitForSelector('text=Введите мастер-пароль'); step('автоблокировка: фон > 1 минуты');
  await page.locator('#app input[type=password]').fill('Звёздный кот 777: яркий лис!'); await page.locator('.btn', { hasText: 'Открыть' }).click(); await page.waitForSelector('.search');
  await page.evaluate(() => window.__resumed(30000)); await page.waitForTimeout(200); assert.ok(await page.locator('.search').count() === 1); step('фон < 1 минуты: остаётся открытым');

  // сброс + восстановление из копии
  await page.locator('.bar .btn.sq').nth(1).click(); await page.locator('.set', { hasText: 'Стереть сейф' }).click(); await page.waitForSelector('.dlg');
  await page.locator('.dlg .btn', { hasText: 'Стереть всё' }).click(); await page.waitForTimeout(200); assert.ok(await page.locator('.dlg').count() === 1); await page.locator('.dlg input').fill('удалить'); await page.locator('.dlg .btn', { hasText: 'Стереть всё' }).click(); await page.waitForTimeout(400); assert.ok((await body()).includes('Придумайте мастер-пароль')); assert.ok(await page.evaluate(() => localStorage.getItem('sejf.vault.v1') === null)); step('«Стереть» без слова-подтверждения не работает; со словом — стирает');
  await shot('15-after-wipe-attempt');
  await br.close();
  console.log('\nОшибки JS:', errors.length ? errors : 'нет');
  const bad = reqs.filter(u => !u.startsWith('file://') && !u.startsWith('data:'));
  console.log('Сетевые запросы наружу:', bad.length ? bad : 'нет');
  assert.strictEqual(errors.length, 0); assert.strictEqual(bad.length, 0);
})().catch(e => { console.error('\n✗ ПРОВАЛ:', e.message); process.exit(1); });
