import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const OUT = BILDER.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: BROWSER });
const errs = [];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FEHLT:', n, x === undefined ? '' : x); } };

/* Wie gut sich die Zusagen vom Grund abheben, als Kontrastverhaeltnis nach
   WCAG: Schrift und Haekchen gegen den Grund der Seite. Bis Oktober 2026
   standen sie in --tinte-leise, das es nur fuer den hellen Grund gibt; im
   Dunkeln verschwanden sie darin (2,6 zu 1). Seitdem in der Farbe der
   Schrift, hell dunkel und dunkel hell. */
const kontrast = (p) => p.evaluate(() => {
  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const k = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const grund = lum(rgb(getComputedStyle(document.body).backgroundColor));
  const werte = [...document.querySelectorAll('.trust li')].map(n => ({
    schrift: k(lum(rgb(getComputedStyle(n).color)), grund),
    haken: k(lum(rgb(getComputedStyle(n.querySelector('.ico')).color)), grund)
  }));
  return { schrift: Math.min(...werte.map(w => w.schrift)), haken: Math.min(...werte.map(w => w.haken)), zahl: werte.length };
});
/* Text in der Groesse der Zusagen braucht 4,5 zu 1, ein Zeichen 3 zu 1. */
const lesbar = (n, kt) => ok('die Auszeichnungen heben sich ab (' + n + ')',
  kt.zahl === 4 && kt.schrift >= 4.5 && kt.haken >= 3, JSON.stringify(kt));

const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
// Gemessen wird nach dem Auftritt; solange er laeuft, ist der Satz verschoben.
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
// Bis Oktober 2026 waren die Auszeichnungen Knete und sahen aus wie Knoepfe.
// Seitdem sind sie flacher Text mit einem Haekchen davor.
{
  const flach = await page.evaluate(() => [...document.querySelectorAll('.trust li')].map(n => {
    const s = getComputedStyle(n);
    return { schatten: s.boxShadow, bild: s.backgroundImage, farbe: s.backgroundColor, haken: !!n.querySelector('use[href="#i-check"]') };
  }));
  ok('die Auszeichnungen sind keine Knoepfe: ohne Flaeche und ohne Schatten, mit Haekchen',
     flach.length === 4 && flach.every(f => f.schatten === 'none' && f.bild === 'none' &&
       f.farbe === 'rgba(0, 0, 0, 0)' && f.haken), JSON.stringify(flach[0]));
}
lesbar('hell', await kontrast(page));
// Der Rahmen stand flach — keine Verlaeufe, kein Punktraster, kein Schatten —,
// bis die Anwendung in Knete umgestellt wurde (Oktober 2026, auf ausdruecklichen
// Wunsch; der alte Stil liegt in archiv/alter-stil/). Danach war er Knete, bis
// der Hero breit wurde (ebenfalls Oktober 2026, ebenfalls auf ausdruecklichen
// Wunsch): Seitdem steht er ohne Rahmen auf dem Grund der Seite, und die Knete
// tragen Wortmarke und Dinge. Das Punktraster bleibt fort.
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

// Ein Aufruf, im ersten Einstieg. Bis Oktober 2026 stand ein zweiter im
// Hero; seitdem steht er nur noch gleich darunter, und der erste Bildschirm
// zeigt ihn trotzdem.
{
  const knopf = await page.locator('#btnCreate').boundingBox();
  ok('Aufruf ueber der Falz', knopf.y + knopf.height <= 900, Math.round(knopf.y + knopf.height));
  ok('im Hero steht keiner mehr', await page.locator('.hero button').count() === 0);
  const tipp = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
  const tp = await tipp.newPage();
  await tp.goto(BASE + '/', { waitUntil: 'networkidle' });
  await tp.waitForTimeout(300);
  /* Der Knopf im Einstieg ist schon hoch genug und braucht keine
     vergroesserte Flaeche; gemessen wird, was der Finger trifft. */
  const treffer = await tp.locator('#btnCreate').evaluate(n => Math.max(n.getBoundingClientRect().height,
    parseFloat(getComputedStyle(n, '::after').height) || 0));
  ok('auf grobem Zeiger mindestens 44 Punkte Trefferflaeche', treffer >= 44, String(treffer));
  await tipp.close();
}
// Der Knopf der Superliste traegt ausdruecklich KEIN data-create:
// createButtons() beschriftet jedes solche Element und schriebe sonst
// "Leihliste wird angelegt …" auf den falschen Knopf.
{
  const create = await page.evaluate(() => [...document.querySelectorAll('[data-create]')]
    .map(n => ({ id: n.id, text: n.textContent.trim(), kasten: !!n.closest('.einstieg') })));
  ok('ein Aufruf zur Leihliste, im Einstieg', create.length === 1 && create[0].kasten && create[0].id === 'btnCreate',
     JSON.stringify(create));
  ok('er nennt die Art', /Leihliste anlegen/.test(create[0].text), create[0].text);
  ok('der Superlisten-Knopf traegt kein data-create',
    await page.evaluate(() => !document.querySelector('#btnStartCircle').hasAttribute('data-create')));
}

// Kopfzeilen-Knopf
ok('Ohne Listen kein Knopf', await page.locator('#lnkMine').isHidden());
await page.click('#btnCreate');
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
lesbar('dunkel', await kontrast(p3));
await p3.screenshot({ path: OUT + '/S-dunkel.png', fullPage: true });
await c3.close();
// Dunkel gewaehlt auf hellem System: dieselben Farben ueber den zweiten Weg.
const c4 = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: 'light', locale: 'de-DE' });
await c4.addInitScript(() => { localStorage.setItem('lid.theme', 'dark'); });
const p4 = await c4.newPage();
await p4.goto(BASE + '/', { waitUntil: 'networkidle' });
await p4.waitForTimeout(600);
ok('dunkel gewaehlt, der Grund ist dunkel',
   await p4.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(9, 31, 22)');
lesbar('dunkel gewaehlt', await kontrast(p4));
await c4.close();

console.log(`\n${pass} bestanden, ${fail} offen`);
console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'Keine Konsolenfehler.');
await browser.close();
/* Ohne diesen Ausgang meldete die Suite offene Punkte nur in ihrer Zeile;
   lauf.mjs zaehlt aber nach dem Ausgangscode. */
process.exit(fail ? 1 : 0);
