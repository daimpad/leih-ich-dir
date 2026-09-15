import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport: { width: 800, height: 1200 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });

const mach = async (doc) => p.evaluate(async (doc) => {
  const enc = (b) => { let s=''; for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');
  const id = hex(16);
  const token = enc(crypto.getRandomValues(new Uint8Array(24)));
  const proof = enc(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
  const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  const keyStr = enc(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:new TextEncoder().encode(id), tagLength:128 }, key, new TextEncoder().encode(JSON.stringify(doc))));
  const res = await fetch('api.php', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ a:'create', id, proof, payload:{ iv: enc(iv), ct: enc(ct) } }) });
  return { id, keyStr, token, status: res.status };
}, doc);
const liste = (title, name, items) => ({ v:1, title, contact:{ name, email:'', phone:'' }, showBorrower:false, items });

console.log('· Erster Einstieg: aus der Liste eines Freundes, noch ohne Superliste');
const anna = await mach(liste('Annas Keller', 'Anna', [
  { id:'i1', name:'Bohrmaschine', note:'', status:'available', borrower:'', since:'' }]));
await p.goto(BASE + '/#v=' + anna.id + '.' + anna.keyStr, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
ok('der Knopf steht unter dem Inventar', !(await p.locator('#circleAddHereRow').isHidden()));
await p.locator('#btnCircleAddHere').click();
await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 10000 });
await p.waitForTimeout(1500);
const kreisHash = await p.evaluate(() => location.hash);
ok('eine Superliste entsteht und die Ansicht wechselt hinein', /^#k=/.test(kreisHash), kreisHash);
ok('der Zugangskasten ist sichtbar', !(await p.locator('#circleKeyBox').isHidden()));
let namen = await p.evaluate(() => Array.from(document.querySelectorAll('#circleItems .item-name')).map(n=>n.textContent));
ok('Annas Bohrmaschine steht schon drin', namen.join() === 'Bohrmaschine', JSON.stringify(namen));

console.log('· Zweiter Einstieg: es gibt schon eine Superliste');
const bernd = await mach(liste('Bernds Werkstatt', 'Bernd', [
  { id:'j1', name:'Hobel', note:'', status:'available', borrower:'', since:'' }]));
await p.goto(BASE + '/#v=' + bernd.id + '.' + bernd.keyStr, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.locator('#btnCircleAddHere').click();
await p.waitForTimeout(1600);
ok('die Ansicht bleibt in der Liste des Freundes', !(await p.locator('#viewList').isHidden()));
ok('die Uebersicht bleibt verborgen', await p.locator('#viewCircle').isHidden());
ok('eine Meldung bestaetigt es', /Aufgenommen in/.test(await p.locator('#toastText').textContent()),
   await p.locator('#toastText').textContent());
ok('das Fragment bleibt beim Freund', (await p.evaluate(() => location.hash)).startsWith('#v='));

console.log('· Und die Superliste hat beide');
await p.goto(BASE + '/' + kreisHash, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
namen = await p.evaluate(() => Array.from(document.querySelectorAll('#circleItems .item-name')).map(n=>n.textContent));
ok('zwei Sachen aus zwei Listen', namen.length === 2, JSON.stringify(namen));
ok('kein doppeltes Aufnehmen', (await p.evaluate(() => document.querySelectorAll('#circleFriends li').length)) === 2);

console.log('· Dasselbe zweimal aufnehmen meldet sich');
await p.goto(BASE + '/#v=' + bernd.id + '.' + bernd.keyStr, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.locator('#btnCircleAddHere').click();
await p.waitForTimeout(1400);
ok('die Meldung sagt es', /steht schon/.test(await p.locator('#toastText').textContent()),
   await p.locator('#toastText').textContent());

console.log('· In der eigenen Liste steht der Knopf nicht');
{
  const q = await ctx.newPage();
  await q.goto(BASE + '/', { waitUntil: 'networkidle' });
  await q.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });
  await q.reload({ waitUntil: 'networkidle' });
  await q.locator('#btnCreateHero').click();
  await q.waitForSelector('#viewList:not([hidden])', { timeout: 10000 });
  await q.waitForTimeout(600);
  ok('im Bearbeiten-Modus verborgen', await q.locator('#circleAddHereRow').isHidden());
  await q.close();
}

console.log('· Vorschaumodus');
{
  const q = await ctx.newPage();
  const fq = [];
  q.on('pageerror', e => fq.push('pageerror: ' + e.message));
  /* Die Schnittstelle unerreichbar machen: dann greift LocalStore. */
  await q.route('**/api.php*', r => r.abort());
  await q.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await q.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });
  await q.reload({ waitUntil: 'domcontentloaded' });
  await q.waitForTimeout(1200);
  ok('der Vorschau-Streifen steht da', !(await q.locator('#previewBanner').isHidden().catch(() => true))
     || (await q.content()).includes('Vorschaumodus'));
  await q.locator('#btnStartCircle').click();
  await q.waitForSelector('#viewCircle:not([hidden])', { timeout: 10000 });
  await q.waitForTimeout(500);
  ok('eine Superliste laesst sich auch hier anlegen', /^#k=/.test(await q.evaluate(() => location.hash)));
  ok('der Hinweis zum Vorschaumodus steht da', !(await q.locator('#circlePreview').isHidden()));
  await q.evaluate(() => { document.querySelector('#circleManage').open = true; });
  await q.locator('#circleAddLink').fill('#v=' + anna.id + '.' + anna.keyStr);
  await q.locator('#btnCircleAdd').click();
  await q.waitForTimeout(900);
  const zeile = await q.evaluate(() => Array.from(document.querySelectorAll('#circleFriends li'))
    .map(li => li.querySelector('.item-note').textContent));
  ok('die fremde Liste meldet sich als hier nicht abrufbar',
     zeile.some(x => /nicht abrufbar/.test(x)), JSON.stringify(zeile));
  ok('kein "Erneut versuchen"', (await q.locator('#circleFriends [data-kreis-act="retry"]').count()) === 0);
  ok('"Aus der Superliste nehmen" bleibt, sonst waere das Aufnehmen unumkehrbar',
     (await q.locator('#circleFriends [data-kreis-act="remove"]').count()) === 1);
  ok('keine Ausnahme im Vorschaumodus', fq.length === 0, fq.join(' | '));
  await q.close();
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
if (fehler.length) console.log('Meldungen: ' + fehler.join(' | '));
await br.close();
process.exit(fail ? 1 : 0);
