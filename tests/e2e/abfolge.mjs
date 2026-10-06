/*
 * Die Abfolge der Leihliste: drei Reiter, ein Schritt zu sehen.
 *
 * Seit Oktober 2026 stehen Inventar, Kontakt und Link teilen im
 * Bearbeitenmodus nicht mehr untereinander, sondern als drei Reiter in der
 * Reihenfolge, in der eine Liste entsteht. Festgehalten wird, was das
 * zusagt: Anfangs ist das Inventar offen, ein Knopf fuehrt jeweils zum
 * naechsten Schritt, die Reiter folgen dem Muster fuer Tastatur und
 * Vorleseprogramme, der Zugang steht ueber ihnen, und die Erklaerungen
 * erscheinen erst auf Zuruf. Beim Freund gibt es keine Reiter.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neueListe(sprache, breite) {
  const ctx = await br.newContext({ viewport: { width: breite || 1280, height: 900 }, locale: sprache === 'en' ? 'en-GB' : 'de-DE' });
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') { probleme.push(m.text()); } });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.evaluate((l) => { localStorage.clear(); localStorage.setItem('lid.lang', l); }, sprache || 'de');
  await p.reload({ waitUntil: 'networkidle' });
  await p.locator('#btnCreateHero').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(600);
  return { ctx, p };
}

const zustand = (p) => p.evaluate(() => {
  const tabs = [...document.querySelectorAll('#schritte [role="tab"]')];
  return {
    gewaehlt: tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.id),
    folge: tabs.filter(t => t.getAttribute('tabindex') !== '-1').map(t => t.id),
    zu: ['inventoryBox', 'contactBox', 'shareBox'].filter(id => !document.getElementById(id).hidden),
    fokus: document.activeElement ? document.activeElement.id : ''
  };
});
const sichtbar = (p, sel) => p.locator(sel).first().isVisible();

console.log('· Drei Reiter im Bearbeitenmodus');
const { ctx, p } = await neueListe('de');
{
  const r = await p.evaluate(() => {
    const leiste = document.getElementById('schritte');
    return {
      rolle: leiste.getAttribute('role'), name: leiste.getAttribute('aria-label'), sichtbar: !leiste.hidden,
      tabs: [...leiste.querySelectorAll('.tab')].map(t => ({
        rolle: t.getAttribute('role'), text: t.textContent.replace(/\s+/g, ' ').trim(),
        steuert: t.getAttribute('aria-controls') })),
      felder: ['inventoryBox', 'contactBox', 'shareBox'].map(id => {
        const n = document.getElementById(id);
        return n.getAttribute('role') + ':' + n.getAttribute('aria-labelledby');
      })
    };
  });
  ok('eine Leiste mit Namen', r.sichtbar && r.rolle === 'tablist' && r.name === 'Schritte', JSON.stringify(r).slice(0, 80));
  ok('drei Reiter in der Reihenfolge der Entstehung',
     r.tabs.map(t => t.text).join('|') === '1 Inventar|2 Kontakt|3 Link teilen' && r.tabs.every(t => t.rolle === 'tab'),
     r.tabs.map(t => t.text).join('|'));
  ok('jeder Reiter steuert seinen Kasten', r.tabs.map(t => t.steuert).join(',') === 'inventoryBox,contactBox,shareBox');
  ok('und jeder Kasten nennt seinen Reiter',
     r.felder.join(',') === 'tabpanel:schrittTab1,tabpanel:schrittTab2,tabpanel:schrittTab3', r.felder.join(','));
  const z = await zustand(p);
  ok('anfangs ist das Inventar offen', z.gewaehlt.join() === 'schrittTab1' && z.zu.join() === 'inventoryBox', JSON.stringify(z));
  ok('nur der gewaehlte Reiter liegt in der Tabulatorfolge', z.folge.join() === 'schrittTab1', z.folge.join());
  const lage = await p.evaluate(() => {
    const y = (s) => document.querySelector(s).getBoundingClientRect().top;
    return { zugang: y('#keyBox'), reiter: y('#schritte'), inventar: y('#inventoryBox') };
  });
  ok('der Zugang steht ueber den Reitern', lage.zugang < lage.reiter && lage.reiter < lage.inventar, JSON.stringify(lage));
  ok('die Ueberschrift der Karte nur fuer Vorleseprogramme',
     await p.locator('#inventoryBox .card__title').evaluate(n => n.getBoundingClientRect().width <= 1));
}

console.log('· Weiter');
await p.locator('#chkKeyDone').check();
await p.waitForTimeout(300);
{
  ok('im Inventar fuehrt ein Knopf zum Kontakt', /Weiter: Kontakt/.test(await p.locator('[data-weiter="2"]').innerText()));
  ok('er traegt nicht die Farbe der Handlung',
     !(await p.locator('[data-weiter="2"]').getAttribute('class')).includes('btn--primary'));
  await p.locator('[data-weiter="2"]').click();
  await p.waitForTimeout(300);
  let z = await zustand(p);
  ok('danach ist der Kontakt offen und nur er', z.gewaehlt.join() === 'schrittTab2' && z.zu.join() === 'contactBox', JSON.stringify(z));
  ok('und sein Reiter hat den Fokus', z.fokus === 'schrittTab2', z.fokus);
  ok('im Kontakt fuehrt ein Knopf zum Teilen', /Weiter: Link teilen/.test(await p.locator('[data-weiter="3"]').innerText()));
  await p.locator('[data-weiter="3"]').click();
  await p.waitForTimeout(300);
  z = await zustand(p);
  ok('danach ist Link teilen offen', z.gewaehlt.join() === 'schrittTab3' && z.zu.join() === 'shareBox', JSON.stringify(z));
  ok('der letzte Schritt hat keinen Weiter-Knopf', await p.locator('#shareBox [data-weiter]').count() === 0);
}

console.log('· Tastatur');
{
  await p.locator('#schrittTab3').focus();
  const folge = [];
  for (const taste of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'Home', 'End']) {
    await p.keyboard.press(taste);
    const z = await zustand(p);
    folge.push(z.gewaehlt.join() + '/' + z.fokus);
  }
  ok('Pfeile wechseln und waehlen, ueber die Raender hinweg; Pos1 und Ende springen',
     folge.join(' ') === ['schrittTab1/schrittTab1', 'schrittTab2/schrittTab2', 'schrittTab1/schrittTab1',
       'schrittTab3/schrittTab3', 'schrittTab1/schrittTab1', 'schrittTab3/schrittTab3'].join(' '), folge.join(' '));
  await p.keyboard.press('Tab');
  ok('Tab verlaesst die Leiste', !(await p.evaluate(() => document.activeElement.closest('#schritte'))));
}

console.log('· Erklaerungen auf Zuruf');
{
  await p.locator('#schrittTab2').click();
  ok('ohne Zuruf keine Erklaerung im Kontakt', !(await sichtbar(p, '#contactBox .hint--abruf')));
  const zeichen = p.locator('#contactBox [data-hinweise]');
  ok('das Zeichen sagt, was es tut', await zeichen.getAttribute('aria-label') === 'Erklärungen' &&
     await zeichen.getAttribute('aria-expanded') === 'false');
  await zeichen.click();
  ok('auf Zuruf erscheinen alle drei an ihrer Stelle',
     await p.locator('#contactBox .hint--abruf').evaluateAll(l => l.length === 3 && l.every(n => n.getBoundingClientRect().height > 0)));
  ok('und das Zeichen sagt es', await zeichen.getAttribute('aria-expanded') === 'true');
  await zeichen.click();
  ok('ein zweiter Zuruf nimmt sie wieder weg', !(await sichtbar(p, '#contactBox .hint--abruf')));
  await p.locator('#schrittTab3').click();
  ok('im Teilen ebenso', !(await sichtbar(p, '#shareBox .hint--abruf')));
}

console.log('· Link teilen');
{
  ok('der Ansehen-Link steht vorn, mit sichtbarer Beschriftung',
     await sichtbar(p, '#linkView') && await sichtbar(p, 'label[for="linkView"]'));
  ok('keine Reiter im Reiter mehr', await p.locator('#tabBtnView, #tabBtnEdit').count() === 0);
  ok('der Bearbeiten-Link liegt zugeklappt darunter', !(await p.locator('#editFold').evaluate(n => n.open)) &&
     !(await sichtbar(p, '#linkEdit')));
  ok('das Sichern ebenso', !(await p.locator('#backupBox').evaluate(n => n.open)) && !(await sichtbar(p, '#btnBackup')));
  await p.locator('#editFold summary').click();
  ok('aufgeklappt ist er da, verdeckt', await sichtbar(p, '#linkEdit') &&
     await p.locator('#linkEdit').getAttribute('type') === 'password');
}

console.log('· Neu geladen');
{
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);
  const z = await zustand(p);
  ok('beginnt es wieder beim Inventar', z.gewaehlt.join() === 'schrittTab1' && z.zu.join() === 'inventoryBox', JSON.stringify(z));
}

console.log('· Eine andere Liste, ohne neu zu laden');
{
  /* Der gewaehlte Schritt gilt nur fuer die offene Liste. Neu laden setzt
     ohnehin alles zurueck; hier bleibt die Seite stehen und wechselt nur
     die Liste. */
  await p.locator('#schrittTab3').click();
  await p.evaluate(() => { location.hash = ''; });
  await p.waitForSelector('#viewStart:not([hidden])');
  await p.locator('#btnCreateHero').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(500);
  const z = await zustand(p);
  ok('beginnt sie beim Inventar', z.gewaehlt.join() === 'schrittTab1' && z.zu.join() === 'inventoryBox', JSON.stringify(z));
}

console.log('· Beim Freund');
{
  const ansehen = await p.locator('#linkView').inputValue();
  const g = await ctx.newPage();
  g.on('pageerror', e => probleme.push('gast: ' + e.message));
  await g.goto(ansehen, { waitUntil: 'networkidle' });
  await g.waitForSelector('#viewList:not([hidden])');
  await g.waitForTimeout(500);
  const r = await g.evaluate(() => ({
    leiste: document.getElementById('schritte').hidden,
    kontakt: document.getElementById('contactBox').hidden,
    teilen: document.getElementById('shareBox').hidden,
    inventar: !document.getElementById('inventoryBox').hidden,
    rolle: document.getElementById('inventoryBox').getAttribute('role'),
    weiter: document.querySelector('[data-weiter="2"]').getClientRects().length,
    titel: document.querySelector('#inventoryBox .card__title').getBoundingClientRect().width
  }));
  ok('keine Reiter', r.leiste, JSON.stringify(r));
  ok('kein Kontakt und kein Teilen', r.kontakt && r.teilen);
  ok('das Inventar steht allein, ohne Rolle eines Reiterkastens', r.inventar && r.rolle === null, String(r.rolle));
  ok('ohne Weiter-Knopf', r.weiter === 0, String(r.weiter));
  ok('mit sichtbarer Ueberschrift', r.titel > 20, String(r.titel));
  await g.close();
}
await ctx.close();

console.log('· Englisch und schmal');
for (const [sprache, breite, namen, weiter] of [
  ['en', 1280, '1 Inventory|2 Contact|3 Share link', 'Next: contact'],
  ['de', 320, '1 Inventar|2 Kontakt|3 Link teilen', 'Weiter: Kontakt'],
  ['en', 320, '1 Inventory|2 Contact|3 Share link', 'Next: contact']]) {
  const { ctx: c, p: s } = await neueListe(sprache, breite);
  const r = await s.evaluate(() => ({
    namen: [...document.querySelectorAll('#schritte .tab')].map(t => t.textContent.replace(/\s+/g, ' ').trim()).join('|'),
    passt: [...document.querySelectorAll('#schritte .tab')].every(t => {
      const k = [...t.children].map(c => c.getBoundingClientRect());
      const r = t.getBoundingClientRect();
      return Math.min(...k.map(x => x.left)) >= r.left && Math.max(...k.map(x => x.right)) <= r.right;
    }),
    ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1
  }));
  const wo = sprache + ' @' + breite + ': ';
  ok(wo + 'die Reiter heissen richtig', r.namen === namen, r.namen);
  ok(wo + 'jeder passt in seinen Platz', r.passt);
  ok(wo + 'kein Ueberlauf', !r.ueberlauf);
  ok(wo + 'der Knopf heisst ' + weiter, (await s.locator('[data-weiter="2"]').innerText()).trim() === weiter,
     await s.locator('[data-weiter="2"]').innerText());
  await c.close();
}

ok('keine Fehler', probleme.length === 0, probleme.slice(0, 3).join(' | '));
await br.close();
process.exit(bilanz());
