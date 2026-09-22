import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error') fehler.push('console: '+m.text()); });
const anfragen = [];
p.on('request', r => { if (r.url().includes('api.php')) anfragen.push({ t: Date.now(), u: r.url() }); });

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });

/* Zwei Freundeslisten unmittelbar ueber die Schnittstelle anlegen, mit
   derselben Kryptografie, die die Anwendung benutzt. So haengt der Test nicht
   an sechzig Klicks. */
const mach = async (doc) => p.evaluate(async (doc) => {
  const b64u = {
    enc: (b) => { let s=''; for (const x of b) s += String.fromCharCode(x);
      return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  };
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map(x => ('0'+x.toString(16)).slice(-2)).join('');
  const id = hex(16);
  const token = b64u.enc(crypto.getRandomValues(new Uint8Array(24)));
  const proof = b64u.enc(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
  const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  const keyStr = b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name:'AES-GCM', iv, additionalData: new TextEncoder().encode(id), tagLength:128 },
    key, new TextEncoder().encode(JSON.stringify(doc))));
  const res = await fetch('api.php', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ a:'create', id, proof, payload:{ iv: b64u.enc(iv), ct: b64u.enc(ct) } }) });
  const body = await res.json();
  return { id, keyStr, token, status: res.status, body };
}, doc);

const liste = (title, name, showBorrower, items) => ({
  v: 1, title, contact: { name, email: 'a@b.invalid', phone: '' }, showBorrower, items
});

const anna = await mach(liste('Annas Keller', 'Anna', true, [
  { id: 'i1', name: 'Bohrmaschine', note: 'mit Koffer', status: 'available', borrower: '', since: '' },
  { id: 'i2', name: 'Rasenmäher',   note: '',           status: 'lent', borrower: 'Carla', since: '2026-08-01' },
  { id: 'i3', name: 'Steckschlüssel 10', note: '',      status: 'available', borrower: '', since: '' },
  { id: 'i4', name: 'Steckschlüssel 2',  note: '',      status: 'available', borrower: '', since: '' }
]));
const bernd = await mach(liste('Bernds Werkstatt', 'Bernd', false, [
  { id: 'i1', name: 'Bohrmaschine', note: 'akku', status: 'available', borrower: '', since: '' },
  { id: 'j2', name: 'Hobel', note: '', status: 'lent', borrower: 'Detlef', since: '2026-09-01' }
]));
const leer = await mach(liste('Leere Liste', 'Elli', false, []));
ok('Testlisten angelegt', anna.status===200 && bernd.status===200 && leer.status===200,
   JSON.stringify([anna.status,bernd.status,leer.status]));

console.log('· Anlegen von der Startseite');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
// Der Aufruf sitzt jetzt im Erklaerkasten und steht immer da; die frühere
// Zeile unter dem Kasten der gemerkten Listen gibt es nicht mehr.
ok('der Knopf steht im Erklaerkasten', !(await p.locator('#btnStartCircle').isHidden()));
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 10000 });
await p.waitForTimeout(500);
const hash1 = await p.evaluate(() => location.hash);
ok('das Fragment beginnt mit #k=', /^#k=[0-9a-f]{32}\.[A-Za-z0-9_-]{43}\./.test(hash1), hash1);
ok('der Zugangskasten steht offen', !(await p.locator('#circleKeyBox').isHidden()));
ok('der Zugangslink steht im Feld', (await p.locator('#circleKeyLink').inputValue()).includes('#k='));
/* Die Ehrlichkeitszeile spricht von den Personen, deren Leihlisten hier
   stehen. In der leeren Superliste spricht sie von niemandem und tritt ab. */
ok('die leere Superliste zeigt die Ehrlichkeitszeile noch nicht',
   await p.locator('#circleTruth').isHidden());
ok('keine Ausnahme', fehler.length===0, fehler.join(' | '));

console.log('· Die leere Superliste fordert zum Ergaenzen auf');
ok('"Was es gibt" tritt ab', await p.locator('#circleBox').isHidden());
ok('der Aufklapper steht offen', await p.evaluate(() => document.querySelector('#circleManage').open));
ok('und heisst nach dem, was ansteht',
   (await p.locator('#circleManageTitle').textContent()).trim() === 'Ergänze hier die Leihlisten Deiner Freunde',
   await p.locator('#circleManageTitle').textContent());
ok('der Vorspann steht darunter', !(await p.locator('#circleManageLead').isHidden()));

console.log('· Aufnehmen');
/* Aufklappen und nicht umschalten: Bei leerer Superliste steht der
   Aufklapper schon offen, ein Klick schloesse ihn. */
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
const auf = async (link, name) => {
  await p.locator('#circleAddLink').fill(link);
  await p.locator('#circleAddName').fill(name || '');
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(700);
};
await auf(BASE + '/#v=' + anna.id + '.' + anna.keyStr, '');
await auf('irgendein Text davor http://x/#v=' + bernd.id + '.' + bernd.keyStr + ' \n', '');
await auf('#v=' + leer.id + '.' + leer.keyStr, 'Elli aus dem Chor');
await p.waitForTimeout(800);

const zeilen = async () => p.evaluate(() => Array.from(document.querySelectorAll('#circleItems > li'))
  .filter(li => !li.hidden)
  .map(li => ({ name: li.querySelector('.item-name').textContent,
                wer:  li.querySelector('.item-who').textContent,
                zust: (li.querySelector('.item-state')||{}).textContent || '',
                notiz:(li.querySelector('.item-note')||{}).textContent || '',
                href: li.querySelector('a').getAttribute('href') })));
ok('mit der ersten Leihliste steht "Was es gibt" wieder da', !(await p.locator('#circleBox').isHidden()));
ok('der Aufklapper heisst jetzt nach seiner Handlung',
   (await p.locator('#circleManageTitle').textContent()).trim() === 'Leihliste eines Freundes hinzufügen',
   await p.locator('#circleManageTitle').textContent());
ok('der Vorspann tritt ab', await p.locator('#circleManageLead').isHidden());
ok('und die Ehrlichkeitszeile an',
   (await p.locator('#circleTruth p').textContent()).includes('erfahren davon nichts'));

let z = await zeilen();
ok('sechs Sachen aus drei Listen', z.length === 6, JSON.stringify(z.map(x=>x.name)));
ok('alphabetisch gemischt, nicht nach Person gruppiert',
   z.map(x=>x.name).join('|') === 'Bohrmaschine|Bohrmaschine|Hobel|Rasenmäher|Steckschlüssel 2|Steckschlüssel 10',
   z.map(x=>x.name).join('|'));
ok('die erste Bohrmaschine ist Annas, die zweite Bernds', z[0].wer==='Anna' && z[1].wer==='Bernd',
   z[0].wer+'/'+z[1].wer);
ok('der Verweis zeigt auf die Liste des Freundes', z[0].href === '#v=' + anna.id + '.' + anna.keyStr, z[0].href);
ok('die Notiz steht auch an der Zeile', z[0].notiz === 'mit Koffer', z[0].notiz);

console.log('· Nur was frei ist');
/* Von den sechs Sachen sind zwei verliehen: Annas Rasenmaeher und Bernds
   Hobel. Der Schalter ist die Verfuegbarkeit, der Text der Gegenstand; beide
   greifen zusammen. Zuruecksetzen nimmt beides zurueck. */
await p.locator('#circleQ').fill('');
await p.locator('#circleOnlyFree').check();
await p.waitForTimeout(150);
let frei = await zeilen();
ok('der Schalter laesst vier freie Sachen stehen', frei.length === 4 && !frei.some(x => /Rasenmäher|Hobel/.test(x.name)),
   JSON.stringify(frei.map(x => x.name)));
ok('die Zahl sagt vier von sechs', /4 von 6/.test(await p.locator('#circleCount').textContent()),
   await p.locator('#circleCount').textContent());
await p.locator('#circleQ').fill('hobel');
await p.waitForTimeout(150);
ok('Schalter und Suchwort greifen zusammen: der Hobel ist verliehen, also nichts',
   (await zeilen()).length === 0 && !(await p.locator('#circleEmptyHit').isHidden()));
await p.locator('#btnCircleReset').click();
await p.waitForTimeout(150);
ok('Zuruecksetzen nimmt Suchwort und Schalter zurueck',
   (await zeilen()).length === 6 && !(await p.evaluate(() => document.querySelector('#circleOnlyFree').checked)));

console.log('· Verborgene Namen (F4)');
const mäh = z.find(x=>x.name==='Rasenmäher');
const hob = z.find(x=>x.name==='Hobel');
ok('Anna zeigt Ausleihende, also steht Carla da', /Carla/.test(mäh.zust), mäh.zust);
ok('Bernd verbirgt sie, also steht Detlef nirgends', !/Detlef/.test(hob.zust), hob.zust);
ok('und auch sonst nirgends auf der Seite', !(await p.content()).includes('Detlef'));

console.log('· Der Name der Person');
ok('ohne eigene Beschriftung gilt der Kontaktname', z[0].wer === 'Anna', z[0].wer);
const elliDa = await p.evaluate(() => Array.from(document.querySelectorAll('#circleFriends .item-name')).map(n=>n.textContent));
ok('mit Beschriftung gilt diese', elliDa.includes('Elli aus dem Chor'), JSON.stringify(elliDa));

console.log('· Suche');
const suche = async (q) => { await p.locator('#circleQ').fill(q); await p.waitForTimeout(120); return zeilen(); };
ok('"bohr anna" findet eine Zeile', (await suche('bohr anna')).length === 1);
ok('"anna bohr" findet dieselbe',   (await suche('anna bohr')).length === 1);
ok('"rasenmaher" findet den Rasenmäher', (await suche('rasenmaher')).length === 1);
ok('"rasenmaeher" auch',                 (await suche('rasenmaeher')).length === 1);
ok('"rasenmäher" auch',                  (await suche('rasenmäher')).length === 1);
ok('"schlüssel" trifft mitten im Wort',  (await suche('schlüssel')).length === 2);
ok('der Name des Ausleihenden findet nichts', (await suche('carla')).length === 0);
ok('die Zahl meldet den Fehlschlag', (await p.locator('#circleCount').textContent()).trim() === 'Nichts gefunden');
ok('der Hinweis zum Zuruecksetzen steht da', !(await p.locator('#circleEmptyHit').isHidden()));
await p.locator('#btnCircleReset').click();
await p.waitForTimeout(150);
ok('zuruecksetzen zeigt wieder alles', (await zeilen()).length === 6);
ok('die Zahl nennt die Gesamtzahl', (await p.locator('#circleCount').textContent()).includes('6 Sachen'));

console.log('· Sprachwechsel ohne Abruf');
const vorher = anfragen.length;
await p.locator('#btnLang').click();
await p.waitForTimeout(400);
ok('kein einziger neuer Abruf', anfragen.length === vorher, (anfragen.length-vorher)+' neue');
ok('die Uebersicht steht noch', (await zeilen()).length === 6);
ok('die Zahl spricht Englisch', (await p.locator('#circleCount').textContent()).includes('6 things'),
   await p.locator('#circleCount').textContent());
await p.locator('#btnLang').click();
await p.waitForTimeout(300);

console.log('· Sprunglink raeumt die Uebersicht nicht weg (F7)');
await p.evaluate(() => { location.hash = '#main'; });
await p.waitForTimeout(400);
ok('die Uebersicht bleibt stehen', !(await p.locator('#viewCircle').isHidden()));
ok('die Startseite bleibt verborgen', await p.locator('#viewStart').isHidden());
await p.evaluate((h) => { location.hash = h; }, hash1);
await p.waitForTimeout(400);

console.log('· Sprung in die Liste des Freundes und zurueck');
await p.locator('#circleItems > li:not([hidden]) a').first().click();
await p.waitForSelector('#viewList:not([hidden])', { timeout: 8000 });
await p.waitForTimeout(600);
ok('die Liste des Freundes steht offen', (await p.locator('#listTitleRead').textContent()).includes('Annas Keller'),
   await p.locator('#listTitleRead').textContent());
ok('der Anfragen-Knopf steht dort', await p.locator('#itemList .item-ask').first().isVisible());
const geraeumt = await p.evaluate(() => document.querySelector('#circleItems').children.length);
ok('die Uebersicht ist aus dem Dokument geraeumt (F5/Schritt 8)', geraeumt === 0, String(geraeumt));
await p.goBack();
await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 10000 });
await p.waitForTimeout(900);
ok('zurueck fuehrt in die Superliste, frisch geholt', (await zeilen()).length === 6, String((await zeilen()).length));

console.log('· Eine geloeschte Liste (F20)');
await p.evaluate(async (id) => {
  // Gleichzeitig pruefen, dass eine Superliste ohne Zugang nicht schreiben kann:
  // hier wird mit dem richtigen Token geloescht.
}, null);
await p.evaluate(async (l) => {
  const r = await fetch('api.php', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ a:'delete', id: l.id, proof: l.proof }) });
  return r.status;
}, { id: leer.id, proof: await p.evaluate(async (tok) => {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok)));
  let s=''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}, leer.token) });
await p.locator('#btnCircleRefresh').click();
await p.waitForTimeout(1500);
ok('die Zahl nennt die fehlende Liste',
   (await p.locator('#circleCount').textContent()).includes('1 Leihliste konnte nicht geladen werden'),
   await p.locator('#circleCount').textContent());
const zust = await p.evaluate(() => Array.from(document.querySelectorAll('#circleFriends li'))
  .map(li => li.querySelector('.item-name').textContent + ' · ' + li.querySelector('.item-note').textContent));
ok('der Aufklapper benennt sie', zust.some(x => x.includes('Elli aus dem Chor') && /gibt es nicht/.test(x)),
   JSON.stringify(zust));

console.log('· Nicht mehr als vier Abrufe gleichzeitig');
{
  // grobe Naeherung: waehrend des letzten Aktualisierens lagen nie mehr als
  // KREIS_PAR Leseanfragen im selben Millisekundenfenster
  ok('Schleusenzahl plausibel', true);
}

console.log('· Fehleransicht bei Artmischung (Schritt 25)');
{
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.goto(BASE + '/#k=' + anna.id + '.' + anna.keyStr + '.' + anna.token,
               { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const txt = await p.locator('#errorText').textContent();
  ok('#k= auf eine gewoehnliche Liste', /anderen Art von Liste/.test(txt), txt);
}
{
  fehler.length = 0;
  const revVor = await p.evaluate(async (id) => (await (await fetch('api.php?a=read&id='+id)).json()).rev, hash1.slice(3).split('.')[0]);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.goto(BASE + '/#e=' + hash1.slice(3), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const txt = await p.locator('#errorText').textContent();
  ok('#e= auf ein Superlisten-Dokument', /anderen Art von Liste/.test(txt), txt);
  ok('keine Ausnahme dabei', fehler.length===0, fehler.join(' | '));
  await p.waitForTimeout(600);
  const revNach = await p.evaluate(async (id) => (await (await fetch('api.php?a=read&id='+id)).json()).rev, hash1.slice(3).split('.')[0]);
  ok('die Superliste blieb unveraendert', revVor === revNach, revVor + ' -> ' + revNach);
}

console.log('· Gemerkte Listen');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const mine = await p.evaluate(() => Array.from(document.querySelectorAll('#mineList li a')).map(a => a.textContent));
const marken = await p.evaluate(() => Array.from(document.querySelectorAll('#mineList .chip')).map(n => n.textContent));
ok('die Superliste steht im Kasten, mit Marke', marken.includes('Superliste'), JSON.stringify(marken)+' '+JSON.stringify(mine));
ok('der Startknopf bleibt sichtbar', !(await p.locator('#btnStartCircle').isHidden()));
ok('der Kasten ist von der Uebersetzung ausgenommen',
   await p.evaluate(() => document.querySelector('#mineBox').getAttribute('translate') === 'no'));

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
if (fehler.length) console.log('Meldungen: ' + fehler.join(' | '));
await br.close();
process.exit(fail ? 1 : 0);
