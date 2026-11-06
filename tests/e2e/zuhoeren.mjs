/*
 * Was die Zeile unter dem Feld zeigt, solange das Mikrofon zuhoert.
 *
 * Bis November 2026 stand vor "Hört zu …" ein Punkt (statusDot), fuer den
 * style.css nie eine Regel hatte: ein leeres span ohne Text und ohne
 * Gestalt. Jetzt steht dort nur der Text, und den Zustand zeigt der Knopf.
 * Ebenso ohne Regel war voicestate-error: Ein Fehler stand gruen da wie
 * "Hört zu". Jetzt mahnt er in Butter (--warn-ink), hell und dunkel.
 *
 * Die Spracherkennung des Browsers wird nachgebaut: Chromium ohne Kopf hat
 * keine, und ein echtes Mikrofon gibt es hier nicht. Der Nachbau kann nur
 * starten, enden und ein Ergebnis melden; mehr braucht der Weg nicht.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); }
  function Nachbau() { window.__erkennung = this; }
  Nachbau.prototype.start = function () { this.laeuft = true; };
  Nachbau.prototype.stop = function () {
    this.laeuft = false;
    const self = this;
    setTimeout(() => { if (self.onend) { self.onend(); } }, 0);
  };
  Nachbau.prototype.abort = Nachbau.prototype.stop;
  window.SpeechRecognition = Nachbau;
});
const p = await ctx.newPage();
p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.locator('#btnCreate').click();
await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(400);

const zeile = () => p.evaluate(() => {
  const n = document.querySelector('#voiceState');
  const b = document.querySelector('#btnMic');
  return {
    text: n.textContent,
    kinder: n.children.length,
    leere: Array.from(n.querySelectorAll('*')).filter((e) => !e.textContent.trim()).length,
    klasse: n.className,
    gedrueckt: b.getAttribute('aria-pressed'),
  };
});

console.log('· Zuhoeren');
ok('der Mikrofonknopf ist zu sehen', await p.locator('#btnMic').isVisible());
await p.locator('#btnMic').click();
await p.waitForTimeout(200);
let z = await zeile();
ok('die Erkennung laeuft', await p.evaluate(() => !!(window.__erkennung && window.__erkennung.laeuft)));
ok('"Hört zu …" steht in der Zeile', z.text === 'Hört zu …', JSON.stringify(z));
ok('kein leeres Element davor', z.leere === 0, JSON.stringify(z));
ok('nur Text, kein Element', z.kinder === 0, JSON.stringify(z));
ok('die Zeile traegt ihre Klassen', z.klasse === 'tag voicestate', z.klasse);
ok('der Knopf ist gedrueckt', z.gedrueckt === 'true', JSON.stringify(z));

console.log('· Wieder aus');
await p.locator('#btnMic').click();
await p.waitForTimeout(200);
z = await zeile();
ok('die Zeile ist leer', z.text === '' && z.kinder === 0, JSON.stringify(z));
ok('der Knopf ist nicht mehr gedrueckt', z.gedrueckt === 'false', JSON.stringify(z));

console.log('· Englisch');
await p.locator('#btnLang').click();
await p.waitForTimeout(200);
await p.locator('#btnMic').click();
await p.waitForTimeout(200);
z = await zeile();
ok('"Listening …"', z.text === 'Listening …', JSON.stringify(z));
await p.locator('#btnMic').click();
await p.waitForTimeout(200);

console.log('· Fehler mahnen in Butter');
/* Farbe eines Merkmals, so wie der Browser sie fuer color ausrechnet. */
const merkmal = (pg, name) => pg.evaluate((n) => {
  const d = document.createElement('div');
  d.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  document.body.appendChild(d);
  const c = getComputedStyle(d).color; d.remove(); return c;
}, name);
const farbeDerZeile = (pg) => pg.evaluate(() => getComputedStyle(document.querySelector('#voiceState')).color);

for (const schema of ['light', 'dark']) {
  const c2 = await br.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: schema });
  await c2.addInitScript(() => {
    localStorage.setItem('lid.lang', 'de');
    function Nachbau() { window.__erkennung = this; }
    Nachbau.prototype.start = function () {};
    Nachbau.prototype.stop = function () {};
    window.SpeechRecognition = Nachbau;
  });
  const q = await c2.newPage();
  q.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  await q.goto(BASE + '/?d=' + schema, { waitUntil: 'networkidle' });
  await q.locator('#btnCreate').click();
  await q.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await q.waitForTimeout(400);
  await q.locator('#btnMic').click();
  await q.waitForTimeout(150);
  const gruen = await merkmal(q, '--link');
  const butter = await merkmal(q, '--warn-ink');
  ok(schema + ': "Hört zu …" in --link', (await farbeDerZeile(q)) === gruen, await farbeDerZeile(q));
  await q.evaluate(() => window.__erkennung.onerror({ error: 'not-allowed' }));
  await q.waitForTimeout(150);
  const z2 = await q.evaluate(() => ({ text: document.querySelector('#voiceState').textContent,
    klasse: document.querySelector('#voiceState').className }));
  ok(schema + ': die Ablehnung wird gemeldet', z2.text === 'Zugriff auf das Mikrofon wurde abgelehnt.' && /voicestate-error/.test(z2.klasse), JSON.stringify(z2));
  ok(schema + ': und zwar in --warn-ink', (await farbeDerZeile(q)) === butter, (await farbeDerZeile(q)) + ' statt ' + butter);
  ok(schema + ': nicht mehr in --link', (await farbeDerZeile(q)) !== gruen, await farbeDerZeile(q));
  await c2.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
