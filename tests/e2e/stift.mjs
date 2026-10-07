/*
 * Der Stift hinter dem Namen einer Liste.
 *
 * Seit Oktober 2026 steht im Bearbeitenmodus hinter dem Namen der Leihliste
 * und der Superliste ein Stift: Man sieht, dass sich der Name aendern
 * laesst. Er steht direkt hinter dem Wort, weil das Feld so breit ist wie
 * sein Name (ein unsichtbarer Zwilling gibt die Breite vor, style.css
 * .title-edit__feld). Ein Tipp auf den Stift setzt den Cursor in den Namen.
 * Beim Freund gibt es keinen Stift, dort ist der Name Ueberschrift.
 */
import { starteBrowser, BASE, pruefer, macheListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neueListe(breite, sprache) {
  const ctx = await br.newContext({ viewport: { width: breite, height: 800 } });
  await ctx.addInitScript((l) => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', l); } }, sprache || 'de');
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(600);
  return { ctx, p };
}

/* Lage von Feld, Stift und Zeile, und wie breit der Name in der Schrift des
   Feldes waere. Gemessen mit einer Leinwand in derselben Schrift. */
const lage = (p, wrap) => p.evaluate((wrap) => {
  const w = document.getElementById(wrap);
  const feld = w.querySelector('.title-edit__feld').getBoundingClientRect();
  const stift = w.querySelector('.title-edit__stift').getBoundingClientRect();
  const eingabe = w.querySelector('input');
  const s = getComputedStyle(eingabe);
  const c = document.createElement('canvas').getContext('2d');
  c.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
  const text = eingabe.value || eingabe.placeholder;
  const polster = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) * 2;
  return { feldL: Math.round(feld.left), feldR: Math.round(feld.right), stiftL: Math.round(stift.left), stiftR: Math.round(stift.right),
           sichtbar: stift.width > 0 && getComputedStyle(w).display !== 'none' && !w.hidden,
           soll: Math.round(c.measureText(text).width + polster), ist: Math.round(feld.width),
           abgeschnitten: eingabe.scrollWidth > eingabe.clientWidth + 1,
           ueberlauf: document.documentElement.scrollWidth - innerWidth };
}, wrap);

console.log('· Hinter dem Namen der Leihliste');
{
  const { ctx, p } = await neueListe(1280);
  let m = await lage(p, 'listTitleEditWrap');
  ok('der Stift steht da', m.sichtbar, JSON.stringify(m));
  ok('direkt hinter dem Namen', m.stiftL - m.feldR >= 0 && m.stiftL - m.feldR <= 16, JSON.stringify(m));
  ok('das Feld ist so breit wie sein Name', Math.abs(m.ist - m.soll) <= 8, m.ist + ' / ' + m.soll);
  await p.locator('#listTitleEditWrap .title-edit__stift').hover();
  const mulde = await p.evaluate(() => getComputedStyle(document.getElementById('listTitleInput')).backgroundColor);
  const grund = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface-alt').trim());
  ok('ueber dem Stift wird der Name zur Mulde', mulde !== 'rgba(0, 0, 0, 0)', mulde + ' / ' + grund);
  await p.locator('#listTitleEditWrap .title-edit__stift').click();
  ok('ein Tipp auf den Stift setzt den Cursor in den Namen', await p.evaluate(() => document.activeElement.id) === 'listTitleInput');
  const vorher = m.stiftL;
  await p.keyboard.press('End');
  await p.keyboard.type(' im Keller');
  m = await lage(p, 'listTitleEditWrap');
  ok('der Stift wandert mit dem Namen', m.stiftL > vorher && m.stiftL - m.feldR <= 16 && Math.abs(m.ist - m.soll) <= 8,
     vorher + ' -> ' + JSON.stringify(m));
  await p.locator('#listTitleInput').fill('');
  m = await lage(p, 'listTitleEditWrap');
  ok('leer ist das Feld so breit wie sein Platzhalter', Math.abs(m.ist - m.soll) <= 8 && m.stiftL - m.feldR <= 16, JSON.stringify(m));
  await p.locator('#listTitleInput').fill('Werkzeug, Zelte und alles, was sonst noch im Keller und auf dem Dachboden liegt');
  m = await lage(p, 'listTitleEditWrap');
  ok('ein langer Name sprengt die Zeile nicht, der Stift bleibt im Blick',
     m.ueberlauf <= 0 && m.stiftR <= 1280 && m.sichtbar, JSON.stringify(m));
  /* Ein leerer Name nimmt die Breite seines Platzhalters, und der wechselt
     mit der Sprache. */
  await p.locator('#listTitleInput').fill('');
  await p.locator('#btnLang').click();
  await p.waitForTimeout(300);
  const wert = await p.evaluate(() => ({ wert: document.querySelector('#listTitleEditWrap .title-edit__feld').getAttribute('data-wert'),
    platz: document.getElementById('listTitleInput').placeholder }));
  ok('nach dem Sprachwechsel misst der Zwilling den neuen Platzhalter', wert.wert === wert.platz && !!wert.platz, JSON.stringify(wert));
  await ctx.close();
}

console.log('· Schmal');
for (const breite of [390, 320]) {
  const { ctx, p } = await neueListe(breite);
  const m = await lage(p, 'listTitleEditWrap');
  ok(breite + 'px: "Meine Leihliste" passt samt Stift, nichts laeuft ueber',
     !m.abgeschnitten && m.stiftR <= breite && m.ueberlauf <= 0, JSON.stringify(m));
  await ctx.close();
}

console.log('· Beim Freund kein Stift');
{
  const { ctx, p } = await neueListe(1280);
  const link = await p.locator('#linkView').inputValue();
  await p.goto(link, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);
  ok('der Name ist Ueberschrift, ohne Stift', await p.locator('#listTitleRead').isVisible() &&
     !(await p.locator('#listTitleEditWrap .title-edit__stift').isVisible()));
  await ctx.close();
}

console.log('· Hinter dem Namen der Superliste');
{
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(500);
  const m = await lage(p, 'circleTitleWrap');
  ok('der Stift steht direkt hinter dem Namen', m.sichtbar && m.stiftL - m.feldR >= 0 && m.stiftL - m.feldR <= 16 &&
     Math.abs(m.ist - m.soll) <= 8, JSON.stringify(m));
  await p.locator('#circleTitleWrap .title-edit__stift').click();
  ok('und setzt den Cursor in den Namen', await p.evaluate(() => document.activeElement.id) === 'circleTitleInput');
  await ctx.close();
}

console.log('· Das Zeichen');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const z = await p.evaluate(() => {
    const s = document.getElementById('i-stift');
    return s && { box: s.getAttribute('viewBox'), strich: s.getAttribute('stroke-width'), ende: s.getAttribute('stroke-linecap') };
  });
  ok('64 mal 64, Strich 4, eckige Enden', z && z.box === '0 0 64 64' && z.strich === '4' && z.ende === 'square', JSON.stringify(z));
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
