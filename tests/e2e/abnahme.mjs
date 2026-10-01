/*
 * Die Abnahme und ihr Urteil ueber einen vorgelagerten nginx.
 *
 * check.html und tools/check-deployment.php sollen erkennen, wenn ein nginx
 * statische Dateien selbst ausliefert und dabei keine .htaccess liest: Die
 * PHP-Dateien in tools/ sind dann gesperrt, eine .html-Datei im selben Ordner
 * nicht, und das kann kein einzelner Server erzeugen. Dann soll ein Befund
 * sagen, woran es liegt und was zu tun ist.
 *
 * Warum es diese Suite gibt: Seit tools/.htaccess und tests/.htaccess (14.
 * September) antwortet Apache auf jede PHP-Datei dort mit 403 statt mit 404 —
 * noch bevor die RedirectMatch-Regel der Wurzel-.htaccess zum Zug kommt.
 * Beides wurde als "Selbstsperre des Skripts" gelesen, ein 403 galt als
 * Nicht-Beleg, und der Befund konnte bei genau dem Aufbau nicht mehr
 * ausloesen, fuer den er geschrieben war. Nachgestellt mit Apache 2.4.58 und
 * den echten .htaccess-Dateien: mit den Unterordner-Dateien 403 fuer jede
 * PHP-Datei, auch fuer eine erfundene; ohne sie 404.
 *
 * Die Antworten werden hier vorgegeben und nicht gemessen. Gemessen wird nur,
 * was die Abnahme daraus schliesst. Dieselben Welten laufen durch beide
 * Umsetzungen, den Browser und die Kommandozeile, damit sie nicht
 * auseinanderlaufen: Sie sind zwei Faelle desselben Urteils.
 *
 * Wer die Suite einzeln startet, setzt vorher data/throttle zurueck; jeder
 * Lauf im Browser legt eine Liste an.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BEFUND = 'Ursache der offenen statischen Dateien';
const OFFEN = '/tools/og-vorlage.html';
const ERFUNDEN = '/tools/nicht-vorhanden-abnahme.php';
const KEY = '/data/ai-key.txt';
const ORDNER = { '/data/': 403, '/data/lists/': 403, '/.git/config': 403 };

/* Jede Welt sagt, was ein Server auf die Pfade der Abnahme antwortet, und was
   die Abnahme daraus schliessen muss. */
const WELTEN = [
  {
    name: 'Apache mit Unterordner-Dateien, nginx liefert die .html selbst aus (der Fall vom 1. Oktober)',
    pfade: { ...ORDNER, '/tests/api-test.php': 403, '/tools/purge.php': 403, [ERFUNDEN]: 403, [OFFEN]: 200, [KEY]: 404 },
    befund: true, key: 'ok'
  },
  {
    name: 'alles durch Apache, alles gesperrt',
    pfade: { ...ORDNER, '/tests/api-test.php': 403, '/tools/purge.php': 403, [ERFUNDEN]: 403, [OFFEN]: 403, [KEY]: 403 },
    befund: false, key: 'ok'
  },
  {
    name: 'Stand vor dem 14. September: RedirectMatch allein, nginx liefert die .html selbst aus',
    pfade: { ...ORDNER, '/tests/api-test.php': 404, '/tools/purge.php': 404, [ERFUNDEN]: 404, [OFFEN]: 200, [KEY]: 404 },
    befund: true, key: 'ok'
  },
  {
    /* Kein Apache dahinter: Die Skripte sperren sich selbst, eine erfundene
       Datei gibt es nicht und antwortet mit 404. Hier laesst sich nicht sagen,
       wer die .html ausliefert. Ein Befund waere ein Fehlalarm. */
    name: 'kein Apache: die Skripte sperren sich selbst, die .html ist offen',
    pfade: { ...ORDNER, '/tests/api-test.php': 403, '/tools/purge.php': 403, [ERFUNDEN]: 404, [OFFEN]: 200, [KEY]: 404 },
    befund: false, key: 'ok'
  },
  {
    name: 'der KI-Schluessel liegt offen',
    pfade: { ...ORDNER, '/tests/api-test.php': 403, '/tools/purge.php': 403, [ERFUNDEN]: 403, [OFFEN]: 403, [KEY]: 200 },
    befund: false, key: 'fehlt'
  },
  {
    name: 'der KI-Schluessel ist gesperrt',
    pfade: { ...ORDNER, '/tests/api-test.php': 403, '/tools/purge.php': 403, [ERFUNDEN]: 403, [OFFEN]: 403, [KEY]: 403 },
    befund: false, key: 'ok'
  }
];

const { ok, bilanz } = pruefer();
const br = await starteBrowser();

/** Laesst check.html laufen, mit den vorgegebenen Antworten, und liest die Zeilen. */
async function imBrowser(welt) {
  const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 } });
  const p = await ctx.newPage();
  await p.route('**/*', (route) => {
    const status = welt.pfade[new URL(route.request().url()).pathname];
    if (status !== undefined) {
      return route.fulfill({ status, contentType: 'text/plain', body: '' });
    }
    return route.continue();
  });
  await p.goto(BASE + '/check.html', { waitUntil: 'networkidle' });
  await p.locator('#btnRun').click();
  await p.waitForFunction(() => document.querySelector('#btnRun').textContent === 'Erneut pruefen',
    null, { timeout: 40000 });
  const zeilen = await p.evaluate(() => Array.from(document.querySelectorAll('#results li.item')).map((li) => ({
    name: li.querySelector('.item-name').textContent,
    detail: (li.querySelector('.item-note') || { textContent: '' }).textContent,
    state: li.querySelector('.check-state').textContent
  })));
  await ctx.close();
  return zeilen;
}

/** Laesst tools/check-deployment.php gegen einen Server laufen, der nur antwortet, was vorgegeben ist. */
async function ueberKommandozeile(welt) {
  const server = http.createServer((req, res) => {
    const status = welt.pfade[req.url.split('?')[0]];
    res.writeHead(status !== undefined ? status : 404, { 'Content-Type': 'text/plain' });
    res.end('');
  });
  await new Promise((fertig) => server.listen(0, '127.0.0.1', fertig));
  const port = server.address().port;
  const aus = await new Promise((fertig) => {
    const kind = spawn('php', [join(WURZEL, 'tools', 'check-deployment.php'), 'http://127.0.0.1:' + port],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    kind.stdout.on('data', (d) => { text += d; });
    kind.stderr.on('data', (d) => { text += d; });
    const wache = setTimeout(() => kind.kill(), 60000);
    kind.on('close', () => { clearTimeout(wache); fertig(text); });
  });
  server.close();
  return aus;
}

for (const welt of WELTEN) {
  console.log('· ' + welt.name);

  const z = await imBrowser(welt);
  const befund = z.find((r) => r.name === BEFUND);
  ok('Browser: Der Befund ' + (welt.befund ? 'erscheint' : 'bleibt aus'),
     welt.befund ? !!befund && befund.state === 'fehlt' : !befund,
     befund ? befund.state : 'keine Zeile');
  const key = z.find((r) => r.name === 'nicht abrufbar: data/ai-key.txt');
  ok('Browser: Der KI-Schluessel gilt als ' + (welt.key === 'ok' ? 'nicht abrufbar' : 'offen'),
     !!key && key.state === (welt.key === 'ok' ? 'ok' : 'fehlt'), key ? key.state : 'keine Zeile');
  ok('Browser: Die erfundene PHP-Datei steht als eigene Zeile da',
     z.some((r) => r.name === 'gesperrt: tools/nicht-vorhanden-abnahme.php'));

  const t = await ueberKommandozeile(welt);
  const cliBefund = new RegExp(BEFUND + '\\s+FEHLT').test(t);
  ok('Kommandozeile: Der Befund ' + (welt.befund ? 'erscheint' : 'bleibt aus'), cliBefund === welt.befund,
     cliBefund ? 'Befund da' : 'kein Befund');
  const cliKey = /nicht abrufbar: \/data\/ai-key\.txt\s+(ok|FEHLT)/.exec(t);
  ok('Kommandozeile: Der KI-Schluessel gilt als ' + (welt.key === 'ok' ? 'nicht abrufbar' : 'offen'),
     !!cliKey && cliKey[1] === (welt.key === 'ok' ? 'ok' : 'FEHLT'), cliKey ? cliKey[1] : 'keine Zeile');
}

await br.close();
process.exit(bilanz());
