/*
 * Hinter dem Feld "Gegenstand" liegt ruhend keine eigene Flaeche.
 *
 * Schmal klebt die Eingabe (.addbox) oben. Bis November 2026 trug sie dafuer
 * immer einen glatten Grund in --surface, auch ruhend. Die Karte darunter
 * traegt aber den Lichtfleck der Knete; im Dunkeln hob er sie um rund zehn
 * Werte je Kanal an, und hinter Feld und "Mehrere auf einmal" stand ein
 * dunkleres Rechteck. Jetzt traegt die Eingabe ihren Grund nur, solange sie
 * klebt (scroll-state), und dann deckt er die Zeilen darunter.
 *
 * Geprueft wird an den berechneten Farben und an Bildpunkten: ruhend
 * weder die Eingabe noch ihr ::before mit Farbe, klebend das ::before
 * undurchsichtig, so gross wie die Eingabe und ueber den Zeilen.
 * Laeuft nur, wo der Browser scroll-state kennt; sonst bleibt der alte Weg,
 * und der wird nur auf seinen Grund geprueft.
 */
import { starteBrowser, BASE, pruefer, macheListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ding = (id, name) => ({ id, name, note: '', status: 'available', borrower: '', since: '' });
const durchsichtig = (c) => /rgba\(0, 0, 0, 0\)|transparent/.test(c);

for (const schema of ['dark', 'light']) {
  console.log('· ' + schema + ', 390 Punkte');
  const ctx = await br.newContext({ viewport: { width: 390, height: 664 }, colorScheme: schema });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const sachen = [];
  for (let i = 0; i < 14; i++) { sachen.push(ding('d' + i, 'Ding ' + i)); }
  const l = await macheListe(p, L('Werkstatt', 'Ich', sachen));
  await p.goto(BASE + '/?d=' + schema + '#e=' + l.id + '.' + l.keyStr + '.' + l.token, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);

  const lage = () => p.evaluate(() => {
    const box = document.querySelector('.addbox');
    return {
      kann: CSS.supports('container-type', 'scroll-state'),
      klebt: getComputedStyle(box).position === 'sticky',
      grund: getComputedStyle(box).backgroundColor,
      vor: getComputedStyle(box, '::before').backgroundColor,
      surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
    };
  });

  const ruhend = await lage();
  ok('die Eingabe klebt schmal', ruhend.klebt);
  if (!ruhend.kann) {
    ok('ohne scroll-state: der alte Grund deckt', !durchsichtig(ruhend.grund), ruhend.grund);
  } else {
    ok('ruhend: kein eigener Grund', durchsichtig(ruhend.grund), ruhend.grund);
    ok('ruhend: auch das ::before ohne Farbe', durchsichtig(ruhend.vor), ruhend.vor);

    await p.evaluate(() => window.scrollTo(0, 900));
    await p.waitForTimeout(400);
    const klebend = await lage();
    const oben = await p.evaluate(() => Math.round(document.querySelector('.addbox').getBoundingClientRect().top));
    ok('nach dem Rollen steht sie oben', oben === 0, String(oben));
    ok('klebend: das ::before deckt', !durchsichtig(klebend.vor), klebend.vor);
    ok('und zwar in --surface', await p.evaluate((v) => {
      const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c;
    }, klebend.surface) === klebend.vor, klebend.vor);
    /* Der berechnete Wert allein beweist keine Deckung: Ein ::before ohne
       Flaeche haette dieselbe Farbe und deckte nichts. Deshalb die Groesse
       und Bildpunkte. Die Zeilen bekommen dafuer Signalrot; in der
       Polsterung der klebenden Eingabe darf davon nichts zu sehen sein. */
    const masse = await p.evaluate(() => {
      const box = document.querySelector('.addbox');
      const v = getComputedStyle(box, '::before');
      return { pos: v.position, b: parseFloat(v.width), h: parseFloat(v.height),
               boxB: box.getBoundingClientRect().width, boxH: box.getBoundingClientRect().height };
    });
    ok('das ::before ist so gross wie die Eingabe', masse.pos === 'absolute'
       && Math.abs(masse.b - masse.boxB) < 1 && Math.abs(masse.h - masse.boxH) < 1, JSON.stringify(masse));
    /* Ueber das CSSOM, ein Stil-Element liesse die CSP nicht zu. Auch die
       Trennlinien werden rot, sonst traefe ein Punkt knapp ueber einer
       Zeilengrenze die Linie statt der Flaeche. */
    await p.evaluate(() => document.querySelectorAll('#itemList .item, #itemList .itemrow').forEach((n) => {
      n.style.setProperty('background', 'rgb(255, 0, 0)', 'important');
      n.style.setProperty('border-color', 'rgb(255, 0, 0)', 'important');
    }));
    await p.waitForTimeout(150);
    /* Mehrere Punkte in der oberen Polsterung, links und rechts neben dem
       Feld. Jeder muss genau --surface zeigen; eine halb durchsichtige
       Deckung mischte Rot hinein und fiele hier auf, auch wenn kein reines
       Rot zu sehen waere. */
    const punkte = await p.evaluate(() => {
      const r = document.querySelector('.addbox').getBoundingClientRect();
      const out = [];
      for (const x of [r.left + 3, r.left + r.width / 2, r.right - 3]) {
        for (const y of [r.top + 2, r.top + 6]) {
          const X = Math.round(x), Y = Math.round(y);
          out.push({ x: X, y: Y, zeile: document.elementsFromPoint(X, Y).some((e) => e.matches('#itemList .item')) });
        }
      }
      return out;
    });
    ok('unter den Messpunkten liegen Zeilen', punkte.some((q) => q.zeile), JSON.stringify(punkte));
    const soll = await p.evaluate((v) => {
      const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c.match(/\d+/g).slice(0, 3).map(Number);
    }, klebend.surface);
    const abweichung = [];
    for (const q of punkte.filter((q) => q.zeile)) {
      const bild = await p.screenshot({ clip: { x: q.x, y: q.y, width: 1, height: 1 } });
      const farbe = await p.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas'); c.width = 1; c.height = 1;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
      }, bild.toString('base64'));
      if (farbe.some((k, i) => Math.abs(k - soll[i]) > 3)) { abweichung.push(q.x + '/' + q.y + ': ' + farbe.join(',')); }
    }
    ok('klebend: ueber den Zeilen genau --surface', abweichung.length === 0, 'soll ' + soll.join(',') + ' · ' + abweichung.join(' | '));
  }
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
