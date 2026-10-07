import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };
const browser = await chromium.launch({ executablePath: B });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
await page.reload({ waitUntil: 'networkidle' });

console.log('\n· Der Zugang wird angekreuzt');
await page.locator('#btnCreate').click();
await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
const box = page.locator('#chkKeyDone');
ok('es ist ein Ankreuzfeld', await box.getAttribute('type') === 'checkbox');
// Seit Oktober 2026 liegt der Link verdeckt im Kasten, daneben steht
// "Zeigen". Ein Knopf zum Wegräumen ist weiterhin keiner da.
ok('keine Schaltfläche zum Wegräumen im Kasten',
   await page.locator('#keyBox button:not([data-copy]):not(#btnRevealEdit)').count() === 0);
ok('anfangs nicht angekreuzt', !(await box.isChecked()));
await box.check();
await page.waitForTimeout(250);
// Seit Oktober 2026 steht das ruhige Feld nur im dritten Schritt; im
// Inventar geht es mit der Bitte.
ok('die Bitte verschwindet, und im Inventar mit ihr das Feld',
   await page.locator('#keyBox').evaluate(n => n.hidden && !n.classList.contains('keybox--frisch')));
ok('der Fokus faellt nicht ins Leere, er steht auf dem Reiter des Schritts',
   await page.evaluate(() => document.activeElement.id) === 'schrittTab1');
ok('und der Zugang wird gefeiert', await page.evaluate(() => !!document.getElementById('konfetti')));
ok('der Zähler steht auf 1', await page.evaluate(() => JSON.parse(localStorage.getItem('lid.spiel')).listen) === 1);
await page.waitForTimeout(2000);

/* Bis Oktober 2026 stand oben rechts im Inventar, wann die Liste zuletzt
   gespeichert wurde. Seitdem steht dort nichts mehr: Ob gespeichert ist,
   sagt die Marke neben dem Titel, und wann, ist an der Stelle unnoetig. */
console.log('\n· Kein Zeitstempel');
await page.locator('#addName').fill('Bohrmaschine');
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(1600);
ok('auch nach dem Speichern steht keiner im Kopf des Inventars', await page.locator('#listUpdated').count() === 0 &&
   await page.evaluate(() => [...document.querySelectorAll('#inventoryBox .items-head > :not(.schritt__titel)')]
     .every(n => n.hidden || !n.textContent.trim())));
const meta = await page.locator('#listMeta').innerText();
ok('die alte Zeile über der Liste ist leer', meta.trim() === '', meta);

console.log('\n· Aus der Durchsicht');
{
  // Eingabetaste auf dem Ankreuzfeld: eine zweite Liste anlegen und tippen
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.evaluate(() => localStorage.clear());
  await p2.reload({ waitUntil: 'networkidle' });
  await p2.locator('#btnCreate').click();
  await p2.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await p2.locator('#chkKeyDone').focus();
  await p2.keyboard.press('Enter');
  await p2.waitForTimeout(250);
  ok('die Eingabetaste kreuzt an und nimmt die Bitte zurück',
     !(await p2.locator('#keyBox').evaluate(n => n.classList.contains('keybox--frisch'))));
  ok('und zählt den Zugang',
     await p2.evaluate(() => JSON.parse(localStorage.getItem('lid.spiel')).listen) === 1);
  await p2.close();
}

console.log('\n· Beim Freund bleibt die Zeile');
const link = await page.locator('#linkView').inputValue();
const gast = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
gast.on('pageerror', e => problems.push('gast: ' + e.message));
await gast.goto(link, { waitUntil: 'networkidle' });
await gast.waitForSelector('.item', { timeout: 10000 });
const gastMeta = await gast.locator('#listMeta').innerText();
ok('der Freund sieht, wie viel frei ist', /frei/.test(gastMeta), gastMeta);
ok('und keinen Zeitstempel im Inventarkopf', await gast.locator('#listUpdated').count() === 0);
await gast.close();

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
