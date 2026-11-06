/*
 * Speichern, wenn das Netz nicht mitspielt.
 *
 * Bis November 2026 hatte kein Abruf eine Frist: Antwortete der Server
 * nicht, stand "Speichere …" fuer immer neben dem Titel, und jedes weitere
 * Speichern wartete dahinter. Und nach einem Fehler kam ein neuer Versuch
 * erst mit der naechsten Aenderung; wer nichts mehr tippte, behielt einen
 * ungespeicherten Stand, ohne es zu merken. Jetzt endet jeder Abruf nach
 * API_TIMEOUT, ein voruebergehender Fehler fuehrt zu weiteren Versuchen in
 * wachsendem Abstand (SAVE_RETRY), sofort auch, wenn das Geraet wieder
 * online ist, und die Anzeige sagt, dass gewartet wird. Ein endgueltiger
 * Fehler wie 403 wird nicht wiederholt.
 *
 * Der Server wird ueber page.route gestellt: Schreibanfragen haengen, fallen
 * aus oder gehen durch, wie die Welt es verlangt.
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
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(400);
  /* welt.art: 'durch' | 'haengen' | 'ausfall' | 'verboten'; gezaehlt wird
     jeder Schreibversuch. */
  const welt = { art: 'durch', schreiben: 0 };
  await p.route('**/api.php', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST' || !(req.postData() || '').includes('"a":"write"')) { return route.continue(); }
    welt.schreiben++;
    if (welt.art === 'haengen') { return; }
    if (welt.art === 'ausfall') { return route.abort('connectionreset'); }
    if (welt.art === 'verboten') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"forbidden"}' });
    }
    return route.continue();
  });
  return { ctx, p, welt };
}

const anzeige = (p) => p.locator('#saveState').evaluate((n) => n.textContent.trim());
async function aendern(p, text) {
  await p.locator('#listTitleInput').fill(text);
}
async function warteAuf(p, text, ms) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (await anzeige(p) === text) { return true; }
    await p.waitForTimeout(200);
  }
  return false;
}

console.log('· Der Server antwortet nicht');
{
  const { ctx, p, welt } = await neu();
  welt.art = 'haengen';
  await aendern(p, 'Haengt');
  await p.waitForTimeout(19000);
  const nach = await anzeige(p);
  ok('nach der Frist steht nicht mehr "Speichere …"', nach !== 'Speichere …', nach);
  ok('sondern dass gewartet wird', nach === 'Wartet auf den Server', nach);
  welt.art = 'durch';
  await p.waitForTimeout(1000);
  ok('auch waehrend des naechsten Versuchs', await anzeige(p) === 'Wartet auf den Server', await anzeige(p));
  /* Der laufende Versuch haengt weiter bis zu seiner Frist, erst der danach
     geht durch. */
  ok('und sobald er antwortet, ist gespeichert, ohne weiteres Tippen', await warteAuf(p, 'Gespeichert', 25000), await anzeige(p));
  await ctx.close();
}

console.log('· Der Server faellt kurz aus');
{
  const { ctx, p, welt } = await neu();
  welt.art = 'ausfall';
  await aendern(p, 'Faellt aus');
  ok('die Anzeige sagt, dass gewartet wird', await warteAuf(p, 'Wartet auf den Server', 4000), await anzeige(p));
  const hinweis = (await p.locator('#toastText').textContent()).replace(/\s+/g, ' ').trim();
  ok('ein Hinweis sagt, was das heisst', /Lass diese Seite offen/.test(hinweis), hinweis);
  await p.waitForTimeout(2600);
  const versuche = welt.schreiben;
  ok('es wird von selbst erneut versucht', versuche >= 2, String(versuche));
  welt.art = 'durch';
  ok('und dann gespeichert, ohne weiteres Tippen', await warteAuf(p, 'Gespeichert', 12000), await anzeige(p));
  await ctx.close();
}

console.log('· Das Geraet ist wieder online');
{
  const { ctx, p, welt } = await neu();
  welt.art = 'ausfall';
  await aendern(p, 'Offline');
  /* Zwei Fehlschlaege, danach wartet der naechste Versuch mehrere Sekunden. */
  const ende = Date.now() + 10000;
  while (welt.schreiben < 2 && Date.now() < ende) { await p.waitForTimeout(100); }
  await p.waitForTimeout(200);
  welt.art = 'durch';
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('gespeichert wird sofort, nicht erst beim naechsten Versuch', await warteAuf(p, 'Gespeichert', 1500), await anzeige(p));
  await ctx.close();
}

console.log('· Ein endgueltiger Fehler');
{
  const { ctx, p, welt } = await neu();
  welt.art = 'verboten';
  await aendern(p, 'Verboten');
  ok('die Anzeige sagt, dass es fehlgeschlagen ist', await warteAuf(p, 'Speichern fehlgeschlagen', 4000), await anzeige(p));
  const vorher = welt.schreiben;
  await p.waitForTimeout(6000);
  ok('und wiederholt nicht', welt.schreiben === vorher, vorher + ' → ' + welt.schreiben);
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
