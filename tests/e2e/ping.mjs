/*
 * Ein gescheiterter Ping schaltet nicht in den Vorschaumodus.
 *
 * Beim Start fragt app.js ?a=ping. Bis November 2026 genuegte ein einziger
 * gescheiterter Abruf, und leihichdir.de lief im Vorschaumodus weiter: Der
 * Streifen stand da, und eine neue Liste lag nur im localStorage dieses
 * Browsers. Ihre Links fuehrten bei Freund:innen ins Leere. Jetzt gilt der
 * Vorschaumodus nur, wo die Antwort eindeutig sagt, dass hier kein PHP
 * laeuft: 200, aber ohne die Kennung des Dienstes. Netzfehler, 404, 429
 * und 5xx sagen das nicht; dann gilt der Server.
 *
 * Nur der erste Ping wird gestoert, alle anderen Abrufe gehen durch. So
 * zeigt sich, wo die neue Liste landet: auf dem Server, nicht im Browser.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const PHP_ALS_TEXT = '<?php\ndeclare(strict_types=1);\n';

/**
 * Oeffnet die Startseite mit einem gestoerten ersten Ping und legt eine
 * Liste an. Liefert, was danach zu sehen ist und wo die Liste liegt.
 */
async function mitPing(stoerung) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  let gestoert = 0;
  await p.route('**/api.php?a=ping*', (r) => {
    if (gestoert++ > 0) { return r.continue(); }
    return stoerung(r);
  });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const streifen = await p.locator('#previewBanner').isVisible();
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(400);
  const id = await p.evaluate(() => (location.hash.match(/^#e=([0-9a-f]{32})\./) || [])[1] || null);
  const imBrowser = await p.evaluate((i) => !!localStorage.getItem('lid.' + i), id);
  const abzeichen = await p.locator('#storageBadge').isVisible();
  await ctx.close();
  const res = id ? await fetch(BASE + '/api.php?a=read&id=' + id) : null;
  return { streifen, abzeichen, imBrowser, aufDemServer: !!res && res.status === 200, gestoert };
}

const faelle = [
  ['abgebrochen', (r) => r.abort('failed')],
  ['Zeitueberschreitung der Verbindung', (r) => r.abort('timedout')],
  ['503', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"busy"}' })],
  ['502 als HTML', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>' })],
  ['429', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"ratelimit"}' })],
  ['404', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' })]
];

for (const [name, stoerung] of faelle) {
  console.log('· Ping ' + name);
  const e = await mitPing(stoerung);
  ok('der Ping wurde gestoert', e.gestoert >= 1);
  ok('kein Vorschau-Streifen', !e.streifen);
  ok('kein Abzeichen "lokal"', !e.abzeichen);
  ok('die neue Liste liegt auf dem Server', e.aufDemServer);
  ok('und nicht im Browser', !e.imBrowser);
}

/* Die Gegenseite: Wo api.php als Text kommt (ein Server ohne PHP) oder
   eine andere JSON-Antwort ohne Kennung, bleibt der Vorschaumodus. */
for (const [name, stoerung] of [
  ['200 als PHP-Quelltext', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: PHP_ALS_TEXT })],
  ['200 als JSON ohne Kennung', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })]
]) {
  console.log('· Ping ' + name);
  const e = await mitPing(stoerung);
  ok('der Vorschau-Streifen steht da', e.streifen);
  ok('das Abzeichen "lokal" steht da', e.abzeichen);
  ok('die neue Liste liegt im Browser', e.imBrowser);
  ok('und nicht auf dem Server', !e.aufDemServer);
}

console.log('· Ping wie immer');
{
  const e = await mitPing((r) => r.continue());
  ok('kein Vorschau-Streifen', !e.streifen);
  ok('die neue Liste liegt auf dem Server', e.aufDemServer);
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
