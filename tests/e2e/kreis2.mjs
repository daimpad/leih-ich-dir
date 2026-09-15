import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error') fehler.push('console: '+m.text()); });

/* Gleichzeitigkeit messen: laufende Leseanfragen zaehlen. */
let offen = 0, hoechst = 0;
p.on('request', r => { if (/api\.php\?a=read/.test(r.url())) { offen++; hoechst = Math.max(hoechst, offen); } });
p.on('requestfinished', r => { if (/api\.php\?a=read/.test(r.url())) offen--; });
p.on('requestfailed',   r => { if (/api\.php\?a=read/.test(r.url())) offen--; });

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

console.log('· Zehn Freunde, Schleusenzahl vier');
const zehn = [];
for (let i = 0; i < 10; i++) {
  zehn.push(await mach(liste('Liste ' + i, 'Person ' + i, [
    { id:'a', name:'Sache A'+i, note:'', status:'available', borrower:'', since:'' }
  ])));
}
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(400);
const kreisHash = await p.evaluate(() => location.hash);
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
for (const l of zehn) {
  await p.locator('#circleAddLink').fill('#v=' + l.id + '.' + l.keyStr);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(250);
}
await p.waitForTimeout(600);
offen = 0; hoechst = 0;
await p.locator('#btnCircleRefresh').click();
await p.waitForTimeout(2500);
ok('nie mehr als vier Leseanfragen gleichzeitig', hoechst <= 4, 'hoechstens ' + hoechst);
const n = await p.evaluate(() => document.querySelectorAll('#circleItems > li').length);
ok('alle zehn Sachen stehen da', n === 10, String(n));

console.log('· Entfernen mit Ruecknahme');
{
  const erste = await p.evaluate(() => document.querySelector('#circleFriends [data-kreis-act="remove"]').getAttribute('data-kreis-id'));
  await p.locator('#circleFriends [data-kreis-act="remove"]').first().click();
  await p.waitForTimeout(300);
  ok('eine Sache weniger', (await p.evaluate(() => document.querySelectorAll('#circleItems > li').length)) === 9);
  ok('die Meldung traegt eine Gegenhandlung', await p.locator('#toastAct').isVisible());
  await p.locator('#toastAct').click();
  await p.waitForTimeout(400);
  ok('zurueckgenommen', (await p.evaluate(() => document.querySelectorAll('#circleItems > li').length)) === 10);
  const rev = await p.evaluate(async (id) => (await (await fetch('api.php?a=read&id='+id)).json()).rev, kreisHash.slice(3).split('.')[0]);
  await p.waitForTimeout(500);
  ok('und nichts geschrieben', typeof rev === 'number', String(rev));
}

console.log('· Obergrenze');
{
  const extra = await mach(liste('Einer zu viel', 'Zuviel', []));
  const vorher = await p.evaluate(() => document.querySelectorAll('#circleFriends li').length);
  await p.locator('#circleAddLink').fill('#v=' + extra.id + '.' + extra.keyStr);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(400);
  ok('unter 24 wird noch aufgenommen',
     (await p.evaluate(() => document.querySelectorAll('#circleFriends li').length)) === vorher + 1);
}

console.log('· Was nicht aufgenommen wird');
{
  await p.locator('#circleAddLink').fill(kreisHash);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(300);
  ok('der Link einer Superliste nicht', (await p.locator('#toastText').textContent()).includes('nicht in eine andere'),
     await p.locator('#toastText').textContent());
  await p.locator('#circleAddLink').fill('#v=' + kreisHash.slice(3).split('.')[0] + '.' + kreisHash.slice(3).split('.')[1]);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(300);
  ok('die Superliste selbst nicht', (await p.locator('#toastText').textContent()).includes('diese Superliste selbst'),
     await p.locator('#toastText').textContent());
  await p.locator('#circleAddLink').fill('#v=' + zehn[0].id + '.' + zehn[0].keyStr);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(300);
  ok('dasselbe zweimal nicht', (await p.locator('#toastText').textContent()).includes('steht schon'),
     await p.locator('#toastText').textContent());
  await p.locator('#circleAddLink').fill('kein Link');
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(300);
  ok('Unsinn nicht', (await p.locator('#toastText').textContent()).includes('unvollständig'),
     await p.locator('#toastText').textContent());
}

console.log('· Ein Bearbeiten-Link wird abgewertet');
{
  const fremd = await mach(liste('Fremd', 'Fremd', [{ id:'x', name:'Leiter', note:'', status:'available', borrower:'', since:'' }]));
  await p.locator('#circleAddLink').fill('#e=' + fremd.id + '.' + fremd.keyStr + '.' + fremd.token);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(900);
  const drin = await p.evaluate(async (arg) => {
    // Das Superlisten-Dokument vom Server holen und mit dem Schluessel aus dem
    // Fragment entschluesseln: Steht dort ein token, ist die Zusage gebrochen.
    const dec = (s) => { s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length%4) s += '=';
      const b = atob(s); const o = new Uint8Array(b.length); for (let i=0;i<b.length;i++) o[i]=b.charCodeAt(i); return o; };
    const [id, keyStr] = arg.split('.');
    const r = await (await fetch('api.php?a=read&id='+id)).json();
    const key = await crypto.subtle.importKey('raw', dec(keyStr), { name:'AES-GCM' }, true, ['decrypt']);
    const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv: dec(r.payload.iv), additionalData:new TextEncoder().encode(id), tagLength:128 }, key, dec(r.payload.ct));
    return JSON.parse(new TextDecoder().decode(buf));
  }, kreisHash.slice(3));
  const eintrag = drin.friends.filter(f => f.id === fremd.id)[0];
  ok('der Freund ist drin', !!eintrag, JSON.stringify(drin.friends.length));
  ok('aber ohne Token', eintrag && Object.keys(eintrag).sort().join(',') === 'id,key,label',
     JSON.stringify(eintrag && Object.keys(eintrag)));
  ok('das Dokument traegt kind: circle', drin.kind === 'circle', String(drin.kind));
  ok('und keine Gegenstaende', !drin.items, JSON.stringify(Object.keys(drin)));
}

console.log('· Einstellungsseite aus der Superliste');
{
  const href = await p.locator('#lnkSettings').getAttribute('href');
  ok('das Zahnrad traegt das Superlisten-Fragment', href.startsWith('einstellungen.html#k='), href);
  await p.goto(BASE + '/' + href, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  ok('der Loeschkasten steht da', !(await p.locator('#dangerBox').isHidden()));
  const back = await p.locator('#lnkBack').getAttribute('href');
  ok('"Zurueck" fuehrt in die Superliste', back === './' + kreisHash, back);
  p.once('dialog', d => { ok('der Text spricht von der Superliste', /Superliste/.test(d.message()), d.message()); d.dismiss(); });
  await p.locator('#btnDeleteList').click();
  await p.waitForTimeout(400);
}

console.log('· Nebenlaeufig aufnehmen (zwei Reiter)');
{
  const q = await ctx.newPage();
  const a = await mach(liste('Neu A', 'A', []));
  const b = await mach(liste('Neu B', 'B', []));
  await p.goto(BASE + '/' + kreisHash, { waitUntil: 'networkidle' });
  await q.goto(BASE + '/' + kreisHash, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800); await q.waitForTimeout(1800);
  for (const [seite, l] of [[p, a], [q, b]]) {
    await seite.evaluate(() => { document.querySelector('#circleManage').open = true; });
    await seite.locator('#circleAddLink').fill('#v=' + l.id + '.' + l.keyStr);
  }
  await Promise.all([p.locator('#btnCircleAdd').click(), q.locator('#btnCircleAdd').click()]);
  await p.waitForTimeout(2500);
  const drin = await p.evaluate(async (arg) => {
    const dec = (s) => { s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length%4) s += '=';
      const bb = atob(s); const o = new Uint8Array(bb.length); for (let i=0;i<bb.length;i++) o[i]=bb.charCodeAt(i); return o; };
    const [id, keyStr] = arg.split('.');
    const r = await (await fetch('api.php?a=read&id='+id)).json();
    const key = await crypto.subtle.importKey('raw', dec(keyStr), { name:'AES-GCM' }, true, ['decrypt']);
    const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv: dec(r.payload.iv), additionalData:new TextEncoder().encode(id), tagLength:128 }, key, dec(r.payload.ct));
    return JSON.parse(new TextDecoder().decode(buf));
  }, kreisHash.slice(3));
  const ids = drin.friends.map(f => f.id);
  ok('beide Zugaenge ueberleben den Konflikt', ids.includes(a.id) && ids.includes(b.id),
     JSON.stringify({ a: ids.includes(a.id), b: ids.includes(b.id), n: ids.length }));
  await q.close();
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
if (fehler.length) console.log('Meldungen: ' + fehler.join(' | '));
await br.close();
process.exit(fail ? 1 : 0);
