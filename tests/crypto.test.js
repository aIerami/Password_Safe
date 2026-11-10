// Тест шифрования и вспомогательной логики. Запуск: node tests/crypto.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a) + a.length, html.indexOf(b));
const code = cut('/*CRYPTO-BEGIN*/', '/*CRYPTO-END*/') + cut('/*UTIL-BEGIN*/', '/*UTIL-END*/');
const names = 'KDF_ITER,KDF_MIN,toB64,fromB64,deriveKey,sealData,openData,createVault,unlockVault,checkBlob,generatePassword,genBits,passwordBits,strengthLevel,mergeEntries,randInt,SETS,mergeCats,catIndex,normCat,plural'.split(',');
const L = new Function(code + '\nreturn {' + names.join(',') + '};')();
let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };
const rejects = async (p, msg, name) => { try { await p; } catch (e) { assert.strictEqual(e.message, msg, name + ': ' + e.message); return ok(name); } assert.fail(name + ': не было ошибки'); };

(async () => {
  console.log('Шифрование');
  assert.ok(L.KDF_ITER >= 600000); ok('итераций PBKDF2 не меньше 600 000 (' + L.KDF_ITER + ')');
  const data = { entries: [{ id: '1', title: 'Почта', login: 'я@пример.рф', password: 'п@роль-✓-😀', url: '', note: 'заметка\nв две строки', cat: 'Общее' }] };
  let t = Date.now();
  const v = await L.createVault('Правильный пароль 2026!', data);
  console.log('    (создание хранилища: ' + (Date.now() - t) + ' мс)');
  const stored = JSON.parse(JSON.stringify(v.blob));
  assert.strictEqual(stored.iter, 600000); assert.strictEqual(L.fromB64(stored.salt).length, 16); assert.strictEqual(L.fromB64(stored.iv).length, 12);
  ok('формат: соль 16 байт, IV 12 байт, iter=600000');
  assert.ok(!JSON.stringify(stored).includes('Почта') && !JSON.stringify(stored).includes('пример'));
  ok('в зашифрованном виде нет открытого текста');

  const r = await L.unlockVault('Правильный пароль 2026!', stored);
  assert.deepStrictEqual(r.data, data); ok('верный пароль: данные расшифрованы без потерь (включая кириллицу и эмодзи)');
  assert.strictEqual(r.key.extractable, false); ok('ключ неизвлекаемый (extractable=false)');
  assert.strictEqual(r.key.algorithm.length, 256); ok('AES-256');

  await rejects(L.unlockVault('Неправильный пароль', stored), 'AUTH', 'неверный пароль отклоняется');
  await rejects(L.unlockVault('правильный пароль 2026!', stored), 'AUTH', 'пароль с другим регистром отклоняется');
  await rejects(L.unlockVault('', stored), 'AUTH', 'пустой пароль отклоняется');

  const flip = (b64, i) => { const u = L.fromB64(b64); u[i] ^= 1; return L.toB64(u); };
  const mod = (k, f) => Object.assign({}, stored, { [k]: f(stored[k]) });
  await rejects(L.unlockVault('Правильный пароль 2026!', mod('ct', s => flip(s, 3))), 'AUTH', 'повреждён байт шифртекста');
  const ctLen = L.fromB64(stored.ct).length;
  await rejects(L.unlockVault('Правильный пароль 2026!', mod('ct', s => flip(s, ctLen - 1))), 'AUTH', 'повреждён тег аутентификации');
  await rejects(L.unlockVault('Правильный пароль 2026!', mod('iv', s => flip(s, 0))), 'AUTH', 'повреждён IV');
  await rejects(L.unlockVault('Правильный пароль 2026!', mod('salt', s => flip(s, 0))), 'AUTH', 'повреждена соль');
  await rejects(L.unlockVault('Правильный пароль 2026!', mod('ct', s => L.toB64(L.fromB64(s).subarray(0, ctLen - 5)))), 'AUTH', 'шифртекст обрезан');
  await rejects(L.unlockVault('Правильный пароль 2026!', Object.assign({}, stored, { iter: 600001 })), 'AUTH', 'подмена числа итераций');
  await rejects(L.unlockVault('Правильный пароль 2026!', Object.assign({}, stored, { iter: 1000 })), 'FORMAT', 'слишком малое число итераций отклоняется');
  await rejects(L.unlockVault('x', Object.assign({}, stored, { iter: 999999999 })), 'FORMAT', 'огромное число итераций отклоняется (защита от зависания)');
  await rejects(L.unlockVault('x', { v: 1 }), 'FORMAT', 'мусорный объект');
  await rejects(L.unlockVault('x', null), 'FORMAT', 'null');
  await rejects(L.unlockVault('x', Object.assign({}, stored, { salt: '!!!не base64' })), 'FORMAT', 'некорректный base64');
  await rejects(L.unlockVault('x', Object.assign({}, stored, { v: 2 })), 'FORMAT', 'неизвестная версия');

  // новый IV при каждом сохранении, шифртексты разные
  const a = await L.sealData(data, r.key, r.salt, r.iter), b = await L.sealData(data, r.key, r.salt, r.iter);
  assert.notStrictEqual(a.iv, b.iv); assert.notStrictEqual(a.ct, b.ct); ok('новый случайный IV при каждом сохранении');
  const r2 = await L.unlockVault('Правильный пароль 2026!', b); assert.deepStrictEqual(r2.data, data); ok('повторно зашифрованное тоже открывается');
  const v2 = await L.createVault('Правильный пароль 2026!', data);
  assert.notStrictEqual(v2.blob.salt, stored.salt); ok('соль случайная для каждого хранилища');

  // смена мастер-пароля
  const nv = await L.createVault('Новый пароль 777!', r.data);
  await rejects(L.unlockVault('Правильный пароль 2026!', nv.blob), 'AUTH', 'после смены старый пароль не подходит');
  assert.deepStrictEqual((await L.unlockVault('Новый пароль 777!', nv.blob)).data, data); ok('после смены новый пароль открывает те же данные');

  // NFKC: один и тот же пароль в разной форме Unicode
  const nf = await L.createVault('é', { entries: [] });
  await L.unlockVault('é', nf.blob); ok('Unicode-нормализация пароля (é = e + ◌́)');

  // большое хранилище
  const big = { entries: Array.from({ length: 3000 }, (_, i) => ({ id: String(i), title: 'T' + i, login: 'l', password: 'p'.repeat(40), url: '', note: 'x'.repeat(200), cat: 'c' })) };
  const bv = await L.createVault('big', big); assert.strictEqual((await L.unlockVault('big', bv.blob)).data.entries.length, 3000); ok('3000 записей (~1 МБ) шифруются и читаются');

  console.log('Генератор паролей');
  const opt = { len: 24, lower: true, upper: true, digits: true, symbols: true, nosim: true };
  for (let i = 0; i < 500; i++) {
    const p = L.generatePassword(opt);
    assert.strictEqual(p.length, 24);
    assert.ok(!/[O0oIl1|]/.test(p), 'похожие символы: ' + p);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p) && /[^a-zA-Z0-9]/.test(p), 'нет набора: ' + p);
  }
  ok('500 паролей: длина, исключение 0/O/o/1/l/I/|, есть символы из каждого набора');
  const dg = L.generatePassword({ len: 12, lower: false, upper: false, digits: true, symbols: false, nosim: false }); assert.ok(/^[0-9]{12}$/.test(dg)); ok('только цифры');
  const none = L.generatePassword({ len: 10, lower: false, upper: false, digits: false, symbols: false, nosim: false }); assert.strictEqual(none.length, 10); ok('все наборы выключены: не ломается');
  const sh = L.generatePassword({ len: 3, lower: true, upper: true, digits: true, symbols: true, nosim: false }); assert.ok(sh.length >= 4); ok('длина не меньше числа наборов');
  const cnt = new Array(10).fill(0); for (let i = 0; i < 100000; i++) cnt[L.randInt(10)]++;
  const mn = Math.min(...cnt), mx = Math.max(...cnt); assert.ok(mn > 9500 && mx < 10500, cnt.join()); ok('randInt равномерен (100 000 бросков: ' + mn + '..' + mx + ')');
  const uniq = new Set(Array.from({ length: 2000 }, () => L.generatePassword(opt))); assert.strictEqual(uniq.size, 2000); ok('2000 паролей без повторов');
  assert.ok(L.genBits(opt) > 140); ok('оценка стойкости генератора: ' + L.genBits(opt) + ' бит');

  console.log('Индикатор надёжности мастер-пароля');
  const lv = p => L.strengthLevel(L.passwordBits(p), p);
  const show = p => p + ' → ' + L.passwordBits(p) + ' бит, ' + lv(p).text + (lv(p).ok ? ' (принят)' : ' (отклонён)');
  for (const p of ['123456', 'password', 'qwerty123456', 'aaaaaaaaaaaa', '12345678901234', 'йцукенгшщзх', 'пароль1234567', 'Summer2024', 'randomletters', 'horse battery staple', 'correct horse battery staple', 'Tr0ub4dor&3x!', 'Мой сейф 2026: синий кот!', 'k7#Qm2$vXp9@Lw4!']) console.log('    ' + show(p));
  for (const p of ['123456', 'password', 'qwerty123456', 'aaaaaaaaaaaa', '12345678901234', 'йцукенгшщзх', 'пароль1234567', 'Summer2024']) assert.ok(!lv(p).ok, 'должен быть отклонён: ' + p);
  for (const p of ['correct horse battery staple', 'Мой сейф 2026: синий кот!', 'k7#Qm2$vXp9@Lw4!']) assert.ok(lv(p).ok, 'должен быть принят: ' + p);
  ok('слабые отклоняются, длинные фразы и случайные пароли принимаются');

  console.log('Слияние при импорте');
  const cur = [{ id: 'a', title: 'A', login: 'x', password: '1', updated: 5 }, { id: 'b', title: 'B', login: 'x', password: '2', updated: 5 }];
  const inc = [{ id: 'a', title: 'A2', login: 'x', password: '1', updated: 9 }, { id: 'b', title: 'B-old', login: 'x', password: '2', updated: 1 }, { id: 'c', title: 'C', login: 'y', password: '3', updated: 1 }, { id: 'd', title: 'B', login: 'x', password: '2', updated: 1 }];
  const m = L.mergeEntries(cur, inc);
  assert.strictEqual(m.entries.length, 3); assert.strictEqual(m.entries.find(e => e.id === 'a').title, 'A2'); assert.strictEqual(m.entries.find(e => e.id === 'b').title, 'B');
  assert.strictEqual(m.added, 1); assert.strictEqual(m.updated, 1); ok('новые добавляются, более свежие обновляются, дубликаты и старые версии пропускаются');

  console.log('Категории');
  assert.strictEqual(L.normCat('  Семья   и  друзья '), 'Семья и друзья'); assert.strictEqual(L.normCat('x'.repeat(50)).length, 30); ok('нормализация названия');
  assert.strictEqual(L.catIndex(['Почта', 'Работа'], ' работа '), 1); assert.strictEqual(L.catIndex(['Почта'], 'Банк'), -1); ok('поиск без учёта регистра и пробелов');
  assert.deepStrictEqual(L.mergeCats(['A', 'B'], ['b', 'C', '', 5, ' c ']), ['A', 'B', 'C']); assert.deepStrictEqual(L.mergeCats(null, undefined), []); ok('объединение списков категорий');
  assert.deepStrictEqual([0, 1, 2, 5, 11, 21, 22, 111, 114].map(L.plural), ['0 записей', '1 запись', '2 записи', '5 записей', '11 записей', '21 запись', '22 записи', '111 записей', '114 записей']); ok('склонение «запись»');
  const cv = await L.createVault('cat-test', { entries: [], cats: ['Семья', 'Дача'] }); assert.deepStrictEqual((await L.unlockVault('cat-test', cv.blob)).data.cats, ['Семья', 'Дача']); ok('список категорий хранится внутри зашифрованных данных');

  console.log('\nВсе проверки пройдены: ' + n);
})().catch(e => { console.error('\n✗ ПРОВАЛ:', e.message); process.exit(1); });
