/*
 * Der Fokus bleibt, wo man ist, und man sieht ihn.
 *
 * Bis November 2026 (Durchsicht, Fund 12):
 * - lag der Fokus nach dem Fenster eines Gegenstands auf dem Koerper der
 *   Seite, sobald sich etwas geaendert hatte, ebenso nach Loeschen und nach
 *   dem Umschalten auf "Verliehen";
 * - setzte ein Wechsel der Ansicht keinen Fokus, und nach "Aus der
 *   Superliste nehmen" lag er auf dem Koerper;
 * - rollte der Browser schmal eine fokussierte Zeile unter die klebende
 *   Eingabe;
 * - hatte der Stift am Titel im Dunkeln 2,6:1.
 */
import { starteBrowser, BASE, pruefer, macheListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neu(opts) {
  const ctx = await br.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  return { ctx, p };
}
const ding = (id, name) => ({ id, name, note: '', status: 'available', borrower: '', since: '' });
const fokus = (p) => p.evaluate(() => {
  const a = document.activeElement;
  const li = a && a.closest('.item');
  return { tag: a ? a.tagName : null, id: a ? a.id : '', zeile: li ? li.getAttribute('data-id') : null,
           klasse: a ? a.className : '', act: a ? a.getAttribute('data-kreis-act') || a.getAttribute('data-act') : null,
           gedrueckt: a ? a.getAttribute('aria-pressed') : null, koerper: a === document.body };
});

async function eigeneListe(p, n) {
  const sachen = [];
  for (let i = 0; i < n; i++) { sachen.push(ding('d' + i, 'Ding ' + i)); }
  const l = await macheListe(p, L('Werkstatt', 'Ich', sachen));
  await p.goto(BASE + '/?f=' + n + '#e=' + l.id + '.' + l.keyStr + '.' + l.token, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);
  return l;
}
const zeileOeffnen = async (p, id) => {
  await p.locator('#itemList .item[data-id="' + id + '"] .itemrow').focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#itemModal[open]');
};

console.log('· Das Fenster eines Gegenstands');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await eigeneListe(p, 4);

  await zeileOeffnen(p, 'd1');
  await p.locator('#mdName').press('End');
  await p.keyboard.type('x');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  let f = await fokus(p);
  ok('nach einer Aenderung und Escape: die Zeile', f.zeile === 'd1' && /itemrow/.test(f.klasse), JSON.stringify(f));

  await zeileOeffnen(p, 'd2');
  await p.locator('#itemModal .seg button.is-lent').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  f = await fokus(p);
  ok('nach "Verliehen": "Verliehen an"', f.id === 'mdBorrower', JSON.stringify(f));
  await p.locator('#itemModal .seg button:not(.is-lent)').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  f = await fokus(p);
  ok('nach "Verfügbar": der gedrueckte Knopf', f.gedrueckt === 'true', JSON.stringify(f));
  await p.locator('#modalFoot .btn--primary').click();
  await p.waitForTimeout(200);
  f = await fokus(p);
  ok('nach "Fertig": die Zeile', f.zeile === 'd2', JSON.stringify(f));

  await zeileOeffnen(p, 'd2');
  await p.locator('#modalFoot .btn--danger').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  f = await fokus(p);
  ok('nach dem Loeschen: die Nachbarzeile', !!f.zeile && f.zeile !== 'd2' && !f.koerper, JSON.stringify(f));
  await p.locator('#toastAct').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  f = await fokus(p);
  ok('nach Rueckgaengig: die zurueckgekehrte Zeile', f.zeile === 'd2', JSON.stringify(f));
  await ctx.close();
}

console.log('· Wechsel der Ansicht');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(500);
  let f = await fokus(p);
  ok('nach dem Anlegen nicht auf dem Koerper', !f.koerper, JSON.stringify(f));
  /* Ein Ortswechsel ohne neues Laden, wie ihn der Weg zu den gemerkten
     Listen nimmt. Die Wortmarke laedt die Seite neu, und nach dem Laden
     liegt der Fokus zu Recht am Anfang des Dokuments. Das Anlegen ersetzt
     den Eintrag im Verlauf, ein goBack fuehrte also aus der Seite. */
  await p.evaluate(() => { location.hash = ''; });
  await p.waitForSelector('#viewStart:not([hidden])');
  await p.waitForTimeout(400);
  f = await fokus(p);
  ok('zurueck auf der Startseite nicht auf dem Koerper', !f.koerper, JSON.stringify(f));
  ok('sondern auf ihrer Ueberschrift', f.tag === 'H1', JSON.stringify(f));
  await ctx.close();
}

console.log('· Aus der Superliste nehmen');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const a = await macheListe(p, L('A', 'Anna', [ding('a1', 'Zelt')]));
  const b = await macheListe(p, L('B', 'Ben', [ding('b1', 'Leiter')]));
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
  await p.locator('#kreisTab1').click();
  for (const l of [a, b]) {
    await p.locator('#circleAddLink').fill('#v=' + l.id + '.' + l.keyStr);
    await p.locator('#circleAddLink').press('Enter');
    await p.waitForTimeout(700);
  }
  await p.locator('#circleFriends [data-kreis-act="remove"]').first().focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  let f = await fokus(p);
  ok('der Fokus geht an den naechsten Entfernen-Knopf', f.act === 'remove', JSON.stringify(f));
  await p.locator('#circleFriends [data-kreis-act="remove"]').first().focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  f = await fokus(p);
  ok('ist keiner mehr da, ins Linkfeld', f.id === 'circleAddLink', JSON.stringify(f));
  await ctx.close();
}

console.log('· Schmal: keine Zeile unter der klebenden Eingabe');
for (const [w, h] of [[390, 664], [540, 600]]) {
  const { ctx, p } = await neu({ viewport: { width: w, height: h } });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await eigeneListe(p, 14);
  await p.locator('#itemList .item').last().locator('.itemrow').focus();
  let verdeckt = 0;
  for (let i = 0; i < 14; i++) {
    verdeckt += await p.evaluate(() => {
      const a = document.activeElement.getBoundingClientRect();
      const box = document.querySelector('.addbox').getBoundingClientRect();
      return a.top < box.bottom - 1 ? 1 : 0;
    });
    await p.keyboard.press('Shift+Tab');
    await p.waitForTimeout(60);
    if (!(await p.evaluate(() => !!document.activeElement.closest('#itemList')))) { break; }
  }
  ok(w + '×' + h + ': keine fokussierte Zeile verdeckt', verdeckt === 0, String(verdeckt));
  await ctx.close();
}

console.log('· Dunkel: der Stift am Titel');
{
  const { ctx, p } = await neu({ colorScheme: 'dark' });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await eigeneListe(p, 1);
  const k = await p.evaluate(() => {
    const farbe = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = (rgb) => { const f = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
    const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const stift = farbe(getComputedStyle(document.querySelector('#viewList .title-edit__stift')).color);
    let n = document.querySelector('#viewList .title-edit');
    let grund = null;
    while (n && !grund) { const bg = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { grund = farbe(bg); } n = n.parentElement; }
    grund = grund || farbe(getComputedStyle(document.body).backgroundColor);
    return Math.round(kontrast(stift, grund) * 100) / 100;
  });
  ok('mindestens 3:1', k >= 3, String(k));
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
