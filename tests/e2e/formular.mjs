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

console.log('\n· Meine Listen im Kopf der Startseite');
ok('ohne Listen kein Verweis', await page.locator('#lnkMine').isHidden());
await page.locator('#btnCreateHero').click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.locator('#chkKeyDone').check();
await page.waitForTimeout(2300);
const listenLink = page.url();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
ok('mit Listen steht er auch auf der Startseite', await page.locator('#lnkMine').isVisible());
ok('und liegt in der Kopfleiste', await page.evaluate(() =>
  document.querySelector('header.site').contains(document.getElementById('lnkMine'))));

// Zurueck in die noch leere Liste: Dort steht der Kasten mit den Beispielen.
await page.goto(listenLink, { waitUntil: 'networkidle' });
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(300);

console.log('\n· Zufällige Beispiele');
const eg1 = await page.evaluate(() => Array.from(document.querySelectorAll('#itemsEmptyList button')).map(b => b.textContent));
const ph1 = await page.locator('#addName').getAttribute('placeholder');
ok('drei Beispiele im leeren Kasten', eg1.length === 3, JSON.stringify(eg1));
ok('mit z. B. abgekürzt', /z\. ?B\./.test(await page.locator('.empty-eg__label').innerText()),
   await page.locator('.empty-eg__label').innerText());
ok('Platzhalter nennt z. B. und einen Gegenstand', /^z\. ?B\. .+/.test(ph1), ph1);
ok('Beispiele wiederholen sich nicht', new Set(eg1).size === 3, JSON.stringify(eg1));

let andere = 0;
for (let i = 0; i < 6; i++) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(250);
  const eg = await page.evaluate(() => Array.from(document.querySelectorAll('#itemsEmptyList button')).map(b => b.textContent));
  if (JSON.stringify(eg) !== JSON.stringify(eg1)) { andere++; }
}
ok('jeder Seitenaufruf zeigt andere', andere >= 4, andere + ' von 6 Aufrufen anders');

const stabil = await page.evaluate(() => {
  const vor = Array.from(document.querySelectorAll('#itemsEmptyList button')).map(b => b.textContent);
  return JSON.stringify(vor);
});
await page.locator('#btnTheme').click();
await page.waitForTimeout(200);
const stabil2 = await page.evaluate(() => JSON.stringify(Array.from(document.querySelectorAll('#itemsEmptyList button')).map(b => b.textContent)));
ok('innerhalb eines Aufrufs bleiben sie stehen', stabil === stabil2, stabil + ' / ' + stabil2);

console.log('\n· Pflicht und Freiwilligkeit');
ok('Gegenstand trägt einen Stern', await page.locator('label[for="addName"] .req').innerText() === '*');
ok('und sagt der Vorlesestimme warum',
   /Pflichtfeld/.test(await page.locator('label[for="addName"] .sr-only').innerText()));
ok('das Feld ist als Pflicht ausgezeichnet',
   await page.locator('#addName').getAttribute('aria-required') === 'true');
await page.locator('#contactBox summary').click();
await page.waitForTimeout(150);
for (const [sel, wort] of [['label[for="cfgName"]', 'freiwillig'], ['label[for="cfgEmail"]', 'freiwillig'], ['label[for="cfgPhone"]', 'freiwillig']]) {
  ok(sel + ' sagt freiwillig', new RegExp(wort).test(await page.locator(sel).innerText()), await page.locator(sel).innerText());
}

console.log('\n· Warnung bei leerem Pflichtfeld');
await page.locator('#addName').fill('');
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(250);
ok('das Feld wird bemängelt', await page.locator('#addName').getAttribute('aria-invalid') === 'true');
ok('und optisch hervorgehoben', (await page.locator('#addName').getAttribute('class')).includes('is-leer'));
const tx = await page.evaluate(() => document.getElementById('toastText').textContent);
ok('mit einer Meldung', /Namen/.test(tx), tx);
ok('der Schreibzeiger steht im Feld', await page.evaluate(() => document.activeElement.id) === 'addName');
await page.locator('#addName').fill('Bohrmaschine');
await page.waitForTimeout(150);
ok('beim Tippen fällt die Markierung weg', await page.locator('#addName').getAttribute('aria-invalid') === null);
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(2300);

console.log('\n· Das Feld für mehrere');
await page.locator('#btnBulk').click();
await page.waitForTimeout(200);
const rows = await page.locator('#voiceText').getAttribute('rows');
ok('Textfeld dreifach so hoch', rows === '6', 'rows=' + rows);
ok('trägt ebenfalls einen Stern', await page.locator('label[for="voiceText"] .req').innerText() === '*');
const abstand = await page.evaluate(() => {
  const t = document.getElementById('voiceText').getBoundingClientRect();
  const b = document.getElementById('btnVoiceApply').getBoundingClientRect();
  return Math.round(b.top - t.bottom);
});
ok('Übernehmen hat Abstand nach oben', abstand >= 14, abstand + 'px');
await page.locator('#btnVoiceApply').click();
await page.waitForTimeout(250);
ok('leeres Textfeld wird bemängelt', await page.locator('#voiceText').getAttribute('aria-invalid') === 'true');

console.log('\n· Speicherzustand neben dem Titel');
const lage = await page.evaluate(() => {
  const chip = document.getElementById('saveState');
  const wrap = document.getElementById('listTitleEditWrap');
  const c = chip.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  return { imRow: chip.parentElement.className, rechts: c.left > w.left, groesse: parseFloat(getComputedStyle(chip).fontSize) };
});
ok('steht in der Titelzeile', lage.imRow === 'titlerow', lage.imRow);
ok('rechts vom Titel', lage.rechts);
ok('und klein', lage.groesse <= 13, lage.groesse + 'px');

console.log('\n· Der Verweis unter der Schaltfläche');
const unten = await page.evaluate(() => {
  const btn = document.querySelector('#addForm button[type=submit]').getBoundingClientRect();
  const link = document.getElementById('btnBulk').getBoundingClientRect();
  return { unter: link.top >= btn.bottom, rechtsbuendig: Math.abs(link.right - btn.right) < 4 };
});
ok('steht unter der Schaltfläche', unten.unter);
ok('und bündig mit ihrem rechten Rand', unten.rechtsbuendig);

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
