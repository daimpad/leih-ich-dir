/*
 * Laeuft ueber alle Suiten in diesem Verzeichnis und meldet eine Bilanz.
 *
 *   node tests/e2e/lauf.mjs                  alle
 *   node tests/e2e/lauf.mjs kreis anfrage    nur passende
 *
 * Erwartet eine laufende Anwendung unter LID_BASE (Vorgabe
 * http://127.0.0.1:8099). Wie man sie startet, steht in README.md daneben.
 *
 * Zwischen den Suiten wird die Ratenbegrenzung des Servers zurueckgesetzt:
 * Jede Suite legt Listen an, und nach zwanzig in einer Stunde antwortet
 * api.php mit 429. Ohne dieses Aufraeumen scheitert ab der dritten Suite
 * alles, und zwar aus einem Grund, der mit dem Geprueften nichts zu tun hat.
 *
 * Jede Suite hat eine Frist, LID_FRIST Sekunden (Vorgabe 300). Bis November
 * 2026 hatte sie keine: Blieb eine haengen, etwa an einem waitForFunction
 * ohne timeout, stand die ganze Batterie, und in der Action brach erst die
 * Grenze des Jobs (30 Minuten) ab, ohne Bilanz und ohne zu sagen, welche
 * Suite es war. Jetzt wird die Suite samt ihrem Browser beendet, als offen
 * gezaehlt, und die naechste laeuft. Hinter jeder Bilanz steht die Dauer.
 */
import { readdirSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
const DATEN = process.env.LEIH_DATA_DIR || join(HIER, '..', '..', 'data');
const filter = process.argv.slice(2);
const FRIST = Math.max(1, Number(process.env.LID_FRIST) || 300);

const suiten = readdirSync(HIER)
  .filter(n => n.endsWith('.mjs') && n !== 'lauf.mjs' && n !== 'hilfe.mjs')
  .filter(n => !filter.length || filter.some(f => n.includes(f)))
  .sort();

if (!suiten.length) {
  console.error('Keine Suite gefunden' + (filter.length ? ' fuer: ' + filter.join(', ') : ''));
  process.exit(1);
}

function drossellungLoeschen() {
  const d = join(DATEN, 'throttle');
  if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); }
}

/* Die Suite laeuft in einer eigenen Prozessgruppe (detached). Bei
   abgelaufener Frist geht das Signal an die ganze Gruppe und erreicht so
   auch, was die Suite selbst startet, etwa php in abnahme.mjs. Chromium
   startet Playwright in einer eigenen Gruppe; er beendet sich, sobald die
   Leitung zur Suite abreisst. Nachgestellt mit einer haengenden Suite:
   drei Sekunden nach der Frist lief von ihr nichts mehr. */
function lauf(datei) {
  return new Promise((fertig) => {
    const beginn = Date.now();
    const kind = spawn(process.execPath, [join(HIER, datei)], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let aus = '';
    let verstrichen = false;
    kind.stdout.on('data', d => { aus += d; });
    kind.stderr.on('data', d => { aus += d; });
    const wache = setTimeout(() => {
      verstrichen = true;
      try { process.kill(-kind.pid, 'SIGKILL'); } catch (e) { kind.kill('SIGKILL'); }
    }, FRIST * 1000);
    kind.on('close', (code) => {
      clearTimeout(wache);
      fertig({ code: verstrichen ? 1 : code, aus, verstrichen, sekunden: Math.round((Date.now() - beginn) / 1000) });
    });
  });
}

let offen = 0, gescheitert = [];
for (const s of suiten) {
  drossellungLoeschen();
  const { code, aus, verstrichen, sekunden } = await lauf(s);
  const bilanz = (aus.match(/^\d+ erfuellt, \d+ offen$/m) || aus.match(/^\d+ (?:erfüllt|bestanden), \d+ offen$/m) || [''])[0];
  const zeile = verstrichen ? 'nach ' + FRIST + ' s beendet (Frist, LID_FRIST)'
    : (bilanz || (code === 0 ? 'durchgelaufen' : 'abgebrochen')) + '  (' + sekunden + ' s)';
  console.log(String(s).padEnd(22) + zeile);
  if (code !== 0) {
    offen++;
    gescheitert.push(s);
    aus.split('\n').filter(z => /FEHLT|Error/.test(z)).slice(0, 6).forEach(z => console.log('    ' + z.trim()));
  }
}

console.log('\n' + suiten.length + ' Suiten, ' + offen + ' mit offenen Punkten');
if (gescheitert.length) { console.log('offen: ' + gescheitert.join(', ')); }
process.exit(offen ? 1 : 0);
