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
 * Dazu ein zweiter Fall, in dem nicht vorgegeben, sondern die echte
 * Anwendung gefragt wird: ein vorgelagerter Proxy, der Host durchreicht oder
 * umschreibt. api.php vergleicht den Origin einer Schreibanfrage mit dem Host,
 * der bei ihm ankommt; ein Proxy, der ihn umschreibt, sperrt also jedes
 * Speichern aus dem Browser. Die Abnahme soll das mit 403 melden, beide
 * Umsetzungen. Der Browser schickt den Origin ohnehin, check-deployment.php
 * nur, weil es ihn ausdruecklich setzt; ohne ihn ginge dort das Anlegen durch,
 * und der Fehler fiele erst bei Nutzer:innen auf.
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
async function imBrowser(welt, basis = BASE) {
  const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 } });
  const p = await ctx.newPage();
  await p.route('**/*', (route) => {
    const status = welt.pfade[new URL(route.request().url()).pathname];
    if (status !== undefined) {
      return route.fulfill({ status, contentType: 'text/plain', body: '' });
    }
    return route.continue();
  });
  await p.goto(basis + '/check.html', { waitUntil: 'networkidle' });
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
  const aus = await abnahmeGegen('http://127.0.0.1:' + server.address().port);
  server.close();
  return aus;
}

/** Laesst tools/check-deployment.php gegen eine Adresse laufen und gibt die Ausgabe zurueck. */
function abnahmeGegen(url) {
  return new Promise((fertig) => {
    const kind = spawn('php', [join(WURZEL, 'tools', 'check-deployment.php'), url],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    kind.stdout.on('data', (d) => { text += d; });
    kind.stderr.on('data', (d) => { text += d; });
    const wache = setTimeout(() => kind.kill(), 60000);
    kind.on('close', () => { clearTimeout(wache); fertig(text); });
  });
}

/* Ein Proxy vor der laufenden Anwendung, wie nginx vor Apache. Reicht er Host
   durch (proxy_set_header Host $http_host), sieht api.php den Rechner und
   Port, die der Browser angefragt hat. Schreibt er ihn um, wie nginx es bei
   proxy_pass ohne diese Zeile tut, sieht api.php Rechner und Port des Ziels. */
const ZIEL = new URL(BASE);
async function proxy(hostDurchreichen) {
  const server = http.createServer((req, res) => {
    const kopf = { ...req.headers };
    if (!hostDurchreichen) { kopf.host = ZIEL.host; }
    const weiter = http.request({
      hostname: ZIEL.hostname, port: ZIEL.port || 80, path: req.url, method: req.method, headers: kopf
    }, (antwort) => {
      res.writeHead(antwort.statusCode, antwort.headers);
      antwort.pipe(res);
    });
    weiter.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(weiter);
  });
  await new Promise((fertig) => server.listen(0, '127.0.0.1', fertig));
  return server;
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

const ANLEGEN = 'Liste anlegen, data/ ist beschreibbar';
for (const durch of [true, false]) {
  console.log('· Proxy, der Host ' + (durch ? 'durchreicht' : 'umschreibt'));
  const server = await proxy(durch);
  const basis = 'http://127.0.0.1:' + server.address().port;

  const z = await imBrowser({ pfade: {} }, basis);
  const zeile = z.find((r) => r.name === ANLEGEN);
  ok('Browser: Anlegen ' + (durch ? 'gelingt' : 'faellt mit 403 auf'),
     !!zeile && (durch ? zeile.state === 'ok'
                       : zeile.state === 'fehlt' && /Status 403/.test(zeile.detail) && /Host/.test(zeile.detail)),
     zeile ? zeile.state + ' ' + zeile.detail : 'keine Zeile');

  const t = await abnahmeGegen(basis);
  const cli = new RegExp(ANLEGEN + '\\s+(ok|FEHLT)(.*)').exec(t);
  ok('Kommandozeile: Anlegen ' + (durch ? 'gelingt' : 'faellt mit 403 auf'),
     !!cli && (durch ? cli[1] === 'ok' : cli[1] === 'FEHLT' && /Status 403/.test(cli[2]) && /Host/.test(cli[2])),
     cli ? cli[1] + cli[2] : 'keine Zeile');

  server.close();
}

await br.close();
process.exit(bilanz());
