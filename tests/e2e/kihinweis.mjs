/*
 * Wohin der Text zum Zerlegen geht, und was die Hinweise darueber sagen.
 *
 * Seit November 2026 ist der KI-Proxy des Servers ausgeschaltet
 * (AI_PROXY_ENABLED, api.php). Ohne eigenen Schluessel zerlegt der Browser
 * den Text selbst und schickt nichts weg, auch nicht unter "Mehrere auf
 * einmal". Mit eigenem Schluessel geht der Text vom Browser direkt an
 * Google, nie ueber diesen Server. Waere der Proxy an, nennen die Hinweise
 * Google; vorher sagten sie nur "der Server dieser Anwendung".
 *
 * Dazu der Satz unter dem Ansehen-Link: Bis November 2026 hiess es dort
 * "Diesen Link geben Deine Freunde weiter", gemeint war das Gegenteil.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neu(speicher, proxyAn) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('__gesetzt')) { return; }
    Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
    sessionStorage.setItem('__gesetzt', '1');
  }, Object.assign({ 'lid.lang': 'de' }, speicher || {}));
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  const wege = { server: [], google: [] };
  await p.route('**/api.php**', async (route) => {
    const req = route.request();
    const body = req.postData() || '';
    if (body.includes('"a":"ai"')) { wege.server.push(body); }
    if (proxyAn && req.url().includes('a=ping')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, service: 'leih-katalog', version: '1.1.0', maxPayload: 524288, aiProxy: true }) });
    }
    return route.continue();
  });
  await p.route('https://generativelanguage.googleapis.com/**', async (route) => {
    wege.google.push(route.request().postData() || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify([{ item: 'Zelt', status: 'available' }, { item: 'Leiter', status: 'available' }]) }] } }] }) });
  });
  return { ctx, p, wege };
}

async function anlegen(p) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.locator('#chkKeyDone').check();
  await p.waitForTimeout(300);
}

async function sammeln(p, text) {
  await p.locator('#btnBulk').click();
  await p.locator('#voiceText').fill(text);
  await p.locator('#btnVoiceApply').click();
  await p.waitForTimeout(1500);
}

const zeilen = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#itemList .item')).length);

console.log('· Ohne Schluessel, Proxy aus');
{
  const { ctx, p, wege } = await neu();
  await anlegen(p);
  await sammeln(p, 'Zelt und Leiter');
  ok('der Browser zerlegt selbst', await zeilen(p) === 2, String(await zeilen(p)));
  ok('und schickt den Text nirgendwohin', wege.server.length === 0 && wege.google.length === 0, JSON.stringify(wege));
  ok('unter dem Feld steht kein Hinweis', await p.locator('#voiceHint').isHidden());

  await p.locator('#schrittTab3').click();
  await p.locator('#shareBox [data-hinweise]').click();
  const hinweis = (await p.locator('#shareBox [data-i18n="share.viewHint"]').textContent()).replace(/\s+/g, ' ').trim();
  ok('unter dem Ansehen-Link: Du gibst ihn weiter', hinweis === 'Diesen Link gibst Du Deinen Freund:innen. Er zeigt die Liste, ändern lässt sich damit nichts.', hinweis);

  await p.goto(BASE + '/einstellungen.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const ki = (await p.locator('[data-i18n="settings.aiHint"]').textContent()).replace(/\s+/g, ' ').trim();
  ok('die Einstellungen sagen, wohin der Text mit eigenem Schluessel geht', /an Google/.test(ki) && /Mehrere auf einmal/.test(ki), ki);
  ok('und kein Hinweis auf einen Server-Weg', await p.locator('#aiProxyNote').isHidden());
  await ctx.close();
}

console.log('· Mit eigenem Schluessel');
{
  const { ctx, p, wege } = await neu({ 'lid.aikey': 'AIzaNurFuerDenTest' });
  await anlegen(p);
  await p.locator('#btnBulk').click();
  ok('im offenen Kasten nennt der Hinweis Google', /Google/.test(await p.locator('#voiceHint').textContent()) && await p.locator('#voiceHint').isVisible(),
     await p.locator('#voiceHint').textContent());
  await p.locator('#btnBulk').click();
  await sammeln(p, 'Zelt und Leiter');
  ok('auch Getipptes geht an Gemini', wege.google.length === 1 && wege.google[0].includes('Zelt und Leiter'), JSON.stringify(wege.google).slice(0, 120));
  ok('direkt vom Browser, nicht ueber den Server', wege.server.length === 0, String(wege.server.length));
  ok('und landet als zwei Eintraege', await zeilen(p) === 2, String(await zeilen(p)));
  await ctx.close();
}

console.log('· Waere der Proxy an');
{
  const { ctx, p } = await neu({}, true);
  await anlegen(p);
  const unter = await p.locator('#voiceHint').textContent();
  ok('nennt der Hinweis unter dem Feld Google', /Google/.test(unter), unter);
  await p.goto(BASE + '/einstellungen.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const note = await p.locator('#aiProxyNote').textContent();
  ok('und in den Einstellungen ebenso', await p.locator('#aiProxyNote').isVisible() && /Google/.test(note), note);
  await p.locator('#btnLang').click();
  await p.waitForTimeout(300);
  ok('auch auf Englisch', /Google/.test(await p.locator('#aiProxyNote').textContent()));
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
