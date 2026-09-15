import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport: { width: 1000, height: 900 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });

console.log('· Die Lizenz in den strukturierten Angaben');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
{
  const ld = await p.evaluate(() => JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent));
  ok('nennt MIT', /opensource\.org\/license\/mit/.test(ld.license), ld.license);
}

console.log('· Entschluesselter Inhalt wird nicht uebersetzt');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });
await p.reload({ waitUntil: 'networkidle' });
await p.locator('#btnCreateHero').click();
await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(700);
await p.locator('#addName').fill('Bohrmaschine');
await p.locator('#addForm button[type=submit]').click();
await p.waitForTimeout(800);
{
  const m = await p.evaluate(() => {
    const geerbt = el => { let n = el; while (n) { if (n.getAttribute && n.getAttribute('translate') === 'no') return true; n = n.parentElement; } return false; };
    return {
      liste: geerbt(document.querySelector('#itemList .item-name')),
      titel: geerbt(document.querySelector('#listTitleRead')),
      fenster: geerbt(document.querySelector('#itemModal')),
      meldung: geerbt(document.querySelector('#toast')),
      start: geerbt(document.querySelector('#viewStart h1')),
    };
  });
  ok('die Gegenstandsliste ist ausgenommen', m.liste);
  ok('der Titel der Liste ebenso', m.titel);
  ok('das Fenster zum Gegenstand ebenso', m.fenster);
  ok('die Meldungen ebenso', m.meldung);
  ok('die Startseite bleibt uebersetzbar', !m.start, 'sonst verlierten Fremdsprachige die Erklaerung');
}

console.log('· Die Rechtstexte benennen die Kehrseite');
for (const [datei, muster] of [['datenschutz.html', /Der Link selbst .{0,20}enthält.{0,20} den Schlüssel/],
                               ['ueber.html', /Der Link .{0,10}ist.{0,10} der Schlüssel/]]) {
  await p.goto(BASE + '/' + datei, { waitUntil: 'networkidle' });
  const txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
  ok(datei + ': der Link traegt den Schluessel', muster.test(txt));
}
await p.goto(BASE + '/datenschutz.html', { waitUntil: 'networkidle' });
{
  const txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
  ok('datenschutz: die Uebersetzungsfunktion ist benannt', /Übersetzungsfunktion des Browsers/.test(txt));
  ok('datenschutz: die Vorschaukarte ist benannt', /Vorschaukarte/.test(txt));
}
console.log('· Konsole');
ok('keine Fehler', fehler.length === 0, fehler.slice(0,2).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
