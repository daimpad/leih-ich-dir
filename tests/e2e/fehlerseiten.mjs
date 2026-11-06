/*
 * Die Fehlerseite nennt die Ursache und laesst eine tote Liste los.
 *
 * Bis November 2026 hiess fast jeder Fehler "Der Server ist gerade nicht
 * erreichbar.", auch eine auf dem Server beschaedigte Liste (500 corrupt),
 * und die Drosselung beim Lesen sagte "Zu viele neue Listen in kurzer
 * Zeit." zu jemandem, der nur einen Ansehen-Link oeffnete. Eine geloeschte
 * Liste blieb unter "Auf diesem Geraet gemerkt" stehen; die Fehlerseite
 * bot nur "Zur Startseite", und dort stand sie wieder.
 *
 * Gestoert wird die Antwort des Servers ueber page.route, die Liste selbst
 * entsteht echt. So bleibt der Datenordner unberuehrt, und die Drosselung
 * muss niemand wirklich ausloesen.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
const p = await ctx.newPage();
p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));

/* Eine eigene Liste, damit sie unter "Auf diesem Geraet gemerkt" steht. */
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.locator('#btnCreate').click();
await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(400);
const hash = await p.evaluate(() => location.hash);
const id = hash.match(/^#e=([0-9a-f]{32})\./)[1];
const ansehen = await p.locator('#linkView').inputValue();
const gemerkt = () => p.evaluate((i) => JSON.parse(localStorage.getItem('lid.mine') || '[]').some((e) => e.id === i), id);
ok('die Liste ist gemerkt', await gemerkt());

let antwort = null;
await p.route('**/api.php?a=read*', (r) => antwort ? r.fulfill(antwort) : r.continue());

/** Oeffnet einen Link mit gestoerter Leseantwort und liefert, was dasteht. */
async function oeffne(link, stoerung, zusatz) {
  antwort = stoerung;
  await p.goto(BASE + '/?n=' + zusatz + link.slice(link.indexOf('#')), { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewError:not([hidden])', { timeout: 10000 });
  await p.waitForTimeout(200);
  return {
    text: (await p.locator('#errorText').textContent()).trim(),
    knopf: await p.locator('#btnForget').isVisible()
  };
}

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

console.log('· Beschaedigt (500 corrupt)');
{
  const e = await oeffne(hash, json(500, { error: 'corrupt' }), 1);
  ok('nennt die Beschaedigung', /beschädigt/.test(e.text), e.text);
  ok('nicht "nicht erreichbar"', !/nicht erreichbar/.test(e.text));
  ok('bietet das Entfernen an', e.knopf);
}

console.log('· Drosselung beim Lesen (429 ratelimit)');
{
  const e = await oeffne(ansehen, json(429, { error: 'ratelimit' }), 2);
  ok('spricht von Abrufen', /Zu viele Abrufe/.test(e.text), e.text);
  ok('nicht von neuen Listen', !/neue Listen/.test(e.text));
  ok('kein Entfernen, die Liste lebt', !e.knopf);
}

console.log('· Netzfehler (503 busy)');
{
  const e = await oeffne(hash, json(503, { error: 'busy' }), 3);
  ok('bleibt "nicht erreichbar"', /nicht erreichbar/.test(e.text), e.text);
  ok('kein Entfernen, die Liste lebt', !e.knopf);
}

console.log('· Fremde, nicht gemerkte Liste (404)');
{
  const fremd = '#v=' + 'b'.repeat(32) + '.' + 'A'.repeat(43);
  const e = await oeffne(BASE + '/' + fremd, json(404, { error: 'notfound' }), 4);
  ok('sagt, dass es sie nicht gibt', /gibt es nicht/.test(e.text), e.text);
  ok('kein Entfernen, sie war nie gemerkt', !e.knopf);
}

console.log('· Geloeschte eigene Liste (404)');
{
  const e = await oeffne(hash, json(404, { error: 'notfound' }), 5);
  ok('sagt, dass es sie nicht gibt', /gibt es nicht/.test(e.text), e.text);
  ok('bietet das Entfernen an', e.knopf);
  /* Der Ansehen-Link derselben Liste: auch dann ist es diese Liste. */
  const v = await oeffne(ansehen, json(404, { error: 'notfound' }), 6);
  ok('auch ueber den Ansehen-Link', v.knopf);

  await p.locator('#btnForget').click();
  await p.waitForSelector('#viewStart:not([hidden])', { timeout: 5000 });
  await p.waitForTimeout(300);
  ok('danach die Startseite', await p.locator('#viewStart').isVisible());
  ok('ohne Fragment', await p.evaluate(() => location.hash === ''));
  ok('die Liste ist nicht mehr gemerkt', !(await gemerkt()));
  ok('die Meldung sagt es', /nicht mehr auf diesem Gerät/.test(await p.locator('#toastText').textContent()));
  await p.locator('#toastAct').click();
  await p.waitForTimeout(300);
  ok('Rueckgaengig stellt sie zurueck', await gemerkt());
  ok('und sie steht wieder im Kasten', (await p.locator('#mineList li').count()) >= 1);
}

console.log('· Englisch');
{
  await p.evaluate(() => localStorage.setItem('lid.lang', 'en'));
  const e = await oeffne(hash, json(500, { error: 'corrupt' }), 7);
  ok('englischer Satz', /damaged on the server/.test(e.text), e.text);
  ok('englischer Knopf', /Remove from this device/.test(await p.locator('#btnForget').textContent()));
  await p.evaluate(() => localStorage.setItem('lid.lang', 'de'));
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
