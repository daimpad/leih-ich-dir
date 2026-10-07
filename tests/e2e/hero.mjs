import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const OUT = BILDER.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: BROWSER });
const errs = [];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FEHLT:', n, x === undefined ? '' : x); } };

const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
// Gemessen wird nach dem Auftritt; solange er laeuft, ist der Aufruf verschoben.
await page.waitForFunction(() => !document.querySelector('.hero--auftritt'), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);

// Im Hero steht, wozu die Liste da ist; die Zusagen stehen darunter.
const inPanel = await page.evaluate(() => {
  const p = document.querySelector('.hero');
  return {
    titel: p.contains(document.querySelector('h1')),
    satz: p.contains(document.querySelector('.lead')),
    zusagen: p.contains(document.querySelector('.trust'))
  };
});
ok('Hero umfasst Titel und Satz', inPanel.titel && inPanel.satz, JSON.stringify(inPanel));
ok('die Auszeichnungen stehen unter dem Hero', !inPanel.zusagen, JSON.stringify(inPanel));
ok('und vor den Einstiegen', await page.evaluate(() => {
  const y = s => document.querySelector(s).getBoundingClientRect().top + window.scrollY;
  return y('.hero') < y('.trust') && y('.trust') < y('.einstieg');
}));
ok('Auszeichnungen in einer Reihe', await page.evaluate(() => {
  const ys = [...document.querySelectorAll('.trust li')].map(n => Math.round(n.getBoundingClientRect().y));
  return new Set(ys).size === 1;
}));
// Der Rahmen stand flach — keine Verlaeufe, kein Punktraster, kein Schatten —,
// bis die Anwendung in Knete umgestellt wurde (Oktober 2026, auf ausdruecklichen
// Wunsch; der alte Stil liegt in archiv/alter-stil/). Danach war er Knete, bis
// der Hero breit wurde (ebenfalls Oktober 2026, ebenfalls auf ausdruecklichen
// Wunsch): Seitdem steht er ohne Rahmen auf dem Grund der Seite, und die Knete
// tragen Wortmarke, Dinge und Aufruf. Das Punktraster bleibt fort.
const panel = await page.locator('.hero').evaluate(n => {
  const s = getComputedStyle(n);
  return { bild: s.backgroundImage, farbe: s.backgroundColor, schatten: s.boxShadow,
           raster: getComputedStyle(n, '::before').backgroundImage };
});
ok('Hero ohne Rahmen: keine eigene Flaeche', panel.bild === 'none' && panel.farbe === 'rgba(0, 0, 0, 0)', panel.bild.slice(0, 40) + ' ' + panel.farbe);
ok('Hero ohne Rahmen: kein Schatten', panel.schatten === 'none', panel.schatten.slice(0, 60));
ok('Hero ohne Punktraster', panel.raster === 'none', panel.raster.slice(0, 40));
ok('Grund der Seite ist Minzgruen',
  await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(233, 249, 241)',
  await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

// Zwei Einstiege, einer fuer die Leihliste, einer fuer die Superliste. Bis
// Oktober 2026 standen darin je drei Schritte mit Pfeilen; auf ausdruecklichen
// Wunsch tragen sie seitdem nur noch Ueberschrift und Aufruf, die Superliste
// dazu einen Satz.
const kaesten = await page.evaluate(() => [...document.querySelectorAll('.einstieg')].map(h => ({
  titel: h.querySelector('h2').textContent.trim(),
  satz: (h.querySelector('.einstieg__text p') || { textContent: '' }).textContent.trim(),
  zeichen: h.querySelector('.einstieg__mark use').getAttribute('href'),
  knete: getComputedStyle(h).boxShadow.split(/,(?![^(]*\))/).length === 3
})));
ok('zwei Einstiege', kaesten.length === 2, kaesten.length);
ok('der erste sagt nur: Leihliste erstellen', kaesten[0].titel === 'Leihliste erstellen' && kaesten[0].satz === '',
  JSON.stringify(kaesten[0]));
ok('der zweite: Die Superliste, eine Liste aus verschiedenen Leihlisten',
  kaesten[1].titel === 'Die Superliste' && kaesten[1].satz === 'Eine Liste aus verschiedenen Leihlisten.',
  JSON.stringify(kaesten[1]));
ok('keine Schritte mehr', await page.locator('.steps, .step-no').count() === 0);
ok('je ein eigenes Zeichen',
  kaesten[0].zeichen === '#i-leihliste' && kaesten[1].zeichen === '#i-kreis', JSON.stringify(kaesten.map(k => k.zeichen)));
ok('beide aus Knete', kaesten.every(k => k.knete));

// Ein Aufruf, und der steht im Hero
{
  const oben = await page.locator('#btnCreateHero').boundingBox();
  const steps = await page.locator('.einstieg').first().boundingBox();
  ok('Aufruf steht vor den Einstiegen', oben.y < steps.y, [Math.round(oben.y), Math.round(steps.y)]);
  ok('Aufruf ueber der Falz', oben.y + oben.height <= 900, Math.round(oben.y + oben.height));
  // Die sichtbare Hoehe ist auf ausdrueckliche Anweisung flach. Treffbar
  // bleibt der Knopf trotzdem: Auf groben Zeigern waechst die Flaeche, nicht
  // das Bild — geprueft wird deshalb beides getrennt.
  ok('Aufruf flach gehalten', oben.height >= 36 && oben.height <= 48, Math.round(oben.height));
  const tipp = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
  const tp = await tipp.newPage();
  await tp.goto(BASE + '/', { waitUntil: 'networkidle' });
  await tp.waitForTimeout(300);
  const flaeche = await tp.locator('#btnCreateHero').evaluate(n => getComputedStyle(n, '::after').height);
  ok('auf grobem Zeiger 44 Punkte Trefferflaeche', parseFloat(flaeche) >= 44, flaeche);
  await tipp.close();
}
// Zwei Aufrufe fuer die Leihliste, einer im Hero und einer im Einstieg.
// Der Knopf der Superliste traegt ausdruecklich KEIN data-create:
// createButtons() beschriftet jedes solche Element und schriebe sonst
// "Leihliste wird angelegt …" auf den falschen Knopf.
{
  const create = await page.evaluate(() => [...document.querySelectorAll('[data-create]')]
    .map(n => ({ id: n.id, text: n.textContent.trim(), kasten: !!n.closest('.einstieg') })));
  ok('zwei Aufrufe zur Leihliste', create.length === 2, JSON.stringify(create));
  ok('einer davon im Hero', create.some(c => c.id === 'btnCreateHero'), JSON.stringify(create.map(c => c.id)));
  ok('einer im Einstieg', create.some(c => c.kasten && !c.id), JSON.stringify(create));
  ok('beide nennen die Art', create.every(c => /Leihliste anlegen/.test(c.text)), JSON.stringify(create.map(c => c.text)));
  ok('der Superlisten-Knopf traegt kein data-create',
    await page.evaluate(() => !document.querySelector('#btnStartCircle').hasAttribute('data-create')));
}

// Kopfzeilen-Knopf
ok('Ohne Listen kein Knopf', await page.locator('#lnkMine').isHidden());
await page.click('#btnCreateHero');
await page.waitForSelector('#viewList:not([hidden])');
await page.waitForTimeout(800);
ok('Mit Liste erscheint der Knopf', await page.locator('#lnkMine').isVisible());
ok('Knopf fuehrt bei einer Liste direkt hinein',
   /#e=/.test(await page.locator('#lnkMine').getAttribute('href')),
   await page.locator('#lnkMine').getAttribute('href'));
const editUrl = page.url();
await page.check('#chkKeyDone');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/S-liste.png', fullPage: true });

await page.goto(BASE + '/einstellungen.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
ok('Knopf auch in den Einstellungen', await page.locator('#lnkMine').isVisible());

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
ok('Knopf auch auf der Startseite', await page.locator('#lnkMine').isVisible());
ok('Gemerkte Liste steht auf der Startseite', await page.locator('#mineBox').isVisible());
await page.screenshot({ path: OUT + '/S-start.png', fullPage: true });
await ctx.close();

// Telefon
const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'de-DE' });
const p2 = await c2.newPage();
p2.on('pageerror', e => errs.push('PAGEERROR(390): ' + e.message));
await p2.goto(BASE + '/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(600);
const d = await p2.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
ok('Kein Ueberlauf am Telefon', d[0] <= d[1] + 1, d);
// Schmal rutscht der Aufruf jedes Einstiegs unter Zeichen und Ueberschrift
// und nimmt die ganze Breite.
const sY = await p2.evaluate(() => [...document.querySelectorAll('.einstieg')].map(h => {
  const t = h.querySelector('h2').getBoundingClientRect();
  const b = h.querySelector('.einstieg__act .btn').getBoundingClientRect();
  const k = h.getBoundingClientRect();
  return { unter: b.top >= t.bottom, breit: b.width >= k.width - 2 * 16 - 2 };
}));
ok('Aufrufe schmal unter der Ueberschrift, in voller Breite',
  sY.length === 2 && sY.every(k => k.unter && k.breit), JSON.stringify(sY));
await p2.screenshot({ path: OUT + '/S-telefon.png', fullPage: true });
await c2.close();

// Dunkel
const c3 = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: 'dark', locale: 'de-DE' });
const p3 = await c3.newPage();
await p3.goto(BASE + '/', { waitUntil: 'networkidle' });
await p3.waitForTimeout(600);
await p3.screenshot({ path: OUT + '/S-dunkel.png', fullPage: true });
await c3.close();

console.log(`\n${pass} bestanden, ${fail} offen`);
console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'Keine Konsolenfehler.');
await browser.close();
