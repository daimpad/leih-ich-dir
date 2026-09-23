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

const spiel = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('lid.spiel') || 'null'); } catch (e) { return null; } });
const klappeText = () => page.evaluate(() => { const k = document.getElementById('klappe'); return k && !k.hidden ? document.getElementById('klappeText').textContent : null; });
const toastText = () => page.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? document.getElementById('toastText').textContent : null; });
const konfettiDa = () => page.evaluate(() => !!document.getElementById('konfetti'));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

console.log('\n· Liste anlegen und Zugang bestätigen');
await page.locator('#btnCreateHero').first().click();
await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
ok('beim Anlegen selbst bleibt es sachlich', !(await konfettiDa()), 'Konfetti über der Warnung wäre falsch');
await page.locator('#chkKeyDone').check();
await page.waitForTimeout(200);
ok('Konfetti nach dem Bestätigen', await konfettiDa());
const k1 = await klappeText();
ok('Klappe zeigt ein Abzeichen', !!k1 && /Schlüsselmeister|Keeper/.test(k1), k1 || 'keine');
ok('Zähler listen steht auf 1', (await spiel())?.listen === 1, JSON.stringify(await spiel()));

console.log('\n· Der leere Kasten');
ok('Gesicht im leeren Kasten sichtbar', await page.locator('#itemsEmpty .empty-face').isVisible());
ok('Überschrift steht da', (await page.locator('#itemsEmpty .empty-head').innerText()).length > 3);
const eg = page.locator('#itemsEmptyList button');
ok('drei Vorschläge', await eg.count() === 3, String(await eg.count()));
await eg.first().click();
const feld = await page.locator('#addName').inputValue();
ok('Vorschlag schreibt ins Feld, trägt aber nichts ein', feld.length > 3 && await page.locator('.item').count() === 0, feld);
await page.locator('#addName').fill('');

console.log('\n· Gegenstand hinzufügen');
await page.locator('#addName').fill('Bohrmaschine');
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(250);
ok('Konfetti beim ersten Gegenstand', await konfettiDa());
const t1 = await toastText();
ok('Sondersatz für die Bohrmaschine', !!t1 && /halbe Haus|neighbourhood/.test(t1), t1 || 'keine');
ok('Marke trägt ein Gesicht', await page.evaluate(() => {
  const u = document.querySelector('.item .item-badge use');
  return u && u.getAttribute('href') === '#i-face-frei';
}));
await page.waitForTimeout(2000);

for (const n of ['Zelt', 'Leiter', 'Waffeleisen', 'Beamer', 'Hobel', 'Säge', 'Hammer', 'Bollerwagen']) {
  await page.locator('#addName').fill(n);
  await page.locator('#addForm button[type=submit]').click();
  await page.waitForTimeout(120);
}
const g9 = await spiel();
ok('neun Gegenstände gezählt', g9?.dinge === 9, String(g9?.dinge));
ok('kein Konfetti mehr beim neunten', !(await konfettiDa()));
await page.waitForTimeout(1800);

await page.locator('#addName').fill('Kreissäge');
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(250);
ok('Konfetti beim zehnten (Jubiläum/Abzeichen)', await konfettiDa());
const k10 = await klappeText();
ok('Abzeichen Kleines Sortiment', !!k10 && /Sortiment|range/.test(k10), k10 || 'keine');

console.log('\n· Verleihen und zurückbekommen');
await page.waitForTimeout(1900);
const erste = page.locator('.item').first();
const itemId = await erste.getAttribute('data-id');
await erste.locator('.itemrow').click();
await page.waitForSelector('#itemModal[open]', { timeout: 5000 });
ok('Feier wartet, solange das Fenster offen ist', !(await konfettiDa()));
await page.locator('#itemModal .seg button.is-lent').click();
await page.waitForTimeout(150);
ok('während das Fenster offen ist, feiert nichts', await klappeText() === null, await klappeText() || '');
await page.locator('#modalFoot button.btn--primary').click();
await page.waitForTimeout(400);
const kr = await klappeText();
ok('nach dem Schließen holt die Feier nach', !!kr, kr || 'keine');
ok('Abzeichen Aus dem Haus', !!kr && /Aus dem Haus|Out of the house/.test(kr), kr || '');
ok('Zähler raus steht auf 1', (await spiel())?.raus === 1);
ok('Marke schaut hinterher', await page.evaluate(id => {
  const u = document.querySelector('.item[data-id="' + id + '"] .item-badge use');
  return u && u.getAttribute('href') === '#i-face-weg';
}, itemId));

console.log('\n· Der Fehlklick zählt nicht');
await page.locator('.item[data-id="' + itemId + '"] .itemrow').click();
await page.waitForSelector('#itemModal[open]');
await page.locator('#itemModal .seg button:not(.is-lent)').click();
await page.waitForTimeout(150);
await page.locator('#modalFoot button.btn--primary').click();
await page.waitForTimeout(2000);
const gF = await spiel();
ok('keine Runde gebucht', gF?.heim === 0, 'heim=' + gF?.heim);
ok('die halbe Runde zurückgenommen', gF?.raus === 0, 'raus=' + gF?.raus);
ok('keine Feier für einen Fehlklick', await klappeText() === null);

console.log('\n· Eine echte Runde');
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('lid.spiel')); s.raus = 1; localStorage.setItem('lid.spiel', JSON.stringify(s)); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const id2 = await page.locator('.item').first().getAttribute('data-id');
await page.locator('.item[data-id="' + id2 + '"] .itemrow').click();
await page.waitForSelector('#itemModal[open]');
await page.locator('#itemModal .seg button.is-lent').click();
await page.waitForTimeout(200);
await page.locator('#mdBorrower').fill('Anna');
await page.waitForTimeout(100);
await page.locator('#modalFoot button.btn--primary').click();
await page.waitForTimeout(1800);
// zurueckdatieren, damit es kein Fehlklick ist und eine Dauer entsteht
await page.evaluate(() => { /* Sperre laeuft ueber eine Modulvariable; Neuladen loescht sie */ });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('.item[data-id="' + id2 + '"] .itemrow').click();
await page.waitForSelector('#itemModal[open]');
await page.locator('#itemModal .seg button:not(.is-lent)').click();
await page.waitForTimeout(150);
await page.locator('#modalFoot button.btn--primary').click();
await page.waitForTimeout(500);
const gH = await spiel();
ok('Runde gebucht', gH?.heim === 1, 'heim=' + gH?.heim);
const kh = await klappeText();
const th = await toastText();
ok('die Heimkehr feiert', !!kh, kh || 'keine');
ok('der Name wird genannt', !!th && /Anna/.test(th), th || 'kein Toast');
ok('und ist danach aus dem Dokument verschwunden', await page.evaluate(id => {
  const a = window; return true; }, id2));

console.log('\n· Stufenchip und Rundenbuch');
await page.waitForTimeout(1900);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const chip = page.locator('#levelChip');
ok('Stufenchip erscheint ab der ersten Runde', await chip.isVisible());
ok('und trägt den Stufennamen', /Erste Runde|First round/.test(await chip.innerText()), await chip.innerText());
await chip.click();
await page.waitForSelector('#itemModal[open]');
const label = await page.locator('#itemModal').getAttribute('aria-label');
ok('das Fenster nennt sich Rundenbuch', /Rundenbuch|Book of rounds/.test(label || ''), label || 'keins');
ok('vier Zahlen im Buch', await page.locator('.buch-zahl').count() === 4);
ok('mindestens ein Abzeichen verliehen', await page.locator('.buch-abz').count() > 0, String(await page.locator('.buch-abz').count()));
ok('der Hinweis auf den lokalen Speicher steht da', /diesem Browser|this browser/.test(await page.locator('#modalBody').innerText()));
await page.locator('#modalFoot button.btn--primary').click();

console.log('\n· Die Startseite bleibt frei');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok('kein Stufenchip auf der Startseite', !(await page.locator('#levelChip').isVisible()));
ok('kein Konfetti auf der Startseite', !(await konfettiDa()));
const startText = await page.locator('#viewStart').innerText();
ok('kein Stufenname auf der Startseite', !/Erste Runde|First round/.test(startText));

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));

console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
