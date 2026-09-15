import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const OUT = BILDER.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: BROWSER });
const errs = [];
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  FEHLT:', name, extra === undefined ? '' : extra); }
}

// --- Bearbeiten, Schreibtisch ---
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
{ const b = await page.locator('#btnCreateHero').boundingBox(); ok('Aufforderung über der Falz', b.y + b.height <= 900, Math.round(b.y + b.height)); }
ok('Abzeichen Speicherort verborgen', await page.locator('#storageBadge').isHidden());
await page.click('#btnCreateHero');
await page.waitForSelector('#viewList:not([hidden])');
await page.waitForTimeout(700);
ok('Zugangskarte sichtbar', await page.isVisible('#keyBox'));
ok('Zugangslink gefüllt', (await page.inputValue('#keyLink')).includes('#e='));
ok('Titel vorbelegt', (await page.inputValue('#listTitleInput')).length > 0);
ok('Kontakt zugeklappt', !(await page.locator('#contactBox').evaluate(n => n.open)));
ok('Einstellungen als eigene Seite', await page.locator('#lnkSettings').count() === 1);
const editUrl = page.url();
await page.check('#chkKeyDone');
ok('Zugangskarte weggeräumt', await page.locator('#keyBox').isHidden());

for (const it of ['Bohrmaschine', 'Lastenrad', 'Beamer']) {
  await page.fill('#addName', it);
  await page.click('#addForm button[type=submit]');
  await page.waitForTimeout(140);
}
await page.waitForTimeout(700);
ok('Drei Zeilen', await page.locator('.items li').count() === 3);
ok('Kein Haken bei verfügbar sichtbar als Text', (await page.locator('.items li').first().innerText()).indexOf('Verliehen') === -1);

// Fenster: Name nur einmal
await page.click('.items li:first-child .itemrow');
await page.waitForTimeout(300);
ok('Name im Kopf als Feld', await page.locator('#modalTitle input').count() === 1);
ok('Kein zweites Namensfeld im Rumpf', await page.locator('#modalBody #mdName').count() === 0);
ok('Zwei Zustände zur Wahl', await page.locator('#modalBody .seg button').count() === 2);
await page.click('#modalBody .seg button.is-lent');
await page.waitForTimeout(250);
await page.fill('#mdBorrower', 'Jonas');
await page.waitForTimeout(250);
const lentBtn = await page.locator('#modalBody .seg button.is-lent').getAttribute('aria-pressed');
ok('Verliehen gewählt', lentBtn === 'true');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Ausleiher in der Zeile', (await page.textContent('.items li:first-child .item-state')).includes('Jonas'));

// Löschen mit Rücknahme
await page.click('.items li:nth-child(2) .itemrow');
await page.waitForTimeout(250);
await page.click('#modalFoot .btn--danger');
await page.waitForTimeout(300);
ok('Rücknahme angeboten', await page.isVisible('#toastAct'));
await page.click('#toastAct');
await page.waitForTimeout(300);
ok('Eintrag zurück', await page.locator('.items li').count() === 3);

// Farben: gefüllte Fläche der Hauptschaltfläche ist grün
const btnBg = await page.locator('#addForm button[type=submit]').evaluate(n => getComputedStyle(n).backgroundColor);
ok('Hauptschaltfläche grün', btnBg === 'rgb(15, 122, 85)', btnBg);
const delColor = await page.locator('.btn--danger').first().evaluate(n => getComputedStyle(n).backgroundColor);
ok('Löschen ohne Fläche', delColor === 'rgba(0, 0, 0, 0)', delColor);

const viewUrl = await page.inputValue('#linkView');
await page.waitForTimeout(1200);

// Startseite: gemerkte Liste
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
ok('Gemerkte Liste auf der Startseite', await page.isVisible('#mineBox'));
ok('Verweis führt zum Bearbeiten-Link', (await page.locator('#mineList a').first().getAttribute('href')).indexOf('#e=') === 0);
await page.locator('#mineList a').first().click();
await page.waitForTimeout(900);
ok('Liste über den Merkzettel geöffnet', await page.isVisible('#addForm'));
await ctx.close();

// --- Freundesansicht ---
const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'de-DE' });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('PAGEERROR(view): ' + e.message));
await p2.goto(viewUrl, { waitUntil: 'networkidle' });
await p2.waitForTimeout(900);
ok('Anfragen in der Zeile', await p2.locator('.item-ask').count() === 2);
ok('Kein Anfragen bei Verliehenem', await p2.locator('.item--lent .item-ask').count() === 0);
ok('Bearbeiten-Bereiche verborgen', await p2.locator('#shareBox').isHidden() && await p2.locator('#addForm').isHidden());
ok('Zuletzt geprüft steht da', (await p2.textContent('#checkedAt')).length > 0);
await p2.locator('.item-ask').first().click();
await p2.waitForTimeout(350);
ok('Anfragefenster offen', await p2.locator('#itemModal').evaluate(n => n.open));
ok('Anfrage ist die Hauptsache', await p2.locator('#modalFoot .btn--primary').count() === 1);
await ctx2.close();

// --- Telefon ---
for (const w of [320, 390]) {
  const c = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'de-DE' });
  const p = await c.newPage();
  p.on('pageerror', e => errs.push(`PAGEERROR(${w}): ` + e.message));
  await p.goto(editUrl, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const doc = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(`Kein Überlauf bei ${w}`, doc[0] <= doc[1] + 1, doc);
  const mic = await p.locator('#btnMic').boundingBox();
  ok(`Mikrofon bleibt Quadrat bei ${w}`, mic.width < 60, mic && Math.round(mic.width));
  const add = await p.locator('#addForm button[type=submit]').boundingBox();
  ok(`Hinzufügen bleibt Quadrat bei ${w}`, add.width < 60, add && Math.round(add.width));
  await p.evaluate(() => window.scrollTo(0, 400));
  await p.waitForTimeout(300);
  const box = await p.locator('.addbox').boundingBox();
  ok(`Eingabe bleibt im Blick bei ${w}`, box.y >= 0 && box.y < 200, box && Math.round(box.y));
  if (w === 390) { await p.screenshot({ path: OUT + '/F-telefon.png', fullPage: true }); }
  await c.close();
}

// --- Dunkel ---
const c3 = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: 'dark', locale: 'de-DE' });
const p3 = await c3.newPage();
await p3.goto(editUrl, { waitUntil: 'networkidle' });
await p3.waitForTimeout(900);
const bg = await p3.evaluate(() => getComputedStyle(document.body).backgroundColor);
ok('Dunkel greift', bg === 'rgb(22, 19, 15)', bg);
await p3.screenshot({ path: OUT + '/F-dunkel.png', fullPage: true });
await c3.close();

// --- Englisch ---
const c4 = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
const p4 = await c4.newPage();
await p4.goto(viewUrl, { waitUntil: 'networkidle' });
await p4.waitForTimeout(900);
// Deutsch ist die Standardsprache, auch bei englischem Browser. Englisch
// ist eine Wahl — also wird der Schalter bedient.
ok('Deutsch trotz englischem Browser', /^Anfragen\b/.test((await p4.textContent('.item-ask')).trim()),
   await p4.textContent('.item-ask'));
await p4.click('#btnLang');
await p4.waitForTimeout(700);
ok('Englisch greift nach dem Umschalten', /^Ask\b/.test((await p4.textContent('.item-ask')).trim()),
   await p4.textContent('.item-ask'));
await c4.close();

console.log(`\n${pass} bestanden, ${fail} offen`);
console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'Keine Konsolenfehler.');
await browser.close();
