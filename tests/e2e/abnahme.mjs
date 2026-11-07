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
 * Und das Urteil ueber Strict-Transport-Security, wieder mit vorgegebenen
 * Antworten: Die Startseite traegt die Zeile, so wie .htaccess sie setzt,
 * gar nicht, oder mit includeSubDomains oder preload, die der Betrieb nicht
 * will, oder mit einem max-age, das nichts zusagt. Nur die erste Welt ist in
 * Ordnung; fehlt die Zeile, muss die Meldung die wahrscheinlichen Ursachen
 * nennen, und die haengen daran, ob die uebrigen Kopfzeilen ankommen; steht
 * zu viel darin, das Zuviel. Dazu zwei getrennte Zeilen, erst mit
 * includeSubDomains, dann ohne: Der Browser wertet nur die erste aus
 * (RFC 6797, 8.1), das Zuviel gilt also. check.js liest beide
 * zusammengefuegt; behielte check-deployment.php nur die letzte, meldete es
 * ok. Ebenso zwei Zeilen, nur die zweite mit max-age: Das der zweiten
 * zaehlt nicht.
 *
 * Und die Kopfzeilen an Dateien mit Endung. Bis November 2026 sah die
 * Abnahme sie nur an der Startseite, die stets ueber Apache kommt. Auf
 * leihichdir.de lieferte nginx aber einstellungen.html, app.js und
 * style.css selbst aus, ohne Cache-Control und ohne Schutzkopfzeilen, und
 * keine der beiden Umsetzungen sagte etwas. Welten: alles durch Apache,
 * nginx vor den Dateien mit Endung, mod_headers fehlt ganz (dort erklaert
 * schon der alte Befund alles, der neue waere doppelt), eine Startseite
 * ohne Cache-Control, und eine leere Richtlinie an einer Seite.
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
/* Plesk hat zwei Schalter, die nginx statische Dateien selbst ausliefern
   lassen; auf leihichdir.de genuegte das Abschalten des ersten nicht
   (November 2026). Jeder Befund dazu muss beide nennen. */
const BEIDE = /Smart static files processing[\s\S]*Statische Dateien direkt durch nginx bedienen/;
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

/** Ein Server, der nur antwortet, was die Welt vorgibt, sonst 404. Ein Feld
    mit mehreren Werten geht als ebenso viele getrennte Kopfzeilen hinaus. */
async function weltServer(welt) {
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const status = welt.pfade[path];
    res.writeHead(status !== undefined ? status : 404, { 'Content-Type': 'text/plain', ...(welt.kopf || {})[path] });
    res.end('');
  });
  await new Promise((fertig) => server.listen(0, '127.0.0.1', fertig));
  return server;
}

/** Laesst check.html laufen, mit den vorgegebenen Antworten, und liest die Zeilen. */
async function imBrowser(welt, basis = BASE) {
  const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 } });
  const p = await ctx.newPage();
  /* route.fulfill kennt je Feld nur einen Wert. Gibt die Welt zu einem Feld
     mehrere vor, antwortet auf die vorgegebenen Pfade deren Server, mit
     getrennten Zeilen, und der Browser fuegt sie selbst zusammen wie bei
     einer echten Antwort. */
  const getrennt = Object.values(welt.kopf || {}).some((k) => Object.values(k).some(Array.isArray));
  const server = getrennt ? await weltServer(welt) : null;
  await p.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    const status = welt.pfade[path];
    if (status !== undefined && server) {
      return route.continue({ url: 'http://127.0.0.1:' + server.address().port + path });
    }
    if (status !== undefined) {
      return route.fulfill({ status, contentType: 'text/plain', body: '', headers: (welt.kopf || {})[path] });
    }
    return route.continue();
  });
  await p.goto(basis + '/check.html', { waitUntil: 'networkidle' });
  await p.locator('#btnRun').click();
  await p.waitForFunction(() => document.querySelector('#btnRun').textContent === 'Erneut pruefen',
    null, { timeout: 40000 });
  const zeilen = await p.evaluate(() => Array.from(document.querySelectorAll('#results li.check-row')).map((li) => ({
    name: li.querySelector('.item-name').textContent,
    detail: (li.querySelector('.item-note') || { textContent: '' }).textContent,
    state: li.querySelector('.check-state').textContent
  })));
  await ctx.close();
  if (server) { server.close(); }
  return zeilen;
}

/** Laesst tools/check-deployment.php gegen einen Server laufen, der nur antwortet, was vorgegeben ist. */
async function ueberKommandozeile(welt) {
  const server = await weltServer(welt);
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
  ok('Browser: Der Befund ' + (welt.befund ? 'erscheint, mit beiden Plesk-Schaltern' : 'bleibt aus'),
     welt.befund ? !!befund && befund.state === 'fehlt' && BEIDE.test(befund.detail) : !befund,
     befund ? befund.state + ' ' + befund.detail.slice(0, 80) : 'keine Zeile');
  const key = z.find((r) => r.name === 'nicht abrufbar: data/ai-key.txt');
  ok('Browser: Der KI-Schluessel gilt als ' + (welt.key === 'ok' ? 'nicht abrufbar' : 'offen'),
     !!key && key.state === (welt.key === 'ok' ? 'ok' : 'fehlt'), key ? key.state : 'keine Zeile');
  ok('Browser: Die erfundene PHP-Datei steht als eigene Zeile da',
     z.some((r) => r.name === 'gesperrt: tools/nicht-vorhanden-abnahme.php'));

  const t = await ueberKommandozeile(welt);
  const cliBefund = new RegExp(BEFUND + '\\s+FEHLT').test(t) && BEIDE.test(t);
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

const HSTS_WELTEN = [
  { name: 'wie .htaccess', wert: 'max-age=31536000', ok: true, detail: /^max-age=31536000$/ },
  { name: 'fehlt', wert: null, ok: false, detail: /mod_headers.*nginx/ },
  /* Kommt die Content-Security-Policy an, laeuft mod_headers; dann darf die
     Meldung es nicht als Ursache nennen. */
  { name: 'fehlt, die Content-Security-Policy kommt an', wert: null,
    dazu: { 'Content-Security-Policy': "default-src 'self'" }, ok: false,
    detail: /^(?!.*mod_headers)fehlt, obwohl die Content-Security-Policy .*\.htaccess .*HTTPS/ },
  /* max-age=0 hebt HSTS im Browser auf (RFC 6797, 6.1.1), ohne max-age
     gilt die Zeile nicht. */
  { name: 'mit max-age=0', wert: 'max-age=0', ok: false, detail: /^max-age=0: max-age unter einem Jahr,/ },
  { name: 'ohne max-age', wert: 'maxage=31536000', ok: false, detail: /^maxage=31536000: ohne max-age,/ },
  { name: 'mit includeSubDomains', wert: 'max-age=31536000; includeSubDomains', ok: false, detail: /enth(?:ae|ä)lt includeSubDomains,/ },
  { name: 'mit preload', wert: 'max-age=63072000;PRELOAD', ok: false, detail: /enth(?:ae|ä)lt preload,/ },
  /* Zwei getrennte Zeilen. Der Text muss beide nennen, zusammengefuegt mit
     ", " wie in Headers.get(): Sonst hat eine Umsetzung nur eine gelesen. */
  { name: 'in zwei Zeilen, die erste mit includeSubDomains',
    wert: ['max-age=31536000; includeSubDomains', 'max-age=31536000'], ok: false,
    detail: /^max-age=31536000; includeSubDomains, max-age=31536000: enth(?:ae|ä)lt includeSubDomains,/ },
  /* Und umgekehrt beim max-age: Der ersten Zeile fehlt es, die zweite hat
     eins. Der Browser wertet nur die erste aus, HSTS gilt also nicht. */
  { name: 'in zwei Zeilen, nur die zweite mit max-age',
    wert: ['maxage=31536000', 'max-age=31536000'], ok: false,
    detail: /^maxage=31536000, max-age=31536000: ohne max-age,/ }
];
for (const w of HSTS_WELTEN) {
  console.log('· Strict-Transport-Security ' + w.name);
  const welt = { pfade: { '/': 200 },
    kopf: { '/': { ...(w.dazu || {}), ...(w.wert === null ? {} : { 'Strict-Transport-Security': w.wert }) } } };

  const z = await imBrowser(welt);
  const zeile = z.find((r) => r.name === 'Strict-Transport-Security');
  ok('Browser: ' + (w.ok ? 'in Ordnung' : 'Verstoss mit klarem Text'),
     !!zeile && zeile.state === (w.ok ? 'ok' : 'fehlt') && w.detail.test(zeile.detail),
     zeile ? zeile.state + ' ' + zeile.detail : 'keine Zeile');

  const t = await ueberKommandozeile(welt);
  const cli = /SOLL\s+Strict-Transport-Security\s+(ok|FEHLT)\s*(?:\((.*)\))?/.exec(t);
  ok('Kommandozeile: ' + (w.ok ? 'in Ordnung' : 'Verstoss mit klarem Text'),
     !!cli && cli[1] === (w.ok ? 'ok' : 'FEHLT') && w.detail.test(cli[2] || ''),
     cli ? cli[1] + ' ' + (cli[2] || '') : 'keine Zeile');
}

/* -- Kopfzeilen an Dateien mit Endung ------------------------------------- */
const MIT_ENDUNG = ['/style.css', '/app.js', '/theme.js', '/einstellungen.html', '/so-gehts.html',
  '/ueber.html', '/impressum.html', '/datenschutz.html', '/assets/fonts/fonts.css'];
const SCHUTZ = { 'Content-Security-Policy': "default-src 'self'", 'X-Frame-Options': 'DENY' };
const FRISCH = { 'Cache-Control': 'no-cache, must-revalidate' };
const DATEI_BEFUND = 'Ursache der fehlenden Kopfzeilen an Dateien';
const DATEI_WELTEN = [
  { name: 'alles durch Apache', start: { ...SCHUTZ, ...FRISCH },
    datei: (p) => (p.endsWith('.html') ? { ...SCHUTZ, ...FRISCH } : FRISCH),
    befund: false, einstellungen: 'ok', appjs: 'ok' },
  { name: 'nginx liefert Dateien mit Endung selbst aus (leihichdir.de, November 2026)',
    start: { ...SCHUTZ, ...FRISCH }, datei: () => ({}),
    befund: true, einstellungen: 'fehlt', appjs: 'fehlt' },
  { name: 'mod_headers fehlt, auch die Startseite ohne Kopfzeilen', start: {}, datei: () => ({}),
    befund: false, einstellungen: 'fehlt', appjs: 'fehlt' },
  /* Die Startseite traegt die Schutzkopfzeilen, aber kein Cache-Control.
     Der Befund erscheint wegen der Seiten ohne Richtlinie und darf nicht
     behaupten, die Startseite trage Cache-Control (Durchsicht zu #94). */
  { name: 'Startseite ohne Cache-Control, Seiten ohne Schutzkopfzeilen', start: { ...SCHUTZ }, datei: () => ({}),
    befund: true, dateien: 5, einstellungen: 'fehlt', appjs: 'fehlt' },
  /* Eine leere Richtlinie schuetzt nichts; beide Umsetzungen sollen sie
     gleich werten. */
  { name: 'einstellungen.html mit leerer Content-Security-Policy', start: { ...SCHUTZ, ...FRISCH },
    datei: (p) => (p === '/einstellungen.html' ? { ...FRISCH, 'X-Frame-Options': 'DENY', 'Content-Security-Policy': '' }
      : p.endsWith('.html') ? { ...SCHUTZ, ...FRISCH } : FRISCH),
    befund: true, dateien: 1, einstellungen: 'ok', appjs: 'ok', leereCsp: true }
];
for (const w of DATEI_WELTEN) {
  console.log('· Dateien mit Endung: ' + w.name);
  const welt = { pfade: { '/': 200 }, kopf: { '/': w.start } };
  for (const p of MIT_ENDUNG) { welt.pfade[p] = 200; welt.kopf[p] = w.datei(p); }

  const z = await imBrowser(welt);
  /* Die Zeilen unter einer Datei heissen bei jeder Datei gleich. Gesucht
     wird nur in ihrem eigenen Block, den eingerueckten Zeilen bis zur
     naechsten Datei; sonst bestuende eine fehlende Zeile mit der der
     naechsten Datei. */
  const unter = (datei, name) => {
    const i = z.findIndex((r) => r.name === datei);
    if (i < 0) { return null; }
    const ende = z.findIndex((r, j) => j > i && !r.name.startsWith(' '));
    return z.slice(i + 1, ende < 0 ? undefined : ende).find((r) => r.name.trim() === name) || null;
  };
  const xfo = unter('einstellungen.html', 'X-Frame-Options DENY');
  ok('Browser: einstellungen.html X-Frame-Options ' + w.einstellungen, !!xfo && xfo.state === w.einstellungen,
     xfo ? xfo.state + ' ' + xfo.detail : 'keine Zeile');
  const cc = unter('app.js', 'Cache-Control no-cache');
  ok('Browser: app.js Cache-Control ' + w.appjs, !!cc && cc.state === w.appjs, cc ? cc.state + ' ' + cc.detail : 'keine Zeile');
  const anzahl = new RegExp((w.dateien || 9) + ' Datei');
  const bf = z.find((r) => r.name === DATEI_BEFUND);
  ok('Browser: Der Befund ' + (w.befund ? 'erscheint, mit nginx und Plesk' : 'bleibt aus'),
     w.befund ? !!bf && bf.state === 'fehlt' && anzahl.test(bf.detail) && BEIDE.test(bf.detail)
       && !/traegt Cache-Control/.test(bf.detail) : !bf,
     bf ? bf.state + ' ' + bf.detail.slice(0, 120) : 'keine Zeile');
  if (w.leereCsp) {
    const c = unter('einstellungen.html', 'Content-Security-Policy als Kopfzeile');
    ok('Browser: Die leere Richtlinie gilt als fehlend', !!c && c.state === 'fehlt', c ? c.state : 'keine Zeile');
  }

  const t = await ueberKommandozeile(welt);
  /* Ebenso nur der eigene Block: die Zeile der Datei und die eingerueckten
     darunter, bis zur naechsten MUSS-Zeile. */
  const block = (datei) => {
    const zeilen = t.split('\n');
    const i = zeilen.findIndex((l) => new RegExp('^  MUSS  ' + datei.replace(/\./g, '\\.') + ' ').test(l));
    if (i < 0) { return ''; }
    const ende = zeilen.findIndex((l, j) => j > i && !/^  SOLL    /.test(l));
    return zeilen.slice(i, ende < 0 ? undefined : ende).join('\n');
  };
  const cliXfo = /X-Frame-Options DENY\s+(ok|FEHLT)/.exec(block('einstellungen.html'));
  ok('Kommandozeile: einstellungen.html X-Frame-Options ' + w.einstellungen,
     !!cliXfo && cliXfo[1] === (w.einstellungen === 'ok' ? 'ok' : 'FEHLT'), cliXfo ? cliXfo[1] : 'keine Zeile');
  const cliCc = /Cache-Control no-cache\s+(ok|FEHLT)/.exec(block('app.js'));
  ok('Kommandozeile: app.js Cache-Control ' + w.appjs,
     !!cliCc && cliCc[1] === (w.appjs === 'ok' ? 'ok' : 'FEHLT'), cliCc ? cliCc[1] : 'keine Zeile');
  const cliBf = new RegExp(DATEI_BEFUND + '\\s+FEHLT\\s+\\((.*)\\)').exec(t);
  ok('Kommandozeile: Der Befund ' + (w.befund ? 'erscheint, mit nginx und Plesk' : 'bleibt aus'),
     w.befund ? !!cliBf && anzahl.test(cliBf[1]) && BEIDE.test(cliBf[1])
       && !/traegt Cache-Control/.test(cliBf[1]) : !cliBf,
     cliBf ? cliBf[1].slice(0, 120) : 'kein Befund');
  if (w.leereCsp) {
    const c = /Content-Security-Policy als Kopfzeile\s+(ok|FEHLT)/.exec(block('einstellungen.html'));
    ok('Kommandozeile: Die leere Richtlinie gilt als fehlend', !!c && c[1] === 'FEHLT', c ? c[1] : 'keine Zeile');
  }
}

await br.close();
process.exit(bilanz());
