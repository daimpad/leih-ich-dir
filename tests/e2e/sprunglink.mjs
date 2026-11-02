/*
 * Der Sprunglink ("Zum Inhalt springen") laesst die Adresse stehen.
 *
 * Er zielte auf #main, und ein Klick darauf schrieb #main ins Fragment.
 * Dort steht in einer Liste aber der Schluessel (#e=, #v=, #k=), und die
 * Adresse der Seite ist der Link, auf den der Satz zum Lesezeichen baut.
 * route() liess die offene Ansicht zwar stehen, die Adresse war aber
 * danach nur noch .../#main: Ein Lesezeichen darauf, ein Neuladen oder ein
 * Kopieren aus der Adressleiste fuehrte zur Startseite, ohne Liste. Seit
 * November 2026 setzt der Sprunglink nur die Fuehrung auf den Inhalt und
 * rollt dorthin, ohne das Fragment anzufassen; auf der Einstellungsseite
 * ebenso, dort traegt das Fragment denselben Schluessel.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neu() {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  return { ctx, p };
}

/** Springt ueber die Tastatur: Fuehrung auf den Sprunglink, dann Enter. */
async function springen(p) {
  await p.locator('.skiplink').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  return p.evaluate(() => ({
    adresse: location.href,
    fokus: !!document.activeElement && document.activeElement.id === 'main'
  }));
}

console.log('· Leihliste, Bearbeiten-Link');
let ansehen;
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  ansehen = await p.locator('#linkView').inputValue();
  const vorher = await p.evaluate(() => location.href);
  const nach = await springen(p);
  ok('die Adresse traegt danach noch den Schluessel', nach.adresse === vorher && /#e=/.test(nach.adresse), nach.adresse);
  ok('die Fuehrung steht auf dem Inhalt', nach.fokus);
  ok('die Liste bleibt offen', await p.locator('#viewList').isVisible());
  await p.keyboard.press('Tab');
  ok('der naechste Tabulator geht im Inhalt weiter',
     await p.evaluate(() => document.getElementById('main').contains(document.activeElement) && document.activeElement.id !== 'main'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  ok('und nach dem Neuladen ist sie wieder da', await p.locator('#viewList').isVisible());
  await ctx.close();
}

console.log('· Leihliste, Ansehen-Link');
{
  const { ctx, p } = await neu();
  await p.goto(ansehen, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  const nach = await springen(p);
  ok('die Adresse bleibt der Ansehen-Link', nach.adresse === ansehen, nach.adresse);
  ok('die Fuehrung steht auf dem Inhalt', nach.fokus);
  await ctx.close();
}

console.log('· Superliste');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  const vorher = await p.evaluate(() => location.href);
  const nach = await springen(p);
  ok('die Adresse traegt danach noch den Schluessel', nach.adresse === vorher && /#k=/.test(nach.adresse), nach.adresse);
  ok('die Superliste bleibt offen', await p.locator('#viewCircle').isVisible());
  await ctx.close();
}

console.log('· Einstellungen mit Schluessel im Fragment');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  const hash = await p.evaluate(() => location.hash);
  await p.goto(BASE + '/einstellungen.html' + hash, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const vorher = await p.evaluate(() => location.href);
  const nach = await springen(p);
  ok('die Adresse traegt danach noch den Schluessel', nach.adresse === vorher, nach.adresse);
  ok('die Fuehrung steht auf dem Inhalt', nach.fokus);
  await ctx.close();
}

console.log('· Startseite');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const nach = await springen(p);
  ok('die Fuehrung steht auf dem Inhalt', nach.fokus);
  ok('die Startseite bleibt', await p.locator('#viewStart').isVisible());
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
