/*
 * Vorschaubild und Zeichen neu erzeugen.
 *
 *   php -S 127.0.0.1:8099        # in der Wurzel, Fenster 1
 *   node tools/bilder.mjs         # Fenster 2
 *
 * Schreibt assets/pics/og.png, die Zeichen in assets/favicon/ und die Kopie
 * von favicon.ico in der Wurzel. Quelle sind die laufende Startseite, die
 * Vorlage tools/og-vorlage.html und die Bildmarke assets/pics/logo.svg;
 * nichts davon wird abgeschrieben. Die Wortmarke etwa formt app.js in der
 * geladenen Schrift, und genau diese Fassung landet im Vorschaubild.
 *
 * Wie die Browsertests ein Werkzeug fuer Node und nicht fuer den Browser,
 * deshalb .mjs und ohne die ES5-Zusage. Playwright findet es ueber
 * tests/e2e/hilfe.mjs, mit denselben Umgebungsvariablen.
 */
import { writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteBrowser, BASE } from '../tests/e2e/hilfe.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const ziel = (pfad) => join(WURZEL, pfad);
const br = await starteBrowser();

/* -- 1 · Was die Startseite zeigt ---------------------------------------- */

const start = await br.newPage({ viewport: { width: 1280, height: 900 } });
await start.goto(BASE + '/', { waitUntil: 'networkidle' });
await start.waitForFunction(() => document.querySelectorAll('#wortmarke .buchstabe').length > 0, null, { timeout: 8000 });
const teile = await start.evaluate(() => ({
  vorrat: document.querySelector('svg.sprite defs').outerHTML,
  wortmarke: document.getElementById('wortmarke').outerHTML,
  dinge: document.querySelector('.hero-bild').outerHTML
}));
await start.close();

/* -- 2 · Das Vorschaubild ------------------------------------------------ */

const og = await br.newPage({ viewport: { width: 1200, height: 630 } });
await og.goto(BASE + '/tools/og-vorlage.html', { waitUntil: 'networkidle' });
await og.evaluate((t) => {
  document.getElementById('vorrat').innerHTML = '<svg class="sprite" aria-hidden="true" focusable="false">' + t.vorrat + '</svg>';
  document.getElementById('wortmarke-platz').outerHTML = t.wortmarke;
  document.getElementById('dinge-platz').outerHTML = t.dinge;
}, teile);
await og.evaluate(() => document.fonts.ready);
await og.waitForTimeout(400);
await og.screenshot({ path: ziel('assets/pics/og.png') });
await og.close();
console.log('assets/pics/og.png              1200 x 630');

/* -- 3 · Die Zeichen ----------------------------------------------------- */

const zeichen = await br.newPage();

/** Die Bildmarke in einer Groesse. Mit Grund fuer das Apple-Symbol: iOS
    legt seine eigene Maske darueber und fuellt Durchsichtiges schwarz. */
async function zeichne(groesse, grund) {
  await zeichen.setViewportSize({ width: groesse, height: groesse });
  const rand = grund ? Math.round(groesse * 0.06) : 0;
  const mass = groesse - 2 * rand;
  await zeichen.setContent(
    '<!DOCTYPE html><html><body style="margin:0;background:' + (grund || 'transparent') + '">' +
    '<img src="' + BASE + '/assets/pics/logo.svg" width="' + mass + '" height="' + mass + '" ' +
    'style="display:block;margin:' + rand + 'px"></body></html>');
  await zeichen.waitForFunction(() => document.images[0] && document.images[0].complete);
  return zeichen.screenshot({ omitBackground: !grund, type: 'png' });
}

const dateien = [
  ['assets/favicon/favicon-96x96.png', 96, null],
  ['assets/favicon/apple-touch-icon.png', 180, '#E9F9F1'],
  ['assets/favicon/web-app-manifest-192x192.png', 192, null],
  ['assets/favicon/web-app-manifest-512x512.png', 512, null]
];
for (const [pfad, groesse, grund] of dateien) {
  writeFileSync(ziel(pfad), await zeichne(groesse, grund));
  console.log(pfad.padEnd(46) + groesse + ' x ' + groesse);
}

/* favicon.ico mit drei PNG-Bildern. Seit Windows Vista und in jedem
   heutigen Browser darf ein ICO PNG statt Bitmaps tragen; das spart den
   Umweg ueber ein Bildprogramm. */
const bilder = [];
for (const groesse of [16, 32, 48]) { bilder.push({ groesse, png: await zeichne(groesse, null) }); }
const kopf = Buffer.alloc(6 + 16 * bilder.length);
kopf.writeUInt16LE(0, 0);
kopf.writeUInt16LE(1, 2);
kopf.writeUInt16LE(bilder.length, 4);
let versatz = kopf.length;
bilder.forEach((b, i) => {
  const o = 6 + 16 * i;
  kopf.writeUInt8(b.groesse, o);
  kopf.writeUInt8(b.groesse, o + 1);
  kopf.writeUInt8(0, o + 2);
  kopf.writeUInt8(0, o + 3);
  kopf.writeUInt16LE(1, o + 4);
  kopf.writeUInt16LE(32, o + 6);
  kopf.writeUInt32LE(b.png.length, o + 8);
  kopf.writeUInt32LE(versatz, o + 12);
  versatz += b.png.length;
});
writeFileSync(ziel('assets/favicon/favicon.ico'), Buffer.concat([kopf].concat(bilder.map(b => b.png))));
/* Die Kopie in der Wurzel: Browser und fremde Abholer fordern sie dort blind an. */
copyFileSync(ziel('assets/favicon/favicon.ico'), ziel('favicon.ico'));
console.log('assets/favicon/favicon.ico und favicon.ico     16, 32, 48');
/* favicon.svg ist die Bildmarke selbst. */
copyFileSync(ziel('assets/pics/logo.svg'), ziel('assets/favicon/favicon.svg'));
console.log('assets/favicon/favicon.svg                     aus logo.svg');

await br.close();
