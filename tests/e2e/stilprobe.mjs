/*
 * Die Stilprobe: LeihIchDir aus Knete (stilprobe.html).
 *
 * Die Probe ist kein Teil der Anwendung, liegt aber im Web-Root und wird mit
 * ausgeliefert. Festgehalten wird, was sie zusagt: Sie laeuft unter
 * derselben strengen Inhaltsrichtlinie ohne einen Verstoss, laeuft auf
 * schmalen Schirmen nicht ueber, jedes Bauteil tut, was es ankuendigt, der
 * Ton bleibt aus, bis jemand ihn einschaltet, und wer Bewegung abbestellt
 * hat — im System oder in der Anwendung —, bekommt keine.
 *
 * Die Zwischenablage wird in der Seite abgefangen: Geprueft wird, was die
 * Probe kopiert und meldet, nicht die Zwischenablage des Rechners, die es
 * auf einem Rechner von GitHub nicht verlaesslich gibt.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const SEITE = BASE + '/stilprobe.html';

/* Laeuft vor dem ersten Skript der Seite: zaehlt AudioContexte und
   Oszillatoren, sammelt Verstoesse gegen die Inhaltsrichtlinie und faengt
   das Kopieren ab. Ein Sprung spielt mit Ton genau einen Oszillator. */
function spitzel() {
  window.__audio = 0; window.__osz = 0; window.__csp = []; window.__kopiert = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || e.sample || ''));
  });
  const AC = window.AudioContext;
  if (AC) {
    const osz = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () { window.__osz++; return osz.call(this); };
    window.AudioContext = function (o) { window.__audio++; return new AC(o); };
    window.AudioContext.prototype = AC.prototype;
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText = (t) => { window.__kopiert.push(t); return Promise.resolve(); };
  }
}

async function oeffne(optionen, vorher) {
  const ctx = await br.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' }, optionen || {}));
  await ctx.addInitScript(spitzel);
  if (vorher) { await ctx.addInitScript(vorher); }
  const p = await ctx.newPage();
  const fehler = [];
  p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') { fehler.push('console: ' + m.text()); } });
  await p.goto(SEITE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  return { ctx, p, fehler };
}

const meldung = (p) => p.locator('#toast').textContent();
const ruht = (p, sel) => p.locator(sel).evaluate(el => !el.hasAttribute('transform'));
const zuEinemDing = (p, art) => p.locator('[data-ding="' + art + '"]');

/** Zaehlt die gezeichneten Punkte auf der Konfetti-Leinwand. */
const konfettiPunkte = (p) => p.evaluate(() => {
  const c = document.getElementById('konfetti');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i]) { n++; } }
  return n;
});

/** Schatten einzeln, ohne die Kommata in rgba(...) zu zerschneiden. */
const schatten = (s) => s.split(/,(?![^(]*\))/).map(x => x.trim());

/* == Laden, Richtlinie, Wortmarke ========================================= */

console.log('· Laden und Richtlinie');
{
  const roh = await (await fetch(SEITE)).text();
  const csp = (roh.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  ok('die Seite bringt eine Inhaltsrichtlinie mit', /style-src 'self'/.test(csp) && /script-src 'self'/.test(csp), csp);
  ok('ohne unsafe-inline', csp !== '' && !/unsafe-inline/.test(csp));
  ok('kein style-Attribut im HTML, die Richtlinie wuerde es stumm verwerfen', !/\sstyle=/.test(roh));
  ok('kein eingebettetes Skript', !/<script(?![^>]*\ssrc=)[^>]*>\s*\S/.test(roh));
  ok('keine Farbwerte im HTML ausser den angezeigten', !/(fill|stroke|stop-color|flood-color)="#/.test(roh));
  ok('noindex im Kopf', /<meta name="robots" content="noindex/.test(roh));

  const { ctx, p, fehler } = await oeffne();
  ok('laeuft ohne Ausnahme und ohne Fehlermeldung', fehler.length === 0, fehler.join(' | '));
  ok('kein Verstoss gegen die Richtlinie', (await p.evaluate(() => window.__csp)).length === 0,
     (await p.evaluate(() => window.__csp)).join(' | '));
  const marke = await p.evaluate(() => ({
    da: document.documentElement.classList.contains('wortmarke-da'),
    teile: document.querySelectorAll('#wortmarke .buchstabe').length,
    titel: document.querySelector('h1').textContent.trim()
  }));
  ok('die Wortmarke ist geformt: zehn Buchstaben und ein Punkt', marke.da && marke.teile === 11, JSON.stringify(marke));
  ok('der Titel bleibt fuer Vorleseprogramme im Dokument', marke.titel === 'Leih ich Dir.', marke.titel);
  ok('nach dem Laden kein AudioContext', await p.evaluate(() => window.__audio) === 0);
  const tokens = await p.evaluate(() => getComputedStyle(document.getElementById('v-kaugummi').querySelector('stop')).stopColor);
  ok('die Verlaeufe holen ihre Farben aus den Merkmalen', tokens === 'rgb(255, 217, 227)', tokens);

  /* == Die Dinge ========================================================== */

  console.log('· Die Dinge');
  await zuEinemDing(p, 'bohr').click({ force: true });
  await p.waitForTimeout(120);
  ok('ein Klick laesst das Ding springen', !(await ruht(p, '[data-ding="bohr"] .ding__feder')));
  ok('und Konfetti fliegen', await konfettiPunkte(p) > 200);
  ok('es sagt, was es ist', await meldung(p) === 'Eine Bohrmaschine. Das halbe Haus wird sich freuen.', await meldung(p));
  ok('ohne eingeschalteten Ton kein AudioContext', await p.evaluate(() => window.__audio) === 0);
  await p.waitForTimeout(2600);
  ok('nach dem Sprung kommt es zur Ruhe', await ruht(p, '[data-ding="bohr"] .ding__feder'));
  ok('und die Leinwand ist wieder leer', await konfettiPunkte(p) === 0);

  const schalterDing = zuEinemDing(p, 'schalter');
  await schalterDing.click({ force: true });
  await p.waitForTimeout(100);
  ok('der Schalter unter den Dingen legt sich um',
     await schalterDing.getAttribute('aria-pressed') === 'false' && await meldung(p) === 'Verliehen. Das Ding ist unterwegs.',
     await schalterDing.getAttribute('aria-pressed') + ' / ' + await meldung(p));

  /* == Ton ================================================================ */

  console.log('· Ton');
  await p.click('#tonSchalter');
  await p.waitForTimeout(150);
  ok('erst das Einschalten erzeugt einen AudioContext', await p.evaluate(() => window.__audio) === 1);
  ok('und es klingt', await p.evaluate(() => window.__osz) >= 1);
  ok('beide Tonschalter zeigen dasselbe',
     await p.getAttribute('#tonSchalter', 'aria-checked') === 'true' && await p.getAttribute('#tonSchalter2', 'aria-checked') === 'true');

  /* Ein langer Druck sprang frueher zweimal: Der Klick nach dem Loslassen
     zaehlte vom Druck an und hielt ihn fuer einen Klick ohne Druck. */
  const leiter = await zuEinemDing(p, 'leiter').boundingBox();
  for (const dauer of [120, 1000]) {
    await p.waitForTimeout(1800);
    await p.evaluate(() => { window.__osz = 0; });
    await p.mouse.move(leiter.x + leiter.width / 2, leiter.y + leiter.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(dauer);
    await p.mouse.up();
    await p.waitForTimeout(400);
    const spruenge = await p.evaluate(() => window.__osz);
    ok('ein Druck von ' + dauer + ' ms ist ein Sprung', spruenge === 1, spruenge + ' Spruenge');
  }

  await p.click('#tonSchalter2');
  await p.waitForTimeout(100);
  ok('der zweite Schalter schaltet beide aus',
     await p.getAttribute('#tonSchalter', 'aria-checked') === 'false' && await p.getAttribute('#tonSchalter2', 'aria-checked') === 'false');
  /* Ein Knopf, der mit Ton einen Oszillator spielt: Bleibt der Zaehler
     stehen, ist der Ton wirklich aus. */
  await p.evaluate(() => { window.__osz = 0; });
  await p.click('.knopf[data-ton] >> nth=0');
  ok('ausgeschaltet klingt nichts mehr', await p.evaluate(() => window.__osz) === 0);

  /* == Bauteile =========================================================== */

  console.log('· Knoepfe und Schalter');
  await p.click('#merkKnopf');
  ok('"Merken" bleibt gedrueckt', await p.getAttribute('#merkKnopf', 'aria-pressed') === 'true');
  await p.click('#merkKnopf');
  ok('und loest sich wieder', await p.getAttribute('#merkKnopf', 'aria-pressed') === 'false');
  const frei = p.locator('.schalter', { hasText: 'Nur zeigen, was gerade frei ist' });
  await frei.click();
  ok('ein Schalter legt sich um', await frei.getAttribute('aria-checked') === 'false');
  await frei.focus();
  await p.keyboard.press('Space');
  ok('auch mit der Leertaste', await frei.getAttribute('aria-checked') === 'true');

  console.log('· Regler');
  await p.focus('#weichheit');
  await p.keyboard.press('End');
  await p.waitForTimeout(400);   // die Knoepfe gleiten in 0,2 s in den neuen Schatten
  const weich = await p.evaluate(() => ({
    wert: document.getElementById('weichheitWert').textContent,
    merkmal: getComputedStyle(document.documentElement).getPropertyValue('--weich').trim(),
    schatten: getComputedStyle(document.getElementById('geleePlus')).boxShadow
  }));
  ok('"Weichheit" stellt --weich fuer die ganze Seite', weich.wert === '160 %' && weich.merkmal === '1.60', JSON.stringify(weich));
  ok('und jeder Schatten waechst mit', weich.schatten.includes('12.8px 19.2px 41.6px'), weich.schatten);
  await p.keyboard.press('Home');
  ok('bis hinunter auf 40 %', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--weich').trim()) === '0.40');
  await p.focus('#federung');
  await p.keyboard.press('Home');
  ok('"Federung" zeigt ihren Wert', await p.textContent('#federungWert') === '0 %');

  console.log('· Gelee');
  await p.locator('#gelee').scrollIntoViewIfNeeded();
  await p.waitForFunction(() => document.getElementById('gelee').getAttribute('aria-valuenow') === '75', null, { timeout: 4000 })
    .catch(() => {});
  ok('sichtbar geworden, fuellt es sich vor', await p.getAttribute('#gelee', 'aria-valuenow') === '75');
  await p.click('#geleePlus');
  ok('eine Runde mehr sind 25', await p.getAttribute('#gelee', 'aria-valuenow') === '100');
  await p.waitForFunction(() => /^Stufe/.test(document.getElementById('toast').textContent), null, { timeout: 4000 })
    .catch(() => {});
  ok('voll wird gefeiert', await meldung(p) === 'Stufe 2: Kurzer Draht!', await meldung(p));
  await p.waitForTimeout(1600);
  ok('danach geht es zur naechsten Stufe',
     await p.getAttribute('#gelee', 'aria-valuenow') === '0' &&
     await p.textContent('#stufeSatz') === 'Auf dem Weg zu „Dachboden mit Auftrag“',
     await p.getAttribute('#gelee', 'aria-valuenow') + ' / ' + await p.textContent('#stufeSatz'));

  console.log('· Segment');
  await p.locator('.segment__wahl', { hasText: 'Bearbeiten' }).click();
  const bearbeiten = await p.evaluate(() => ({
    wahl: Array.from(document.querySelectorAll('.segment__wahl')).map(w => w.getAttribute('aria-checked')).join(),
    satz: document.getElementById('segmentSatz').textContent
  }));
  ok('ein Klick waehlt', bearbeiten.wahl === 'false,true' && /Dein Zugang/.test(bearbeiten.satz), JSON.stringify(bearbeiten));
  await p.keyboard.press('ArrowRight');
  const pfeil = await p.evaluate(() => ({
    wahl: Array.from(document.querySelectorAll('.segment__wahl')).map(w => w.getAttribute('aria-checked')).join(),
    fokus: document.activeElement.textContent.trim(),
    tab: Array.from(document.querySelectorAll('.segment__wahl')).map(w => w.tabIndex).join()
  }));
  ok('der Pfeil waehlt weiter, im Kreis, und nimmt den Fokus mit',
     pfeil.wahl === 'true,false' && pfeil.fokus === 'Ansehen' && pfeil.tab === '0,-1', JSON.stringify(pfeil));

  console.log('· Abhaken');
  const box = p.locator('.kaestchen__box').first();
  const leer = schatten(await box.evaluate(el => getComputedStyle(el).boxShadow));
  ok('das leere Kaestchen ist eine Mulde', leer.every(s => s.includes('inset')), leer.join(' | '));
  await p.click('.kaestchen >> nth=0');
  const voll = schatten(await box.evaluate(el => getComputedStyle(el).boxShadow));
  ok('abgehakt tritt es als Knete hervor',
     await p.locator('.kaestchen__feld').first().isChecked() && voll.some(s => !s.includes('inset')), voll.join(' | '));

  console.log('· Zaehler und Klumpen');
  await p.click('[data-schritt="1"]');
  ok('ein Tag mehr', await p.textContent('#zaehlerWert') === '4' &&
     await p.textContent('#zaehlerSatz') === 'Die Leiter ist seit 4 Tagen unterwegs.');
  for (let i = 0; i < 5; i++) { await p.click('[data-schritt="-1"]'); }
  ok('nicht unter null', await p.textContent('#zaehlerWert') === '0' &&
     await p.textContent('#zaehlerSatz') === 'Die Leiter ist wieder da.');
  await p.fill('#nameFeld', 'Mia');
  ok('aus dem Namen wird ein Klumpen', await p.textContent('#klumpen') === 'M' &&
     await p.textContent('#nameSatz') === 'Liste von Mia');
  await p.press('#nameFeld', 'Enter');
  ok('die Eingabetaste formt ihn fertig', await p.textContent('#nameSatz') === 'Hallo Mia. Dein Klumpen ist fertig geformt.');
  await p.fill('#nameFeld', '<b>x</b>');
  ok('Eingaben bleiben Text', await p.textContent('#nameSatz') === 'Liste von <b>x</b>' &&
     await p.locator('#nameSatz b').count() === 0);

  /* == Leihliste, Farben, Preis, Fragen =================================== */

  console.log('· Leihliste');
  const leiterEintrag = p.locator('.eintrag', { hasText: 'Leiter' });
  await leiterEintrag.locator('[role="switch"]').click();
  ok('die Leiter ist wieder da', await meldung(p) === 'Leiter ist wieder da.' &&
     !(await leiterEintrag.evaluate(el => el.classList.contains('ist-verliehen'))) &&
     await leiterEintrag.locator('.zustand').textContent() === 'Verfügbar');
  ok('und wird mitgezaehlt', await p.textContent('#freiZahl') === '4 gerade frei', await p.textContent('#freiZahl'));
  await p.click('[data-anfrage="die Bohrmaschine"]');
  await p.waitForTimeout(100);
  ok('"Anfragen" kopiert den Anfragetext',
     (await p.evaluate(() => window.__kopiert)).pop() === 'Hallo Mia, ich möchte die Bohrmaschine ausleihen. Passt das bei Dir?' &&
     await meldung(p) === 'Anfragetext kopiert.');

  console.log('· Farben');
  await p.click('.farbe[data-hex="#FFB3C6"]');
  await p.waitForTimeout(100);
  ok('ein Klecks legt seinen Farbwert ab', (await p.evaluate(() => window.__kopiert)).pop() === '#FFB3C6' &&
     await meldung(p) === 'Kaugummi #FFB3C6 liegt in der Zwischenablage.', await meldung(p));

  console.log('· Preis');
  await p.click('#preisSchalter');
  ok('jaehrlich umgelegt', await p.textContent('#preisJe') === 'je Jahr' &&
     await p.locator('#preisJahr.ist-aktiv').count() === 1 && await p.locator('#preisMonat.ist-aktiv').count() === 0);

  console.log('· Fragen');
  await p.click('#fk1');
  await p.waitForTimeout(80);
  const unterwegs = await p.evaluate(() => {
    const f = document.getElementById('fa1');
    return { versteckt: f.hidden, hoehe: f.style.height, voll: f.scrollHeight };
  });
  ok('die Klappe federt auf', await p.getAttribute('#fk1', 'aria-expanded') === 'true' && !unterwegs.versteckt &&
     parseFloat(unterwegs.hoehe) > 0 && parseFloat(unterwegs.hoehe) < unterwegs.voll + 40, JSON.stringify(unterwegs));
  await p.waitForTimeout(1500);
  ok('und kommt offen zur Ruhe', await p.evaluate(() => {
    const f = document.getElementById('fa1');
    return f.style.height === '' && !f.hidden && f.offsetHeight > 20;
  }));
  await p.click('#fk1');
  await p.waitForTimeout(1500);
  ok('zu ist sie wieder verborgen', await p.getAttribute('#fk1', 'aria-expanded') === 'false' &&
     await p.locator('#fa1').isHidden());

  ok('keine Ausnahme im ganzen Rundgang', fehler.length === 0, fehler.join(' | '));
  ok('und kein Verstoss gegen die Richtlinie', (await p.evaluate(() => window.__csp)).length === 0);
  await ctx.close();
}

/* == Schmal und dunkel ==================================================== */

console.log('· Schmal und dunkel');
for (const [breite, hoehe, schema] of [[360, 740, 'light'], [390, 844, 'dark'], [1280, 900, 'dark']]) {
  const { ctx, p, fehler } = await oeffne({ viewport: { width: breite, height: hoehe }, colorScheme: schema });
  await p.evaluate(() => document.querySelectorAll('.zeige').forEach(e => e.classList.add('da')));
  await p.waitForTimeout(900);
  const raus = await p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const liste = [];
    document.querySelectorAll('body *').forEach(el => {
      if (el.closest('.vorrat') || el.id === 'konfetti') { return; }
      const q = el.getBoundingClientRect();
      if (q.width && q.height && (q.right > W + 1 || q.left < -1)) {
        liste.push(el.id || el.tagName.toLowerCase() + '.' + String(el.getAttribute('class') || ''));
      }
    });
    return { liste, sw: document.documentElement.scrollWidth, W };
  });
  ok(breite + ' ' + schema + ': nichts ragt ueber den Rand', raus.liste.length === 0 && raus.sw <= raus.W,
     raus.liste.slice(0, 5).join(', ') + ' / ' + raus.sw);
  if (schema === 'dark') {
    const dunkel = await p.evaluate(() => ({
      grund: getComputedStyle(document.body).backgroundColor,
      flieder: getComputedStyle(document.querySelector('.farbe[data-hex="#F7F1FF"] .farbe__klecks')).backgroundColor
    }));
    ok(breite + ' dunkel: dunkler Grund', dunkel.grund === 'rgb(28, 23, 40)', dunkel.grund);
    ok(breite + ' dunkel: der Klecks "Flieder" zeigt seinen Farbwert', dunkel.flieder === 'rgb(247, 241, 255)', dunkel.flieder);
  }
  ok(breite + ' ' + schema + ': ohne Ausnahme', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

/* == Ruhe ================================================================== */

/** Laufende Keyframe-Animationen; Uebergaenge zaehlen nicht, sie sind kurz. */
const laufend = (p) => p.evaluate(() =>
  document.getAnimations().filter(a => a instanceof CSSAnimation && a.playState === 'running').length);

console.log('· Ruhe aus dem System');
{
  const { ctx, p, fehler } = await oeffne({ reducedMotion: 'reduce' });
  ok('die Seite haelt sich fuer ruhig', await p.evaluate(() => document.documentElement.classList.contains('ruhig')));
  ok('keine Daueranimation', await laufend(p) === 0, String(await laufend(p)));
  await zuEinemDing(p, 'zelt').click();
  await p.waitForTimeout(120);
  ok('ein Ding springt nicht', await ruht(p, '[data-ding="zelt"] .ding__feder'));
  ok('und es fliegt kein Konfetti', await konfettiPunkte(p) === 0);
  ok('die Meldung bleibt', await meldung(p) === 'Ein Zelt. Damit verleihst Du ein Wochenende.', await meldung(p));
  await p.click('#fk2');
  ok('eine Frage oeffnet ohne Federweg', await p.evaluate(() => {
    const f = document.getElementById('fa2');
    return !f.hidden && f.style.height === '';
  }));

  /* Ruhig fuellt sich das Gelee sofort; so laesst sich die ganze Leiter der
     Stufen abgehen. Nach der letzten geht es mit der zweiten weiter, nicht
     mit "Erste Runde": Die hat man schon. */
  await p.locator('#gelee').scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const gefeiert = [];
  for (let stufe = 0; stufe < 5; stufe++) {
    await p.click('#geleeNull');
    for (let i = 0; i < 4; i++) { await p.click('#geleePlus'); }
    await p.waitForFunction(() => /^Stufe/.test(document.getElementById('toast').textContent), null, { timeout: 3000 })
      .catch(() => {});
    gefeiert.push(await meldung(p));
    await p.evaluate(() => { document.getElementById('toast').textContent = ''; });
    await p.waitForTimeout(1300);
  }
  ok('fuenf Stufen werden gefeiert, bis zur letzten',
     gefeiert.join(' | ') === 'Stufe 2: Kurzer Draht! | Stufe 3: Dachboden mit Auftrag! | Stufe 4: Ehrenamt für alles! | ' +
       'Stufe 5: Kreisverleihamt! | Stufe 6: Wandelnde Leihstation!', gefeiert.join(' | '));
  ok('danach beginnt die Leiter wieder bei der zweiten', await p.textContent('#stufeSatz') === 'Auf dem Weg zu „Kurzer Draht“',
     await p.textContent('#stufeSatz'));
  ok('ohne Ausnahme', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

console.log('· Ruhe aus der Anwendung');
{
  const { ctx, p, fehler } = await oeffne({ reducedMotion: 'no-preference' },
    () => { try { localStorage.setItem('lid.ruhig', '1'); } catch (e) { /* privat */ } });
  ok('lid.ruhig genuegt', await p.evaluate(() => document.documentElement.classList.contains('ruhig')));
  ok('keine Daueranimation', await laufend(p) === 0, String(await laufend(p)));
  await zuEinemDing(p, 'waffel').click();
  await p.waitForTimeout(120);
  ok('kein Konfetti', await konfettiPunkte(p) === 0);
  ok('ohne Ausnahme', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

console.log('· Gegenprobe: ohne Ruhe bewegt es sich');
{
  const { ctx, p } = await oeffne({ reducedMotion: 'no-preference' });
  ok('nicht ruhig', !(await p.evaluate(() => document.documentElement.classList.contains('ruhig'))));
  ok('die Daueranimationen laufen', await laufend(p) > 5, String(await laufend(p)));
  await ctx.close();
}

await br.close();
process.exit(bilanz());
