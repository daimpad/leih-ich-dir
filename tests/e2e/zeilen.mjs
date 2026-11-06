/*
 * Die Zeilen einer Liste liegen flach auf ihrer Karte.
 *
 * Bis November 2026 war jede Zeile ein eigenes Stueck Knete mit Schatten,
 * auf einer Karte, die selbst Knete ist. Jetzt traegt die Zeile nur ihren
 * Inhalt, getrennt durch eine Linie; die Knete bleibt an Karte und
 * Zustandsmarke. "Details ergaenzen" steht nicht mehr sichtbar in jeder
 * Zeile, und eine verliehene Zeile liegt beim Ansehen nicht mehr in der
 * minzgruenen Mulde, denn Minze heisst hier "frei".
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neu(breite, thema) {
  const ctx = await br.newContext({ viewport: { width: breite, height: 900 } });
  await ctx.addInitScript((th) => {
    if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); }
    if (th) { localStorage.setItem('lid.theme', th); }
  }, thema || null);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  return { ctx, p };
}

/** Wie die Zeilen gezeichnet sind: Schatten, Linie, Grund, Rundung. */
const zeilen = (p, liste) => p.evaluate((sel) => Array.from(document.querySelectorAll(sel + ' > li > .itemrow')).map((z) => {
  const s = getComputedStyle(z);
  return { schatten: s.boxShadow, linie: s.borderBottomWidth, grund: s.backgroundImage + '|' + s.backgroundColor };
}), liste);
const marke = (p) => p.locator('#itemList .item-badge').first().evaluate((n) => getComputedStyle(n).boxShadow);

console.log('· Bearbeiten');
const { ctx, p } = await neu(390);
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.locator('#btnCreate').click();
await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await p.locator('#chkKeyDone').check();
await p.locator('#btnBulk').click();
await p.locator('#voiceText').fill('Zelt, Leiter und Bohrer');
await p.locator('#btnVoiceApply').click();
await p.waitForTimeout(800);
/* Die Leiter verleihen. */
await p.locator('#itemList .item').filter({ hasText: 'Leiter' }).locator('[data-act="open"]').click();
await p.locator('#modalBody .seg button').nth(1).click();
await p.locator('#modalClose').click();
await p.waitForTimeout(1500);
let z = await zeilen(p, '#itemList');
ok('drei Zeilen', z.length === 3, String(z.length));
ok('keine Zeile wirft einen Schatten', z.every((r) => r.schatten === 'none'), z.map((r) => r.schatten).join(' | '));
ok('getrennt durch eine Linie, die letzte ohne', z.slice(0, -1).every((r) => r.linie === '1px') && z[z.length - 1].linie === '0px', z.map((r) => r.linie).join(','));
ok('ohne eigene Flaeche', z.every((r) => r.grund === 'none|rgba(0, 0, 0, 0)'), z.map((r) => r.grund).join(' | '));
ok('die Zustandsmarke bleibt Knete', (await marke(p)) !== 'none');
ok('"Details ergaenzen" ist nicht zu sehen', await p.locator('#itemList .item-more').first().evaluate((n) => n.getBoundingClientRect().width <= 1));
ok('kein Ueberlauf bei 390', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.locator('#schrittTab3').click();
const ansehen = await p.locator('#linkView').inputValue();
await ctx.close();

console.log('· Ansehen');
{
  const { ctx, p } = await neu(390);
  await p.goto(ansehen, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(400);
  const z = await zeilen(p, '#itemList');
  ok('keine Zeile wirft einen Schatten, auch nicht die verliehene', z.length === 3 && z.every((r) => r.schatten === 'none'), z.map((r) => r.schatten).join(' | '));
  const verliehen = await p.locator('#itemList .item--lent > .itemrow').evaluate((n) => getComputedStyle(n).backgroundColor);
  ok('die verliehene Zeile liegt nicht in der minzgruenen Mulde', verliehen === 'rgba(0, 0, 0, 0)', verliehen);
  await ctx.close();
}

console.log('· Dunkel und schmal');
for (const breite of [320, 820]) {
  const { ctx, p } = await neu(breite, 'dark');
  await p.goto(ansehen, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  const farbe = await p.evaluate(() => {
    const z = document.querySelector('#itemList > li > .itemrow');
    const probe = document.createElement('i'); probe.style.color = 'var(--line)'; document.body.appendChild(probe);
    const soll = getComputedStyle(probe).color; probe.remove();
    return { ist: getComputedStyle(z).borderBottomColor, soll };
  });
  ok(breite + 'px dunkel: die Linie ist das Merkmal --line', farbe.ist === farbe.soll, JSON.stringify(farbe));
  ok(breite + 'px: kein Ueberlauf', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
