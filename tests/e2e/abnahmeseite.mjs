/*
 * Wie die Abnahme (check.html) ihr Ergebnis zeigt.
 *
 * Bis November 2026 hatten fuenf Klassen, die check.js an die Zeilen haengt,
 * keine Regel in style.css: Stufe, Name, Erlaeuterung und Zustand standen
 * untereinander, in der Stufe stand ein leerer Punkt, und "fehlt" sah aus
 * wie "ok". Jetzt eine Zeile je Pruefung, und was fehlt, mahnt in Butter
 * (--warn-ink), auch die Zusammenfassung bei einem Muss-Verstoss.
 *
 * Gegen den eingebauten Server fehlt vieles (kein https, keine .htaccess);
 * das ist hier gewollt, denn gesucht sind Zeilen beider Zustaende.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

for (const [schema, breite] of [['light', 1000], ['dark', 1000], ['light', 390]]) {
  console.log('· ' + schema + ', ' + breite + ' Punkte');
  const ctx = await br.newContext({ viewport: { width: breite, height: 900 }, colorScheme: schema });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  await p.goto(BASE + '/check.html', { waitUntil: 'networkidle' });
  await p.locator('#btnRun').click();
  await p.waitForFunction(() => document.querySelector('#btnRun').textContent === 'Erneut pruefen',
    null, { timeout: 60000 });

  const befund = await p.evaluate(() => {
    const farbe = (name) => {
      const d = document.createElement('div');
      d.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c;
    };
    const butter = farbe('--warn-ink');
    const zeilen = Array.from(document.querySelectorAll('#results .check-row'));
    let schief = 0, leer = 0, fehltFalsch = 0, okFalsch = 0, fehlt = 0, okZahl = 0;
    const anfaenge = new Set();
    zeilen.forEach((li) => {
      const chip = li.querySelector('.chip').getBoundingClientRect();
      const text = li.querySelector('.check-text').getBoundingClientRect();
      const zust = li.querySelector('.check-state');
      const z = zust.getBoundingClientRect();
      /* Eine Zeile: Stufe links, Text daneben, Zustand rechts davon, alle
         beginnen auf derselben Hoehe. */
      if (!(chip.right <= text.left + 1 && text.right <= z.left + 1 && Math.abs(chip.top - text.top) < 12 && Math.abs(z.top - text.top) < 12)) { schief++; }
      anfaenge.add(Math.round(text.left));
      leer += Array.from(li.querySelectorAll('*')).filter((e) => !e.textContent.trim()).length;
      const c = getComputedStyle(zust).color;
      if (zust.textContent === 'fehlt') { fehlt++; if (c !== butter) { fehltFalsch++; } }
      if (zust.textContent === 'ok') { okZahl++; if (c === butter) { okFalsch++; } }
    });
    /* Jede Klasse im Ergebnis und an der Zusammenfassung hat eine Regel. */
    const regeln = [];
    const sammeln = (liste) => Array.from(liste).forEach((r) => {
      if (r.selectorText) { regeln.push(r.selectorText); }
      if (r.cssRules) { sammeln(r.cssRules); }
    });
    Array.from(document.styleSheets).forEach((s) => { try { sammeln(s.cssRules); } catch (e) { /* fremd */ } });
    const klassen = new Set();
    document.querySelectorAll('#results *, #summary').forEach((e) => e.classList.forEach((k) => klassen.add(k)));
    const ohneRegel = Array.from(klassen).filter((k) => !regeln.some((t) => new RegExp('\\.' + k + '(?![\\w-])').test(t)));
    const summary = document.querySelector('#summary');
    return { zeilen: zeilen.length, schief, leer, anfaenge: Array.from(anfaenge), fehlt, okZahl, fehltFalsch, okFalsch, ohneRegel,
      summaryText: summary.textContent, summaryFarbe: getComputedStyle(summary).color, butter };
  });
  ok('es gibt Zeilen, mit und ohne Fehlen', befund.zeilen > 20 && befund.fehlt > 0 && befund.okZahl > 0,
     befund.zeilen + ' Zeilen, ' + befund.fehlt + ' fehlt, ' + befund.okZahl + ' ok');
  ok('jede Pruefung steht in einer Zeile', befund.schief === 0, befund.schief + ' schief');
  ok('der Text beginnt in jeder Zeile an derselben Stelle', befund.anfaenge.length === 1, befund.anfaenge.join(', '));
  ok('kein leeres Element in den Zeilen', befund.leer === 0, String(befund.leer));
  ok('"fehlt" in --warn-ink', befund.fehltFalsch === 0, befund.fehltFalsch + ' von ' + befund.fehlt + ', soll ' + befund.butter);
  ok('"ok" nicht in --warn-ink', befund.okFalsch === 0, String(befund.okFalsch));
  ok('jede Klasse hat eine Regel', befund.ohneRegel.length === 0, befund.ohneRegel.join(', '));
  ok('Muss-Verstoss: Zusammenfassung in --warn-ink', /Muss-Punkt/.test(befund.summaryText) && befund.summaryFarbe === befund.butter,
     befund.summaryFarbe + ' · ' + befund.summaryText.slice(0, 40));
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
