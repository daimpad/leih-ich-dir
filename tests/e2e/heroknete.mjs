/*
 * Der Hero aus Knete: Wortmarke und die sechs Dinge auf dem Kissen.
 *
 * Abgeloest hat diese Suite heropfote.mjs, die die Katzenpfote rechts im
 * Hero festhielt; die Pfote liegt seit dem Wechsel zur Knete im Archiv.
 * Geblieben ist ihr letzter Teil, der Kontaktkasten ohne Zeichen — er hat
 * mit dem Bild nichts zu tun und gilt weiter.
 *
 * Festgehalten wird, was der neue Hero zusagt: Die Wortmarke ist aus Knete
 * geformt, in Nunito und in der gewaehlten Sprache, und der Titel bleibt
 * fuer Vorleseprogramme stehen. Die Dinge stehen im Dokument, sind fuer
 * Vorleseprogramme verborgen und nicht anwaehlbar, springen beim Anfassen
 * und kommen zur Ruhe — ohne Konfetti und ohne Ton, denn die Startseite
 * bleibt ruhig. Wer Bewegung abbestellt hat, bekommt keine.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const URL = BASE + '/';
const probleme = [];

/** Zaehlt AudioContexte, bevor die Seite ihr erstes Skript ausfuehrt. */
function zaehler() {
  window.__audio = 0;
  const AC = window.AudioContext;
  if (AC) { window.AudioContext = function (o) { window.__audio++; return new AC(o); }; window.AudioContext.prototype = AC.prototype; }
}

async function oeffne(optionen, speicher) {
  const ctx = await br.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' }, optionen || {}));
  await ctx.addInitScript(zaehler);
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('__gesetzt')) { return; }
    localStorage.clear();
    Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
    sessionStorage.setItem('__gesetzt', '1');
  }, Object.assign({ 'lid.lang': 'de' }, speicher || {}));
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') { probleme.push(m.text()); } });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.querySelectorAll('#wortmarke .buchstabe').length > 0, null, { timeout: 8000 })
    .catch(() => {});
  await p.waitForTimeout(300);
  return { ctx, p };
}

const buchstaben = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#wortmarke .buchstabe'))
  .map(g => { const t = g.querySelector('.b-flaeche'); return t ? t.textContent : '•'; }).join(''));
const ruht = (p, art) => p.locator('[data-ding="' + art + '"] .ding__feder').evaluate(g => !g.hasAttribute('transform'));
const laufend = (p) => p.evaluate(() =>
  document.getAnimations().filter(a => a instanceof CSSAnimation && a.playState === 'running').length);

console.log('· Die Wortmarke');
{
  const { ctx, p } = await oeffne();
  ok('aus Knete geformt: zehn Buchstaben und ein Punkt', await buchstaben(p) === 'LeihichDir•', await buchstaben(p));
  const titel = await p.evaluate(() => {
    const h = document.querySelector('.hero h1');
    return { text: h.textContent.replace(/\s+/g, ' ').trim(), breite: h.getBoundingClientRect().width };
  });
  ok('der Titel bleibt fuer Vorleseprogramme im Dokument', titel.text === 'Leih ich Dir.', titel.text);
  ok('und ist nur dort zu finden, nicht zu sehen', titel.breite <= 1, String(titel.breite));
  ok('die Wortmarke selbst ist fuer Vorleseprogramme verborgen', await p.getAttribute('#wortmarke', 'aria-hidden') === 'true');
  const schrift = await p.locator('#wortmarke .b-flaeche').first().evaluate(n => getComputedStyle(n).fontFamily);
  ok('in Nunito gemessen und gesetzt', /Nunito/.test(schrift), schrift);
  ok('jedes Wort in seiner Farbe', await p.evaluate(() => {
    const g = Array.from(document.querySelectorAll('#wortmarke .buchstabe')).map(n => n.getAttribute('class'));
    return g[0].includes('w-kaugummi') && g[4].includes('w-butter') && g[7].includes('w-immergruen') && g[10].includes('w-pfirsich');
  }));

  await p.click('#btnLang');
  await p.waitForTimeout(500);
  ok('nach dem Sprachwechsel neu geformt', await buchstaben(p) === 'Borrowitfromme•', await buchstaben(p));
  await p.click('#btnLang');
  await p.waitForTimeout(500);
  ok('und zurueck', await buchstaben(p) === 'LeihichDir•', await buchstaben(p));
  await ctx.close();
}
{
  const { ctx, p } = await oeffne({}, { 'lid.lang': 'en' });
  ok('auf Englisch geladen: Borrow it from me.', await buchstaben(p) === 'Borrowitfromme•', await buchstaben(p));
  await ctx.close();
}
{
  /* Die Wortmarke laesst sich nur messen, wenn sie zu sehen ist. Wer mit
     einem Link einsteigt, sieht die Startseite erst spaeter; dann holt
     showView sie nach. */
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  await p.goto(URL + '#e=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.a.b', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  ok('mit einem Link eingestiegen, ist die Startseite verborgen', await p.locator('#viewStart').isHidden());
  ok('und die Wortmarke noch nicht geformt', await buchstaben(p) === '');
  await p.evaluate(() => { location.hash = ''; });
  await p.waitForTimeout(800);
  ok('zurueck auf der Startseite wird sie nachgeholt', await buchstaben(p) === 'LeihichDir•', await buchstaben(p));
  await ctx.close();
}

console.log('· Die Dinge');
{
  const { ctx, p } = await oeffne({}, { 'lid.ton': '1' });
  const m = await p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    /* Gemessen an den Plaetzen und nicht an den Dingen: Die schaukeln und
       heben sich dabei um bis zu sechs Punkte. */
    const dinge = Array.from(document.querySelectorAll('.dinge li')).map(d => d.getBoundingClientRect());
    return { panel: r('.hero-panel'), bild: r('.hero-bild'), btn: r('#btnCreateHero'), dinge,
             verborgen: document.querySelector('.hero-bild').getAttribute('aria-hidden'),
             anwaehlbar: document.querySelectorAll('.hero-bild a, .hero-bild button, .hero-bild [tabindex]').length,
             svg: document.querySelectorAll('.hero-bild .ding svg').length,
             img: document.querySelectorAll('.hero-bild img').length };
  });
  ok('sechs Dinge, gezeichnet im Dokument und nicht nachgeladen', m.svg === 6 && m.img === 0);
  ok('fuer Vorleseprogramme verborgen', m.verborgen === 'true');
  ok('und nicht anwaehlbar', m.anwaehlbar === 0, String(m.anwaehlbar));
  ok('im Rahmen des Hero', m.bild.x >= m.panel.x - 1 && m.bild.x + m.bild.width <= m.panel.x + m.panel.width + 1);
  ok('unter dem Aufruf', m.bild.y >= m.btn.y + m.btn.height, Math.round(m.bild.y) + ' / ' + Math.round(m.btn.y + m.btn.height));
  ok('breit in einer Reihe', new Set(m.dinge.map(d => Math.round(d.y))).size === 1, m.dinge.map(d => Math.round(d.y)).join(','));
  ok('gross genug, um erkennbar zu sein', m.dinge.every(d => d.width >= 48), m.dinge.map(d => Math.round(d.width)).join(','));

  const leiter = await p.locator('[data-ding="leiter"]').boundingBox();
  await p.mouse.move(leiter.x + leiter.width / 2, leiter.y + leiter.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(150);
  ok('gedrueckt sinkt das Ding ein', !(await ruht(p, 'leiter')));
  await p.mouse.up();
  await p.waitForTimeout(250);
  ok('losgelassen springt es', await p.locator('[data-ding="leiter"] .ding__feder').evaluate(g =>
    /translate\(60 (\d+(\.\d+)?)\)/.test(g.getAttribute('transform') || '') &&
    parseFloat(RegExp.$1) < 104), await p.locator('[data-ding="leiter"] .ding__feder').getAttribute('transform'));
  ok('ohne Konfetti', await p.locator('#konfetti').count() === 0);
  ok('ohne Ton, auch wenn Toene eingeschaltet sind', await p.evaluate(() => window.__audio) === 0);
  await p.waitForTimeout(2600);
  ok('und kommt zur Ruhe', await ruht(p, 'leiter'));

  const schalter = await p.locator('[data-ding="schalter"]').boundingBox();
  await p.mouse.click(schalter.x + schalter.width / 2, schalter.y + schalter.height / 2);
  ok('der Schalter unter den Dingen legt sich um', await p.locator('.ding--schalter.ist-aus').count() === 1);
  ok('die Daueranimationen laufen', await laufend(p) > 6, String(await laufend(p)));
  await ctx.close();
}

console.log('· Ruhe');
for (const [name, optionen, speicher] of [['aus dem System', { reducedMotion: 'reduce' }, {}],
                                          ['aus der Anwendung', { reducedMotion: 'no-preference' }, { 'lid.ruhig': '1' }]]) {
  const { ctx, p } = await oeffne(optionen, speicher);
  ok(name + ': keine Daueranimation', await laufend(p) === 0, String(await laufend(p)));
  const zelt = await p.locator('[data-ding="zelt"]').boundingBox();
  await p.mouse.move(zelt.x + zelt.width / 2, zelt.y + zelt.height / 2);
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(200);
  ok(name + ': kein Sprung', await ruht(p, 'zelt'));
  ok(name + ': die Wortmarke steht trotzdem', await buchstaben(p) === 'LeihichDir•');
  await ctx.close();
}

console.log('· Hell und Dunkel');
for (const [name, optionen, thema, flaeche, kissen] of [
  ['hell', { colorScheme: 'light' }, null, 'rgb(255, 252, 250)', 'rgb(208, 241, 225)'],
  ['dunkel', { colorScheme: 'dark' }, null, 'rgb(7, 49, 34)', 'rgb(10, 67, 48)'],
  ['System hell, Wahl dunkel', { colorScheme: 'light' }, 'dark', 'rgb(7, 49, 34)', 'rgb(10, 67, 48)']]) {
  const { ctx, p } = await oeffne(optionen, thema ? { 'lid.theme': thema } : {});
  const farben = await p.evaluate(() => ({
    flaeche: getComputedStyle(document.querySelector('.hero-panel')).backgroundColor,
    kissen: getComputedStyle(document.querySelector('.kissen')).backgroundColor
  }));
  ok(name + ': der Rahmen folgt', farben.flaeche === flaeche, farben.flaeche);
  ok(name + ': das Kissen folgt', farben.kissen === kissen, farben.kissen);
  await ctx.close();
}

console.log('· Über die Breiten');
for (const w of [1400, 1100, 760, 700, 600, 430, 390, 360, 320]) {
  const { ctx, p } = await oeffne({ viewport: { width: w, height: 900 } });
  const r = await p.evaluate(() => ({
    sichtbar: document.querySelector('.hero-bild').getBoundingClientRect().height > 0,
    reihen: new Set(Array.from(document.querySelectorAll('.dinge li')).map(d => Math.round(d.getBoundingClientRect().y))).size,
    ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1,
    marke: document.getElementById('wortmarke').getBoundingClientRect(),
    panel: document.querySelector('.hero-panel').getBoundingClientRect()
  }));
  ok(w + 'px: sichtbar, in ' + (w > 736 ? 'einer Reihe' : 'zwei Reihen'), r.sichtbar && r.reihen === (w > 736 ? 1 : 2), r.reihen + ' Reihen');
  ok(w + 'px: die Wortmarke bleibt im Rahmen', r.marke.x + r.marke.width <= r.panel.x + r.panel.width + 1 && r.marke.width > 200,
     Math.round(r.marke.x + r.marke.width) + ' / ' + Math.round(r.panel.x + r.panel.width));
  ok(w + 'px: kein Überlauf', !r.ueberlauf);
  await ctx.close();
}

console.log('· Zeichen bei Kontakt');
{
  const { ctx, p } = await oeffne();
  await p.locator('#btnCreateHero').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.locator('#chkKeyDone').check();
  await p.waitForTimeout(2300);
  ok('kein Zeichen mehr in der Überschrift', await p.locator('#contactBox summary .ico').count() === 0);
  ok('die Überschrift steht weiterhin', /Kontakt/.test(await p.locator('#contactBox summary').innerText()));
  ok('der Zusatz ebenfalls', /Telefon/.test(await p.locator('#contactBox summary').innerText()));
  ok('das ungenutzte Zeichen ist aus dem Satz', await p.locator('#i-user').count() === 0);
  const kartenMitZeichen = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.card__title, .fold > summary'))
      .filter(n => n.querySelector('svg.ico')).length);
  ok('keine Überschrift trägt ein Zeichen', kartenMitZeichen === 0, String(kartenMitZeichen));
  await ctx.close();
}

ok('keine Fehler', probleme.length === 0, probleme.slice(0, 3).join(' | '));
await br.close();
process.exit(bilanz());
