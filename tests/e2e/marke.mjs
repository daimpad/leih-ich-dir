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
// Seit der Knete traegt die Silbe Kaugummi, die Farbe der Wortmarke im
// Hero; frueher das Gruen der Anwendung.
const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-ich').trim());
ok('und zwar Kaugummi wie im Hero', cIch === 'rgb(194, 71, 122)', cIch + ' / Token ' + token);
const ff = await word.evaluate(n => getComputedStyle(n).fontFamily);
ok('Wortmarke in Nunito', ff.includes('Nunito'), ff);

// Bis Oktober 2026 standen hier die Ueberschriften der Schritte, eine
// dritte Ordnung. Die Schritte sind fort; die Einstiege tragen eine zweite,
// und fuer die gilt dasselbe.
console.log('\n· Ueberschriften der Einstiege');
const h3 = page.locator('.einstieg h2').first();
ok('Ueberschrift vorhanden', await h3.count() > 0);
const ff3 = await h3.evaluate(n => getComputedStyle(n).fontFamily);
ok('in Nunito', ff3.includes('Nunito'), ff3);
// Ranchers hatte einen einzigen Schnitt und vertrug keine enge Laufweite;
// beides galt nur ihr. Nunito kommt als variable Datei bis 1000, der
// schwerste Schnitt ist also gezeichnet und nicht gerechnet.
const w3 = await h3.evaluate(n => getComputedStyle(n).fontWeight);
ok('im schwersten Schnitt', w3 === '900', w3);
const geladen = await page.evaluate(() => document.fonts.check('900 16px Nunito'));
ok('und der ist geladen, nicht gerechnet', geladen);

console.log('\n· Anlegen beginnt oben');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
const roll = await page.evaluate(() => ({ y: window.scrollY,
  moeglich: document.documentElement.scrollHeight - window.innerHeight }));
ok('Seite war heruntergerollt', roll.y > 0 && roll.y >= roll.moeglich - 1, JSON.stringify(roll));
await page.locator('#btnCreate').last().click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(400);
const yNach = await page.evaluate(() => window.scrollY);
ok('Liste beginnt am Seitenanfang', yNach === 0, 'y=' + yNach);
ok('der Zugangshinweis ist da', await page.locator('#keyBox').isVisible());
/* Bis Oktober 2026 lag der Zugangshinweis im ersten Bildschirm, zuerst unter
   dem Inventar, dann ueber den Reitern. Seitdem ist er ein festes Feld unter
   dem offenen Schritt, so entschieden gegen den Platz ganz oben. Unter dem
   leeren Inventar liegt er knapp unter dem ersten Bildschirm; im Blick ist
   er spaetestens im zweiten Schritt, dessen Inhalt kurz ist (siehe unten). */
const abstand = await page.evaluate(() => Math.round(document.getElementById('keyBox').getBoundingClientRect().top -
  document.getElementById('inventoryBox').getBoundingClientRect().bottom));
ok('er steht direkt unter dem ersten Schritt', abstand >= 0 && abstand <= 48, abstand + 'px');

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

console.log('\n· Spaetestens im zweiten Schritt im Blick');
await page.locator('#inventoryBox [data-weiter="2"]').click();
await page.waitForTimeout(700);
const imBlick = await page.evaluate(() => ({ titel: Math.round(document.querySelector('#keyBox .keybox__title').getBoundingClientRect().bottom),
  hoehe: innerHeight }));
ok('mit dem Weiter zum Kontakt steht die Bitte im ersten Bildschirm', imBlick.titel <= imBlick.hoehe, JSON.stringify(imBlick));

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
