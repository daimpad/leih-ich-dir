/*
 * Der Hero aus Knete: Wortmarke, Satz und sechs schwebende Dinge.
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
 * und kommen zur Ruhe — ohne Konfetti, denn die Startseite bleibt ruhig.
 * Klingen darf allein die Trommel, leise und nur, wenn Toene eingeschaltet
 * sind. Wer Bewegung abbestellt hat, bekommt keine.
 *
 * Seit der Hero ohne Rahmen steht, gilt ausserdem: Er ist die eine
 * Ausnahme vom Geruest und reicht ueber die Breite des Fensters, bis 1440
 * Punkte. Breit schweben die Dinge rechts neben der Wortmarke, schmal
 * stehen sie darueber. Beim ersten Zeigen treten Dinge, Wortmarke und Satz
 * in dieser Reihenfolge auf, einmal je Laden und nie fuer jemanden, der
 * Bewegung abbestellt hat. Das Kissen der ersten Knete-Fassung ist fort.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const URL = BASE + '/';
const probleme = [];

/** Zaehlt AudioContexte, bevor die Seite ihr erstes Skript ausfuehrt, und
    merkt sich, ob der Auftritt je begonnen hat: Er nimmt seine Klasse nach
    gut zwei Sekunden wieder ab, ein spaeter Blick saehe ihn nicht mehr. */
function zaehler() {
  window.__audio = 0;
  const AC = window.AudioContext;
  if (AC) { window.AudioContext = function (o) { window.__audio++; return new AC(o); }; window.AudioContext.prototype = AC.prototype; }
  window.__auftritte = 0;
  new MutationObserver((liste) => {
    liste.forEach((m) => {
      if (m.target.classList && m.target.classList.contains('hero--auftritt') &&
          !(m.oldValue || '').includes('hero--auftritt')) { window.__auftritte++; }
    });
  }).observe(document, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ['class'] });
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
  /* Gemessen wird nach dem Auftritt: Solange er laeuft, sind die Dinge
     verschoben und verkleinert. */
  await p.waitForFunction(() => !document.querySelector('.hero--auftritt'), null, { timeout: 8000 }).catch(() => {});
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
    return { marke: r('#wortmarke'), bild: r('.hero-bild'), dinge,
             verborgen: document.querySelector('.hero-bild').getAttribute('aria-hidden'),
             anwaehlbar: document.querySelectorAll('.hero-bild a, .hero-bild button, .hero-bild [tabindex]').length,
             svg: document.querySelectorAll('.hero-bild .ding svg').length,
             img: document.querySelectorAll('.hero-bild img').length };
  });
  ok('sechs Dinge, gezeichnet im Dokument und nicht nachgeladen', m.svg === 6 && m.img === 0);
  ok('fuer Vorleseprogramme verborgen', m.verborgen === 'true');
  ok('und nicht anwaehlbar', m.anwaehlbar === 0, String(m.anwaehlbar));
  ok('rechts neben der Wortmarke', m.bild.x >= m.marke.x + m.marke.width &&
     m.bild.y < m.marke.y + m.marke.height && m.bild.y + m.bild.height > m.marke.y,
     Math.round(m.bild.x) + ' / ' + Math.round(m.marke.x + m.marke.width));
  ok('ein loser Haufen, keine Reihe', new Set(m.dinge.map(d => Math.round(d.y))).size >= 4, m.dinge.map(d => Math.round(d.y)).join(','));
  ok('kein Kissen mehr', await p.locator('.kissen').count() === 0);
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

  /* Bis Oktober 2026 stand hier ein Schalter, der sich beim Antippen
     umlegte. Seitdem steht an seiner Stelle eine kleine Trommel: Sie
     springt wie die anderen und ist die eine, die klingt. */
  ok('statt des Schalters eine Trommel', await p.locator('[data-ding="schalter"]').count() === 0 &&
     await p.locator('[data-ding="trommel"] svg').count() === 1);
  const trommel = await p.locator('[data-ding="trommel"]').boundingBox();
  await p.mouse.click(trommel.x + trommel.width / 2, trommel.y + trommel.height / 2);
  await p.waitForTimeout(120);
  ok('die Trommel springt', !(await ruht(p, 'trommel')));
  ok('und klingt, weil Toene eingeschaltet sind', await p.evaluate(() => window.__audio) === 1,
     String(await p.evaluate(() => window.__audio)));
  ok('die Daueranimationen laufen', await laufend(p) > 6, String(await laufend(p)));
  await ctx.close();
}

{
  const { ctx, p } = await oeffne();
  const trommel = await p.locator('[data-ding="trommel"]').boundingBox();
  await p.mouse.click(trommel.x + trommel.width / 2, trommel.y + trommel.height / 2);
  await p.waitForTimeout(150);
  ok('ohne eingeschaltete Toene bleibt auch die Trommel still', await p.evaluate(() => window.__audio) === 0,
     String(await p.evaluate(() => window.__audio)));
  await ctx.close();
}

console.log('· Ruhe');
for (const [name, optionen, speicher] of [['aus dem System', { reducedMotion: 'reduce' }, {}],
                                          ['aus der Anwendung', { reducedMotion: 'no-preference' }, { 'lid.ruhig': '1' }]]) {
  const { ctx, p } = await oeffne(optionen, speicher);
  ok(name + ': keine Daueranimation', await laufend(p) === 0, String(await laufend(p)));
  ok(name + ': kein Auftritt', await p.evaluate(() => window.__auftritte) === 0);
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
for (const [name, optionen, thema, grund, satz] of [
  ['hell', { colorScheme: 'light' }, null, 'rgb(233, 249, 241)', 'rgb(35, 103, 78)'],
  ['dunkel', { colorScheme: 'dark' }, null, 'rgb(9, 31, 22)', 'rgb(160, 207, 185)'],
  ['System hell, Wahl dunkel', { colorScheme: 'light' }, 'dark', 'rgb(9, 31, 22)', 'rgb(160, 207, 185)']]) {
  const { ctx, p } = await oeffne(optionen, thema ? { 'lid.theme': thema } : {});
  const farben = await p.evaluate(() => ({
    hero: getComputedStyle(document.querySelector('.hero')).backgroundColor,
    grund: getComputedStyle(document.body).backgroundColor,
    satz: getComputedStyle(document.querySelector('.hero .lead')).color,
    gewicht: getComputedStyle(document.querySelector('.hero .lead')).fontWeight
  }));
  ok(name + ': ohne eigene Flaeche, der Grund scheint durch', farben.hero === 'rgba(0, 0, 0, 0)' && farben.grund === grund,
     farben.hero + ' / ' + farben.grund);
  ok(name + ': der Satz folgt', farben.satz === satz, farben.satz);
  ok(name + ': und steht kraeftiger als der Fliesstext', farben.gewicht === '800', farben.gewicht);
  await ctx.close();
}

console.log('· Über die Breiten');
/* Breit ist der Hero so breit wie das Fenster ohne den Rand von 24 Punkten
   je Seite, hoechstens 1440 (bis Oktober 2026 1600); schmal (bis 46rem, 736 Punkte) so breit wie
   das Geruest, an dem die Zusagen darunter stehen. */
for (const w of [1920, 1800, 1440, 1400, 1100, 760, 700, 600, 430, 390, 360, 320]) {
  const { ctx, p } = await oeffne({ viewport: { width: w, height: 900 } });
  const r = await p.evaluate(() => ({
    sichtbar: document.querySelector('.hero-bild').getBoundingClientRect().height > 0,
    ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1,
    hero: document.querySelector('.hero').getBoundingClientRect(),
    geruest: document.querySelector('.trust').getBoundingClientRect(),
    marke: document.getElementById('wortmarke').getBoundingClientRect(),
    bild: document.querySelector('.hero-bild').getBoundingClientRect()
  }));
  const breit = w > 736;
  const soll = breit ? Math.min(w - 48, 1440) : r.geruest.width;
  ok(w + 'px: der Hero ist ' + (breit ? 'breiter als das Geruest' : 'so breit wie das Geruest'),
     Math.abs(r.hero.width - soll) <= 1 && (!breit || r.hero.width > r.geruest.width),
     Math.round(r.hero.width) + ' / ' + Math.round(soll));
  ok(w + 'px: die Dinge sichtbar, ' + (breit ? 'rechts neben der Wortmarke' : 'ueber der Wortmarke'),
     r.sichtbar && (breit ? r.bild.x >= r.marke.x + r.marke.width : r.bild.y + r.bild.height <= r.marke.y + 1),
     JSON.stringify([Math.round(r.bild.x), Math.round(r.bild.y), Math.round(r.marke.x + r.marke.width), Math.round(r.marke.y)]));
  ok(w + 'px: die Wortmarke bleibt im Fenster', r.marke.x >= 0 && r.marke.x + r.marke.width <= w && r.marke.width > 200,
     Math.round(r.marke.x) + ' bis ' + Math.round(r.marke.x + r.marke.width));
  ok(w + 'px: kein Überlauf', !r.ueberlauf);
  await ctx.close();
}

console.log('· Der Auftritt');
{
  /* Die Reihenfolge steht in den Verzoegerungen, und die lassen sich
     lesen, solange die Klasse sitzt: Gemessene Zeitpunkte waeren auf einem
     beschaeftigten Rechner Zufall. */
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript(zaehler);
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.hero--auftritt', { state: 'attached', timeout: 5000 });
  const z = await p.evaluate(() => {
    const ms = (n) => parseFloat(getComputedStyle(n).animationDelay) * 1000;
    const dinge = Array.from(document.querySelectorAll('.dinge li')).map(ms);
    return { dinge, satz: ms(document.querySelector('.hero .lead')),
             titel: ms(document.querySelector('.hero h1')),
             satzSichtbar: getComputedStyle(document.querySelector('.hero .lead')).opacity };
  });
  await p.waitForFunction(() => document.querySelectorAll('#wortmarke .buchstabe').length > 0, null, { timeout: 8000 });
  const w = await p.evaluate(() => {
    const klasse = document.querySelector('.hero--auftritt') ? 'da' : 'fort';
    const ms = (s) => parseFloat(getComputedStyle(document.querySelector('#wortmarke .buchstabe.' + s)).animationDelay) * 1000;
    return { klasse, worte: ['w-kaugummi', 'w-butter', 'w-immergruen', 'w-pfirsich'].map(ms) };
  });
  const letztesDing = Math.max.apply(null, z.dinge);
  ok('die Dinge zuerst, eines nach dem anderen', z.dinge[0] === 0 && z.dinge.every((d, i) => i === 0 || d > z.dinge[i - 1]), z.dinge.join(','));
  /* Die Schrift liegt auf demselben Server und ist vorgeladen: Die
     Wortmarke steht, solange der Auftritt laeuft. */
  ok('dann die Wortmarke, Wort fuer Wort', w.klasse === 'da' && w.worte[0] > letztesDing &&
     w.worte.every((d, i) => i === 0 || d > w.worte[i - 1]), w.klasse + ' ' + w.worte.join(','));
  ok('der Titel tritt mit dem ersten Wort auf', z.titel > letztesDing, String(z.titel));
  ok('dann der Satz', z.satz > Math.max(z.titel, w.worte[3]), String(z.satz));
  ok('der Satz wartet so lange unsichtbar', z.satzSichtbar === '0', z.satzSichtbar);
  ok('danach geht die Klasse wieder ab', await p.waitForFunction(() => !document.querySelector('.hero--auftritt'), null, { timeout: 5000 })
    .then(() => true, () => false));
  const ende = await p.evaluate(() => ({
    satz: getComputedStyle(document.querySelector('.hero .lead')).opacity,
    dinge: Array.from(document.querySelectorAll('.dinge li')).every(n => getComputedStyle(n).opacity === '1')
  }));
  ok('und alles ist ganz zu sehen', ende.satz === '1' && ende.dinge, JSON.stringify(ende));

  /* Zurueck zur Startseite, ohne neu zu laden: Der Auftritt kommt nicht
     noch einmal. */
  await p.evaluate(() => { location.hash = 'e=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.a.b'; });
  await p.waitForSelector('#viewStart', { state: 'hidden' });
  await p.evaluate(() => { location.hash = ''; });
  await p.waitForSelector('#viewStart:not([hidden])');
  await p.waitForTimeout(300);
  ok('einmal je Laden: bei der Rueckkehr kein zweiter Auftritt',
     await p.evaluate(() => window.__auftritte) === 1, String(await p.evaluate(() => window.__auftritte)));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  ok('nach dem Neuladen wieder', await p.evaluate(() => window.__auftritte) === 1 &&
     await p.evaluate(() => !!document.querySelector('.hero--auftritt')));
  await ctx.close();
}

console.log('· Zeichen bei Kontakt');
{
  const { ctx, p } = await oeffne();
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.locator('#chkKeyDone').check();
  await p.waitForTimeout(2300);
  /* Seit Oktober 2026 ist der Kontakt der zweite Reiter und kein
     Aufklapper mehr; seinen Zusatz traegt das Feld selbst. */
  await p.locator('#schrittTab2').click();
  ok('kein Zeichen mehr in der Überschrift', await p.locator('#contactBox .card__title .ico').count() === 0);
  ok('die Überschrift steht weiterhin', /Kontakt/.test(await p.locator('#contactBox .card__title').textContent()));
  ok('das Telefon ebenfalls', await p.locator('#cfgPhone').isVisible());
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
