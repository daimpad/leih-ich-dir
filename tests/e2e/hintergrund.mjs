/*
 * Bearbeiten, wenn die Seite in den Hintergrund geht und zurueckkommt.
 *
 * Bis November 2026 schrieb die Seite beim Verbergen nicht sofort, sondern
 * erst nach SAVE_DEBOUNCE; auf dem Handy beendet der Browser einen Tab im
 * Hintergrund oft vorher. Und kehrte sie zurueck, holte nur der
 * Ansehen-Modus den Stand des Servers. Ein Bearbeiten-Fenster, das eine
 * Weile im Hintergrund lag, waehrend die Liste auf dem Handy wuchs, zeigte
 * den alten Stand und schrieb ihn beim naechsten Tippen darueber.
 *
 * Verbergen und Zurueckkehren stellt die Suite nach, indem sie
 * document.hidden umstellt und visibilitychange ausloest; Playwright kennt
 * dafuer keinen eigenen Weg.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neu() {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); }
    let verborgen = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => verborgen });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (verborgen ? 'hidden' : 'visible') });
    window.__sichtbar = (ja) => { verborgen = !ja; document.dispatchEvent(new Event('visibilitychange')); };
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  const schreiben = [];
  p.on('request', (r) => {
    if (r.method() === 'POST' && (r.postData() || '').includes('"a":"write"')) { schreiben.push(Date.now()); }
  });
  return { ctx, p, schreiben };
}

const anzeige = (p) => p.locator('#saveState').evaluate((n) => n.textContent.trim());
const titel = (p) => p.locator('#listTitleInput').inputValue();
async function gespeichert(p) {
  const ende = Date.now() + 8000;
  while (Date.now() < ende) {
    if (await anzeige(p) === 'Gespeichert') { return true; }
    await p.waitForTimeout(150);
  }
  return false;
}

console.log('· Verbergen schreibt sofort');
let link;
{
  const { ctx, p, schreiben } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(400);
  link = await p.evaluate(() => location.href);
  const vorher = schreiben.length;
  await p.locator('#listTitleInput').fill('Vor dem Verbergen');
  const getippt = Date.now();
  await p.evaluate(() => window.__sichtbar(false));
  await p.waitForTimeout(300);
  ok('der Schreibvorgang beginnt vor Ablauf der Verzoegerung',
     schreiben.length > vorher && schreiben[vorher] - getippt < 500, String(schreiben.length > vorher ? schreiben[vorher] - getippt : 'keiner'));
  await p.evaluate(() => window.__sichtbar(true));
  ok('und kommt an', await gespeichert(p), await anzeige(p));
  await ctx.close();
}

console.log('· Zurueckkehren holt den neuen Stand');
{
  const a = await neu();
  const b = await neu();
  await a.p.goto(link, { waitUntil: 'networkidle' });
  await a.p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await a.p.evaluate(() => window.__sichtbar(false));
  await b.p.goto(link, { waitUntil: 'networkidle' });
  await b.p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await b.p.locator('#listTitleInput').fill('Vom Handy');
  ok('das andere Fenster speichert', await gespeichert(b.p), await anzeige(b.p));
  await a.p.evaluate(() => window.__sichtbar(true));
  await a.p.waitForTimeout(1500);
  ok('dieses Fenster zeigt danach den neuen Stand', await titel(a.p) === 'Vom Handy', await titel(a.p));
  const hinweis = await a.p.locator('#toastText').evaluate((n) => n.textContent.trim());
  ok('und sagt es', /anderswo geändert/.test(hinweis), hinweis);

  console.log('· Mit offenen Aenderungen bleibt der eigene Stand');
  await b.p.locator('#listTitleInput').fill('Wieder vom Handy');
  ok('das andere Fenster speichert erneut', await gespeichert(b.p), await anzeige(b.p));
  await a.p.evaluate(() => window.__sichtbar(false));
  await a.p.waitForTimeout(1000);
  /* Getippt, solange die Seite als verborgen gilt und ohne dass es schon
     geschrieben ist: offen. */
  await a.p.evaluate(() => {
    const feld = document.getElementById('listTitleInput');
    feld.value = 'Hier getippt';
    feld.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await a.p.evaluate(() => window.__sichtbar(true));
  await a.p.waitForTimeout(300);
  ok('das Getippte wird nicht vom Serverstand ersetzt', await titel(a.p) === 'Hier getippt', await titel(a.p));
  await a.ctx.close();
  await b.ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
