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
await page.waitForTimeout(500);

// Im Rahmen steht, wozu die Liste da ist; die Zusagen stehen darunter.
const inPanel = await page.evaluate(() => {
  const p = document.querySelector('.hero-panel');
  return {
    titel: p.contains(document.querySelector('h1')),
    satz: p.contains(document.querySelector('.lead')),
    zusagen: p.contains(document.querySelector('.trust'))
  };
});
ok('Hero umfasst Titel und Satz', inPanel.titel && inPanel.satz, JSON.stringify(inPanel));
ok('die Auszeichnungen stehen unter dem Rahmen', !inPanel.zusagen, JSON.stringify(inPanel));
ok('und vor den Schritten', await page.evaluate(() => {
  const y = s => document.querySelector(s).getBoundingClientRect().top + window.scrollY;
  return y('.hero') < y('.trust') && y('.trust') < y('.howto');
}));
ok('Auszeichnungen in einer Reihe', await page.evaluate(() => {
  const ys = [...document.querySelectorAll('.trust li')].map(n => Math.round(n.getBoundingClientRect().y));
  return new Set(ys).size === 1;
}));
// Der Rahmen steht flach: keine Verlaeufe, kein Punktraster, kein Schatten.
const panel = await page.locator('.hero-panel').evaluate(n => {
  const s = getComputedStyle(n);
  return { bild: s.backgroundImage, farbe: s.backgroundColor, schatten: s.boxShadow,
           raster: getComputedStyle(n, '::before').backgroundImage };
});
ok('Hero ohne Verlauf', panel.bild === 'none', panel.bild.slice(0, 40));
ok('Hero ohne Punktraster', panel.raster === 'none', panel.raster.slice(0, 40));
ok('Hero ohne Schatten', panel.schatten === 'none', panel.schatten.slice(0, 40));
ok('Hero auf weisser Flaeche', panel.farbe === 'rgb(255, 255, 255)', panel.farbe);
ok('Grund der Seite ist das helle Gruen',
  await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(232, 250, 233)',
  await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

// Schritte nebeneinander mit Pfeilen, je Erklaerkasten. Es gibt jetzt zwei
// davon: einen fuer die Leihliste, einen fuer die Superliste.
const kaesten = await page.evaluate(() => [...document.querySelectorAll('.howto')].map(h => ({
  schritte: [...h.querySelectorAll('.steps li')].map(n => Math.round(n.getBoundingClientRect().y)),
  pfeile: [...h.querySelectorAll('.steps li')].slice(1)
    .map(n => getComputedStyle(n, '::before').maskImage || getComputedStyle(n, '::before').webkitMaskImage)
    .filter(v => v && v !== 'none').length,
  zeichen: h.querySelector('.howto__mark use').getAttribute('href')
})));
ok('zwei Erklaerkaesten', kaesten.length === 2, kaesten.length);
ok('je drei Schritte nebeneinander',
  kaesten.every(k => k.schritte.length === 3 && new Set(k.schritte).size === 1), JSON.stringify(kaesten.map(k => k.schritte)));
ok('je zwei Pfeile dazwischen', kaesten.every(k => k.pfeile === 2), JSON.stringify(kaesten.map(k => k.pfeile)));
ok('und je ein eigenes Zeichen',
  kaesten[0].zeichen === '#i-leihliste' && kaesten[1].zeichen === '#i-kreis', JSON.stringify(kaesten.map(k => k.zeichen)));

// Ein Aufruf, und der steht im Hero
{
  const oben = await page.locator('#btnCreateHero').boundingBox();
  const steps = await page.locator('.steps').first().boundingBox();
  ok('Aufruf steht vor den Schritten', oben.y < steps.y, [Math.round(oben.y), Math.round(steps.y)]);
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
// Zwei Aufrufe fuer die Leihliste, einer im Hero und einer im Erklaerkasten.
// Der Knopf der Superliste traegt ausdruecklich KEIN data-create:
// createButtons() beschriftet jedes solche Element und schriebe sonst
// "Leihliste wird angelegt …" auf den falschen Knopf.
{
  const create = await page.evaluate(() => [...document.querySelectorAll('[data-create]')]
    .map(n => ({ id: n.id, text: n.textContent.trim(), kasten: !!n.closest('.howto') })));
  ok('zwei Aufrufe zur Leihliste', create.length === 2, JSON.stringify(create));
  ok('einer davon im Hero', create.some(c => c.id === 'btnCreateHero'), JSON.stringify(create.map(c => c.id)));
  ok('einer im Erklaerkasten', create.some(c => c.kasten && !c.id), JSON.stringify(create));
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
// Je Kasten drei Schritte untereinander. Gezaehlt wird innerhalb des
// Kastens: Zwei Kaesten ergeben sechs verschiedene Hoehen, nicht drei.
const sY = await p2.evaluate(() => [...document.querySelectorAll('.howto')]
  .map(h => [...h.querySelectorAll('.steps li')].map(n => Math.round(n.getBoundingClientRect().y))));
ok('Schritte stapeln sich schmal',
  sY.length === 2 && sY.every(k => k.length === 3 && new Set(k).size === 3), JSON.stringify(sY));
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
