/*
 * Zwei Fenster aendern dieselbe Liste, und nichts geht verloren.
 *
 * Bis November 2026 schrieb save() bei 409 den eigenen Stand ueber den des
 * Servers: Was das andere Geraet geaendert hatte, war fort, und die Meldung
 * sagte "Dein Stand wurde übernommen". Jetzt holt save() die Fassung des
 * Servers und fuehrt sie mit der eigenen zusammen (zusammenfuehren in
 * app.js): je Feld, ueber die Eintrags-IDs; wo sich beide widersprechen,
 * gilt die eigene; ein Eintrag, der auf einer Seite geaendert und auf der
 * anderen geloescht wurde, bleibt.
 *
 * Fenster A haelt seine Schreibanfragen zurueck, bis B fertig ist; so sammelt
 * es alle Aenderungen und trifft mit dem ersten Schreiben auf 409.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function fenster() {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  return { ctx, p };
}
const anzeige = (p) => p.locator('#saveState').evaluate((n) => n.textContent.trim());
async function gespeichert(p, ms = 10000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (await anzeige(p) === 'Gespeichert') { return true; }
    await p.waitForTimeout(150);
  }
  return false;
}
async function eintragen(p, text) {
  await p.locator('#btnBulk').click();
  await p.locator('#voiceText').fill(text);
  await p.locator('#btnVoiceApply').click();
  await p.waitForTimeout(600);
}
/** Oeffnet den Eintrag mit diesem Namen. */
async function oeffnen(p, name) {
  await p.locator('#itemList .item').filter({ has: p.locator('.item-name', { hasText: new RegExp('^' + name + '$') }) })
    .locator('[data-act="open"]').click();
  await p.waitForSelector('#mdName', { timeout: 5000 });
}
async function umbenennen(p, alt, neu) {
  await oeffnen(p, alt);
  await p.locator('#mdName').fill(neu);
  await p.locator('#modalClose').click();
  await p.waitForTimeout(200);
}
async function notieren(p, name, notiz) {
  await oeffnen(p, name);
  await p.locator('#mdNote').fill(notiz);
  await p.locator('#modalClose').click();
  await p.waitForTimeout(200);
}
async function loeschen(p, name) {
  await oeffnen(p, name);
  await p.locator('#modalFoot .btn--danger').click();
  await p.waitForTimeout(300);
}
const namen = (p) => p.locator('#itemList .item .item-name').evaluateAll((n) => n.map((x) => x.textContent.trim()));

console.log('· Anlegen');
const a = await fenster();
await a.p.goto(BASE + '/', { waitUntil: 'networkidle' });
await a.p.locator('#btnCreate').click();
await a.p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await a.p.locator('#chkKeyDone').check();
await eintragen(a.p, 'Zelt, Leiter, Bohrer und Waffeleisen');
ok('vier Eintraege, gespeichert', (await namen(a.p)).length === 4 && await gespeichert(a.p), (await namen(a.p)).join(', '));
const link = await a.p.evaluate(() => location.href);

console.log('· B aendert zuerst');
const b = await fenster();
await b.p.goto(link, { waitUntil: 'networkidle' });
await b.p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await b.p.locator('#listTitleInput').fill('Titel von B');
await eintragen(b.p, 'Kamera');
await umbenennen(b.p, 'Leiter', 'Leiter von B');
await loeschen(b.p, 'Bohrer');
ok('B ist gespeichert', await gespeichert(b.p), await anzeige(b.p));

console.log('· A aendert, ohne B gesehen zu haben');
let freigabe;
const gehalten = new Promise((r) => { freigabe = r; });
await a.p.route('**/api.php', async (route) => {
  if (route.request().method() === 'POST' && (route.request().postData() || '').includes('"a":"write"')) { await gehalten; }
  return route.continue();
});
await eintragen(a.p, 'Schlafsack');
await umbenennen(a.p, 'Leiter', 'Leiter von A');
await notieren(a.p, 'Bohrer', 'Akku fehlt');
await loeschen(a.p, 'Waffeleisen');
freigabe();
ok('A ist gespeichert', await gespeichert(a.p, 15000), await anzeige(a.p));
const hinweis = await a.p.locator('#toastText').evaluate((n) => n.textContent.replace(/\s+/g, ' ').trim());
ok('und sagt, dass zusammengefuehrt wurde und wo seins gilt', /zusammengeführt; wo sich Änderungen widersprachen, gilt Deine/.test(hinweis), hinweis);

console.log('· Was danach auf dem Server steht');
const c = await fenster();
await c.p.goto(link, { waitUntil: 'networkidle' });
await c.p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
const liste = await namen(c.p);
const titel = await c.p.locator('#listTitleInput').inputValue();
ok('der Titel von B, denn A hatte ihn nicht geaendert', titel === 'Titel von B', titel);
ok('der neue Eintrag von B', liste.includes('Kamera'), liste.join(', '));
ok('der neue Eintrag von A', liste.includes('Schlafsack'), liste.join(', '));
ok('beim Widerspruch der Name von A', liste.includes('Leiter von A') && !liste.includes('Leiter von B'), liste.join(', '));
ok('der von B geloeschte, von A geaenderte Eintrag bleibt', liste.includes('Bohrer'), liste.join(', '));
ok('mit der Notiz von A', await c.p.locator('#itemList .item').filter({ hasText: 'Bohrer' }).locator('.item-note').textContent().catch(() => '') === 'Akku fehlt');
ok('der von A geloeschte, sonst unveraenderte bleibt geloescht', !liste.includes('Waffeleisen'), liste.join(', '));
ok('Zelt bleibt', liste.includes('Zelt'), liste.join(', '));
ok('A zeigt dasselbe', JSON.stringify((await namen(a.p)).slice().sort()) === JSON.stringify(liste.slice().sort()), (await namen(a.p)).join(', '));

console.log('· Ohne Widerspruch ein schlichterer Hinweis');
await b.p.reload({ waitUntil: 'networkidle' });
await b.p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await eintragen(b.p, 'Beamer');
ok('B ist gespeichert', await gespeichert(b.p), await anzeige(b.p));
await eintragen(c.p, 'Grill');
ok('C ist gespeichert', await gespeichert(c.p), await anzeige(c.p));
const schlicht = await c.p.locator('#toastText').evaluate((n) => n.textContent.replace(/\s+/g, ' ').trim());
ok('der Hinweis nennt nur das Zusammenfuehren', schlicht === 'Die Liste wurde parallel geändert. Beide Stände sind zusammengeführt.', schlicht);
const zuletzt = await namen(c.p);
ok('und beide neuen Eintraege stehen da', zuletzt.includes('Beamer') && zuletzt.includes('Grill'), zuletzt.join(', '));

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
