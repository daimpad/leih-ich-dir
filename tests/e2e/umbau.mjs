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

console.log('\n· Wortmarke');
// Die Marke als Ganzes, nicht nur das Wort: Seit der Bildmarke beginnt das
// Wort um Pfote und Abstand weiter rechts, der Verweis aber weiterhin buendig.
const marke = await page.locator('.brand').boundingBox();
const inhalt = await page.locator('.hero-panel').boundingBox();
ok('Marke steht links vom Inhalt oder bündig', marke.x <= inhalt.x + 2,
   'Marke x=' + Math.round(marke.x) + ' Inhalt x=' + Math.round(inhalt.x));
ok('und nicht am äußersten Rand geklebt', marke.x > 20, 'x=' + Math.round(marke.x));

console.log('\n· Hero');
const lead = await page.locator('.hero-panel .lead').innerText();
ok('neuer Satz im Hero', /Zeig Deinen Freund:innen, was sie bei Dir ausleihen können/.test(lead), lead);
ok('Dein und Dir großgeschrieben', /Deinen/.test(lead) && /bei Dir/.test(lead), lead);
const heroBtn = page.locator('#btnCreateHero');
ok('Aufruf im Hero vorhanden', await heroBtn.isVisible());
ok('und im Rahmen des Heros', await page.evaluate(() =>
  document.querySelector('.hero-panel').contains(document.getElementById('btnCreateHero'))));
// Seit es zwei Arten von Liste gibt, nennt der Aufruf die Art.
ok('Beschriftung stimmt', /Leihliste anlegen/.test(await heroBtn.innerText()), await heroBtn.innerText());

console.log('\n· Reihenfolge der Startseite');
const folge = await page.evaluate(() => {
  const ids = ['.hero', '.trust', '.howto', '#mineBox'];
  return ids.map(sel => { const n = document.querySelector(sel); return { sel, y: n ? n.getBoundingClientRect().top + window.scrollY : -1 }; });
});
const y = Object.fromEntries(folge.map(f => [f.sel, f.y]));
ok('Hero, Auszeichnungen, So gehts in dieser Reihenfolge',
   y['.hero'] < y['.trust'] && y['.trust'] < y['.howto'], JSON.stringify(y));
ok('Deine Listen sind ohne Liste gar nicht da', await page.evaluate(() => document.querySelector('#mineBox').hidden));

console.log('\n· Der Aufruf legt an');
await heroBtn.click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
ok('der Aufruf im Hero legt eine Liste an', await page.locator('#keyBox').isVisible());

console.log('\n· Zugangskasten über Link teilen');
const pos = await page.evaluate(() => {
  const p = sel => { const n = document.querySelector(sel); return n && !n.hidden ? n.getBoundingClientRect().top + window.scrollY : -1; };
  return { key: p('#keyBox'), inv: p('#inventoryBox'), kontakt: p('#contactBox'), share: p('#shareBox') };
});
ok('Zugang steht unter dem Inventar', pos.key > pos.inv, JSON.stringify(pos));
ok('Zugang steht direkt über Link teilen', pos.key < pos.share, JSON.stringify(pos));

console.log('\n· Gemerkte Listen erscheinen am Ende');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
ok('Kasten ist da', await page.locator('#mineBox').isVisible());
const y2 = await page.evaluate(() => ({
  howto: document.querySelector('.howto').getBoundingClientRect().top + window.scrollY,
  mine: document.querySelector('#mineBox').getBoundingClientRect().top + window.scrollY
}));
ok('und steht unter den Schritten', y2.mine > y2.howto, JSON.stringify(y2));

console.log('\n· Rechtsseiten');
for (const [datei, pruef] of [['impressum.html', /Kaiser-Karl-Ring 26/], ['datenschutz.html', /Kaiser-Karl-Ring 26/]]) {
  await page.goto(URL + datei, { waitUntil: 'networkidle' });
  const txt = await page.locator('main').innerText();
  ok(datei + ': Anschrift steht drin', pruef.test(txt));
  ok(datei + ': keine eckigen Klammern mehr', !/\[[^\]]{3,}\]/.test(txt),
     (txt.match(/\[[^\]]{3,}\]/) || [''])[0]);
  ok(datei + ': E-Mail verlinkt', await page.locator('a[href="mailto:contact@nozilla.de"]').count() > 0);
}
const imp = await page.goto(URL + 'impressum.html', { waitUntil: 'networkidle' }).then(() => page.locator('main').innerText());
ok('Impressum nennt § 5 TMG', /§ 5 TMG/.test(imp));
ok('Impressum nennt die Streitschlichtung', /Verbraucherschlichtungsstelle/.test(imp));
ok('Impressum nennt CC BY-SA', /CC BY-SA/.test(imp));

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
