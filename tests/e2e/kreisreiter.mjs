/*
 * Die Superliste in drei Reitern.
 *
 * Seit Oktober 2026 steht auch die Superliste in drei Reitern: Listen
 * sammeln, Was es gibt, Weitergeben. Eine neue beginnt beim ersten; stehen
 * schon Leihlisten darin, oeffnet sie beim zweiten, denn dann ist das Suchen
 * der Alltag. Darunter steht ihr Zugangs-Link als festes Feld, wie bei der
 * Leihliste: verdeckt, nach dem Anlegen gelb mit der Bitte, ihn zu sichern,
 * und nur fuer die Superliste, die er meint. Der dritte Schritt traegt die
 * Warnung und das Sichern, den Link selbst nicht noch einmal.
 */
import { starteBrowser, BASE, pruefer, macheListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
const p = await ctx.newPage();
p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') { probleme.push(m.text()); } });
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
await p.reload({ waitUntil: 'networkidle' });

const ding = (id, name) => ({ id, name, note: '', status: 'available', borrower: '', since: '' });
const anna = await macheListe(p, L('Annas Keller', 'Anna', [ding('a1', 'Bohrmaschine'), ding('a2', 'Leiter')]));

const zustand = () => p.evaluate(() => ({
  gewaehlt: [...document.querySelectorAll('#kreisSchritte [role="tab"]')]
    .filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.id),
  zu: ['circleManage', 'circleBox', 'circleShareBox'].filter(id => !document.getElementById(id).hidden)
}));
const zugang = () => p.evaluate(() => {
  const k = document.getElementById('circleKeyBox');
  const feld = document.getElementById('circleKeyLink');
  return {
    da: !k.hidden, frisch: k.classList.contains('keybox--frisch'),
    titel: getComputedStyle(k.querySelector('.keybox__title')).display !== 'none',
    haken: getComputedStyle(k.querySelector('.keybox__done')).display !== 'none',
    verdeckt: feld.type === 'password', link: feld.value
  };
});
const kurz = (g) => JSON.stringify(Object.assign({}, g, { link: g.link.slice(-10) }));

console.log('· Eine neue Superliste');
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(600);
const kreisA = await p.evaluate(() => location.hash);
{
  const r = await p.evaluate(() => {
    const leiste = document.getElementById('kreisSchritte');
    return {
      rolle: leiste.getAttribute('role'), sichtbar: !leiste.hidden,
      tabs: [...leiste.querySelectorAll('.tab')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
      felder: ['circleManage', 'circleBox', 'circleShareBox'].map(id => document.getElementById(id).getAttribute('role'))
    };
  });
  ok('drei Reiter: Listen sammeln, Was es gibt, Weitergeben',
     r.rolle === 'tablist' && r.sichtbar && r.tabs.join('|') === '1 Listen sammeln|2 Was es gibt|3 Weitergeben' &&
     r.felder.every(f => f === 'tabpanel'), JSON.stringify(r));
  const z = await zustand();
  ok('sie beginnt beim Sammeln', z.gewaehlt.join() === 'kreisTab1' && z.zu.join() === 'circleManage', JSON.stringify(z));
  const g = await zugang();
  ok('darunter ihr Zugang: gelb, mit Bitte und Haken, verdeckt',
     g.da && g.frisch && g.titel && g.haken && g.verdeckt && g.link.endsWith(kreisA), kurz(g));
  const lage = await p.evaluate(() => ({
    schritt: Math.round(document.getElementById('circleManage').getBoundingClientRect().bottom),
    zugang: Math.round(document.getElementById('circleKeyBox').getBoundingClientRect().top)
  }));
  ok('und zwar unter dem offenen Schritt', lage.zugang > lage.schritt, JSON.stringify(lage));
}

console.log('· Leer: "Was es gibt" fuehrt zum Sammeln');
await p.locator('#kreisTab2').click();
ok('die Suche tritt ab, es gibt nichts zu durchsuchen', await p.locator('#circleSearch').isHidden());
ok('an ihrer Stelle steht die Aufforderung', await p.locator('#circleEmptyNone').isVisible() &&
   (await p.locator('#circleEmptyNone .empty-head').textContent()).includes('Ergänze hier die Leihlisten'));
await p.locator('#circleEmptyNone [data-weiter="1"]').click();
{
  const z = await zustand();
  const fokus = await p.evaluate(() => document.activeElement.id);
  ok('ihr Knopf fuehrt zurueck zum Sammeln, der Fokus auf dessen Reiter',
     z.gewaehlt.join() === 'kreisTab1' && fokus === 'kreisTab1', JSON.stringify(z) + ' ' + fokus);
}

console.log('· Der dritte Schritt');
await p.locator('#kreisTab3').click();
ok('traegt die Warnung', (await p.locator('#circleShareBox').textContent()).includes('sieht alle Leihlisten'));
ok('und das Sichern', await p.locator('#circleBackupBox').isVisible());
ok('den Link aber nicht noch einmal', await p.locator('#circleShareBox input').count() === 0);
ok('der steht im Feld darunter', await p.locator('#circleKeyBox').isVisible());

console.log('· Der Zugang');
await p.locator('#chkCircleKeyDone').check();
await p.waitForTimeout(200);
{
  const g = await zugang();
  ok('nach dem Haken geht die Bitte, das Feld bleibt', g.da && !g.frisch && !g.titel && !g.haken, kurz(g));
  ok('und der Fokus steht im Feld', await p.evaluate(() => document.activeElement.id) === 'circleKeyLink');
}
await p.locator('#btnRevealCircle').click();
ok('Zeigen deckt den Link auf', await p.locator('#circleKeyLink').getAttribute('type') === 'text' &&
   (await p.locator('#btnRevealCircle').textContent()).trim() === 'Verbergen');
await p.locator('#btnRevealCircle').click();
ok('Verbergen deckt ihn wieder zu', await p.locator('#circleKeyLink').getAttribute('type') === 'password');

console.log('· Mit Leihlisten oeffnet sie beim zweiten Schritt');
await p.locator('#kreisTab1').click();
await p.locator('#circleAddLink').fill('#v=' + anna.id + '.' + anna.keyStr);
await p.locator('#btnCircleAdd').click();
await p.waitForTimeout(900);
ok('nach dem Aufnehmen bleibt es beim Sammeln', (await zustand()).gewaehlt.join() === 'kreisTab1');
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
{
  const z = await zustand();
  ok('neu geladen steht "Was es gibt" offen', z.gewaehlt.join() === 'kreisTab2' && z.zu.join() === 'circleBox', JSON.stringify(z));
  ok('mit Annas zwei Sachen', await p.locator('#circleItems > li').count() === 2);
  const g = await zugang();
  ok('und darunter dem Zugang, ruhig und verdeckt', g.da && !g.frisch && g.verdeckt && g.link.endsWith(kreisA), kurz(g));
}

console.log('· Eine zweite Superliste, ohne neu zu laden');
await p.evaluate(() => { location.hash = ''; });
await p.waitForSelector('#viewStart:not([hidden])');
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(600);
const kreisB = await p.evaluate(() => location.hash);
{
  const z = await zustand();
  ok('sie beginnt wieder beim Sammeln', kreisB !== kreisA && z.gewaehlt.join() === 'kreisTab1', JSON.stringify(z));
  ok('und bittet um ihren Zugang', (await zugang()).frisch);
}
await p.evaluate((h) => { location.hash = h; }, kreisA);
await p.waitForFunction((h) => location.hash === h, kreisA);
await p.waitForTimeout(1200);
{
  const g = await zugang();
  ok('zurueck bei der ersten: ihr Link, ruhig und nicht die Bitte der zweiten',
     g.da && !g.frisch && g.link.endsWith(kreisA), kurz(g));
  ok('und, weil sie Leihlisten hat, "Was es gibt"', (await zustand()).gewaehlt.join() === 'kreisTab2');
}
ok('keine Ausnahme und keine Fehlermeldung in der Konsole', probleme.length === 0, probleme.join(' | '));
await ctx.close();

/* Die Namen der Superliste sind laenger als die der Leihliste: "1 Listen
   sammeln" braucht 127 Punkte. Gemessen wird jeder Reiter, waehrend er
   gewaehlt ist, denn gewaehlt steht sein Name fetter und damit breiter. */
console.log('· Schmal passen die Namen in ihre Reiter');
for (const sprache of ['de', 'en']) {
  for (const breite of [320, 360, 390, 430]) {
    const c = await br.newContext({ viewport: { width: breite, height: 800 } });
    await c.addInitScript((l) => { localStorage.setItem('lid.lang', l); }, sprache);
    const q = await c.newPage();
    await q.goto(BASE + '/' + kreisA, { waitUntil: 'networkidle' });
    await q.waitForSelector('#viewCircle:not([hidden])');
    await q.waitForTimeout(500);
    const raus = [];
    for (const n of [1, 2, 3]) {
      await q.locator('#kreisTab' + n).click();
      const m = await q.evaluate(() => {
        const leiste = document.getElementById('kreisSchritte').getBoundingClientRect();
        const r = [];
        if (leiste.right > innerWidth + 0.5) { r.push('Leiste bis ' + Math.round(leiste.right)); }
        document.querySelectorAll('#kreisSchritte .tab').forEach(t => {
          const a = t.getBoundingClientRect();
          t.querySelectorAll('span').forEach(s => {
            const b = s.getBoundingClientRect();
            if (b.left < a.left - 0.5 || b.right > a.right + 0.5) { r.push(t.id + ' "' + s.textContent + '"'); }
          });
        });
        return r;
      });
      m.forEach(x => raus.push('gewaehlt ' + n + ': ' + x));
    }
    ok(sprache + ' @' + breite + ': kein Name ragt aus seinem Reiter', raus.length === 0, raus.join(' | '));
    await c.close();
  }
}

await br.close();
process.exit(bilanz());
