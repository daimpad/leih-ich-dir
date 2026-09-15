import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';

const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };

const browser = await chromium.launch({ executablePath: B });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });

console.log('\n· Marke');
// Die Bildmarke war in einer fruehen Runde entfernt worden und ist auf
// ausdrueckliche Anweisung zurueck — jetzt als geliefertes logo.svg.
ok('Bildmarke im Kopf', await page.locator('header img.brand-mark').count() === 1);
ok('es ist logo.svg', /assets\/pics\/logo\.svg$/.test(
   await page.locator('header img.brand-mark').getAttribute('src') || ''),
   await page.locator('header img.brand-mark').getAttribute('src'));
ok('links von der Wortmarke', await page.evaluate(() => {
  const i = document.querySelector('header img.brand-mark').getBoundingClientRect();
  const w = document.querySelector('.brand-word').getBoundingClientRect();
  return i.x < w.x;
}));
const word = page.locator('.brand-word');
ok('Wortmarke lautet LeihIchDir', (await word.innerText()).replace(/\s/g, '') === 'LeihIchDir',
   await word.innerText());
const ich = page.locator('.brand-ich');
ok('Silbe "Ich" ist ausgezeichnet', await ich.count() === 1 && (await ich.innerText()) === 'Ich',
   await ich.innerText());
const cIch = await ich.evaluate(n => getComputedStyle(n).color);
const cWort = await word.evaluate(n => getComputedStyle(n).color);
ok('Silbe traegt eine eigene Farbe', cIch !== cWort, cIch + ' vs ' + cWort);
const gruen = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--green').trim());
ok('und zwar das Gruen der Anwendung', cIch === 'rgb(15, 122, 85)', cIch + ' / Token ' + gruen);
const ff = await word.evaluate(n => getComputedStyle(n).fontFamily);
ok('Wortmarke in Ranchers', ff.includes('Ranchers'), ff);

console.log('\n· Ueberschriften dritter Ordnung');
const h3 = page.locator('.steps h3').first();
ok('h3 vorhanden', await h3.count() > 0);
const ff3 = await h3.evaluate(n => getComputedStyle(n).fontFamily);
ok('h3 in Ranchers', ff3.includes('Ranchers'), ff3);
const ls3 = await h3.evaluate(n => getComputedStyle(n).letterSpacing);
ok('h3 ohne enge Laufweite', ls3 === 'normal' || ls3 === '0px', ls3);
const w3 = await h3.evaluate(n => getComputedStyle(n).fontWeight);
ok('h3 ohne gerechnete Fettung', w3 === '400', w3);

console.log('\n· Anlegen beginnt oben');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
const roll = await page.evaluate(() => ({ y: window.scrollY,
  moeglich: document.documentElement.scrollHeight - window.innerHeight }));
ok('Seite war heruntergerollt', roll.y > 0 && roll.y >= roll.moeglich - 1, JSON.stringify(roll));
await page.locator('#btnCreateHero').last().click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(400);
const yNach = await page.evaluate(() => window.scrollY);
ok('Liste beginnt am Seitenanfang', yNach === 0, 'y=' + yNach);
const obenSichtbar = await page.locator('#keyBox').isVisible();
ok('der Zugangshinweis steht im Blick', obenSichtbar);
const boxY = await page.locator('#keyBox').boundingBox();
ok('Zugangshinweis liegt im ersten Bildschirm', boxY && boxY.y < 800, boxY ? 'y=' + Math.round(boxY.y) : 'fehlt');

console.log('\n· Hinweis auf das gemerkte Geraet');
const rem = page.locator('#keyRemember');
if (await rem.isVisible()) {
  const fs = await rem.evaluate(n => parseFloat(getComputedStyle(n).fontSize));
  const hint = await page.locator('.hint').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize));
  ok('deutlich kleiner als sonstige Hinweise', fs < 13, fs + 'px');
  const zeilen = await rem.evaluate(n => {
    const lh = parseFloat(getComputedStyle(n).lineHeight) || parseFloat(getComputedStyle(n).fontSize) * 1.5;
    return Math.round(n.getBoundingClientRect().height / lh);
  });
  ok('steht auf einer Zeile', zeilen === 1, zeilen + ' Zeilen');
} else {
  ok('Hinweis sichtbar', false, 'ausgeblendet');
}

console.log('\n· Restliche Seiten');
for (const p of ['ueber.html', 'impressum.html', 'datenschutz.html', 'einstellungen.html', 'check.html']) {
  await page.goto(URL + p, { waitUntil: 'networkidle' });
  const imgs = await page.locator('header img.brand-mark').count();
  const hasIch = await page.locator('.brand-ich').count();
  ok(p + ': mit Bildmarke und farbiger Silbe', imgs === 1 && hasIch === 1, 'img=' + imgs + ' ich=' + hasIch);
}

console.log('\n· Konsole');
ok('keine Fehler in der Konsole', problems.length === 0, problems.join(' | '));

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
