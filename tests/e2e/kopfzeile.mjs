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
await page.locator('#btnCreateHero').click();
await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
const box = page.locator('#chkKeyDone');
ok('es ist ein Ankreuzfeld', await box.getAttribute('type') === 'checkbox');
ok('keine Schaltfläche mehr im Kasten', await page.locator('#keyBox button:not([data-copy])').count() === 0);
ok('anfangs nicht angekreuzt', !(await box.isChecked()));
await box.check();
await page.waitForTimeout(250);
ok('der Kasten verschwindet', await page.locator('#keyBox').isHidden());
ok('und der Zugang wird gefeiert', await page.evaluate(() => !!document.getElementById('konfetti')));
ok('der Zähler steht auf 1', await page.evaluate(() => JSON.parse(localStorage.getItem('lid.spiel')).listen) === 1);
await page.waitForTimeout(2000);

console.log('\n· Der Zeitstempel');
await page.locator('#addName').fill('Bohrmaschine');
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(1600);
const stamp = page.locator('#listUpdated');
ok('steht im Kopf des Inventars', await page.evaluate(() =>
  document.querySelector('.items-head').contains(document.getElementById('listUpdated'))));
ok('ist sichtbar', await stamp.isVisible());
const txt = await stamp.innerText();
ok('enthält Datum und Uhrzeit', /\d{1,2}\.\d{2}\.\d{4}.*\d{1,2}:\d{2}/.test(txt), txt);
ok('ohne Anzahl', !/Gegenstand|Gegenstände/.test(txt), txt);
ok('ohne Beschriftung', !/Zuletzt|aktualisiert/i.test(txt), txt);
const gr = await stamp.evaluate(n => parseFloat(getComputedStyle(n).fontSize));
const h2 = await page.locator('#viewList .items-head .card__title').evaluate(n => parseFloat(getComputedStyle(n).fontSize));
ok('kleiner als die Überschrift', gr < h2, gr + 'px gegen ' + h2 + 'px');
const rechts = await page.evaluate(() => {
  const a = document.querySelector('#viewList .items-head .card__title').getBoundingClientRect();
  const b = document.getElementById('listUpdated').getBoundingClientRect();
  return b.left >= a.right && Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 12;
});
ok('rechts neben der Überschrift, auf gleicher Höhe', rechts);
const meta = await page.locator('#listMeta').innerText();
ok('die alte Zeile über der Liste ist leer', meta.trim() === '', meta);

console.log('\n· Aus der Durchsicht');
{
  const label = await stamp.getAttribute('aria-label');
  ok('der Zeitstempel trägt eine Beschriftung für die Vorlesestimme',
     /Zuletzt gespeichert/.test(label || ''), label || 'keine');
  ok('sichtbar steht sie nicht da', !/Zuletzt/.test(await stamp.innerText()), await stamp.innerText());
}
{
  // Eingabetaste auf dem Ankreuzfeld: eine zweite Liste anlegen und tippen
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.evaluate(() => localStorage.clear());
  await p2.reload({ waitUntil: 'networkidle' });
  await p2.locator('#btnCreateHero').click();
  await p2.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await p2.locator('#chkKeyDone').focus();
  await p2.keyboard.press('Enter');
  await p2.waitForTimeout(250);
  ok('die Eingabetaste kreuzt an und schließt den Kasten',
     await p2.locator('#keyBox').isHidden());
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
ok('und keinen Zeitstempel im Inventarkopf', await gast.locator('#listUpdated').isHidden());
await gast.close();

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
