/*
 * Herkunft: Die Schnittstelle schreibt nur fuer die eigene Seite, und sie
 * liest nur fuer sie.
 *
 * Ein fetch mit mode 'no-cors' und Content-Type text/plain braucht keine
 * Vorabanfrage, ein Formular mit enctype="text/plain" auch nicht. Bis zur
 * Pruefung in api.php (same_origin_only, require_json) nahm die
 * Schnittstelle beides an: Eine fremde Seite legte im Browser ihrer
 * Besucher:innen Listen an, ohne die Antwort je lesen zu muessen.
 *
 * Die fremde Seite liegt auf einem eigenen kleinen Server, nicht hinter
 * page.route, und zwar auf der Loopback-Adresse wie die Anwendung: Aus einer
 * oeffentlichen Herkunft sperrt Chromium Anfragen ins lokale Netz von sich
 * aus, und dann pruefte die Suite Chromium und nicht die Schnittstelle.
 * Deshalb wird auch jedes Mal nachgesehen, dass die Anfrage beim Server
 * ankam und was er antwortete. Die fremde Seite sieht den Status nicht,
 * Playwright schon.
 *
 * Zwei fremde Herkuenfte: derselbe Rechnername auf anderem Port (same-site,
 * dort entscheidet der Origin) und der andere Name der Loopback-Adresse
 * (cross-site, dort schon Sec-Fetch-Site). Erwartet BASE auf 127.0.0.1
 * oder localhost, wie jede Suite hier.
 *
 * Erwartet wird in beiden genau 403 cross_origin, nicht irgendeine
 * Abweisung; beim fetch no-cors zaehlt allein der Status (bei antwortAuf).
 * Ein 415 kaeme von require_json() auch dann, wenn keiner der beiden Riegel
 * davor griffe, weil der Browser etwa keinen Origin schickt. api-test.php
 * setzt die Kopfzeilen selbst; nur hier schickt sie Chromium, und nur hier
 * faellt eine falsche Annahme darueber auf, was es schickt.
 *
 * Beim Lesen dasselbe fuer ein Bild und fuer fetch, im Modus no-cors und
 * cors (own_origin_read_only): Ein Abruf von fremder Seite verbraucht sonst
 * das Lesekontingent ihrer Besucher:innen. Gelesen wird eine Liste, die es
 * nicht gibt; 404 heisst also, der Abruf kam durch und wurde gezaehlt, 403,
 * er wurde vorher abgewiesen. Hier ist auch der gleiche Rechner auf anderem
 * Port fremd, obwohl same-site: Beim Bild schickt der Browser keinen
 * Origin.
 *
 * Wer die Suite einzeln startet, setzt vorher data/throttle zurueck; sie
 * legt eine Liste an.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const { ok, bilanz } = pruefer();
const API = BASE + '/api.php';
const ZIEL = new URL(BASE);

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** Ein gueltiger Anlegeauftrag, wie ihn auch die Anwendung schickt. */
function auftrag() {
  const id = randomBytes(16).toString('hex');
  const proof = b64u(createHash('sha256').update(b64u(randomBytes(24))).digest());
  return { id, proof, body: { a: 'create', id, proof, payload: { iv: b64u(randomBytes(12)), ct: b64u(Buffer.from('fremd')) } } };
}

/** Gibt es die Liste? Gefragt wird von Node aus, ohne Origin. */
async function lesestatus(id) {
  return (await fetch(API + '?a=read&id=' + id)).status;
}

/* Die fremde Seite: nichts als ein Rahmen, in den das Formular zielt. */
const fremd = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>Fremde Seite</title><iframe name="ziel"></iframe>');
});
await new Promise((fertig) => fremd.listen(0, '127.0.0.1', fertig));
const port = fremd.address().port;
const andererName = ZIEL.hostname === 'localhost' ? '127.0.0.1' : 'localhost';

const HERKUENFTE = [
  { name: 'gleicher Rechner, anderer Port', url: 'http://' + ZIEL.hostname + ':' + port + '/', site: 'same-site' },
  { name: 'anderer Rechnername', url: 'http://' + andererName + ':' + port + '/', site: 'cross-site' }
];

const br = await starteBrowser();

/** Loest in der Seite p eine Anfrage aus und wartet auf die Antwort von
    api.php: Status und Fehlercode, etwa "403 cross_origin". "0" heisst:
    Beim Server kam nichts an. Den Koerper einer Antwort im Modus no-cors
    behaelt Chromium nicht, auch nicht fuer Playwright; dort bleibt es beim
    Status, etwa "403 ?". */
async function antwortAuf(p, ausloesen) {
  const warte = p.waitForResponse((r) => r.url() === API && r.request().method() === 'POST', { timeout: 8000 })
    .catch(() => null);
  await ausloesen();
  const r = await warte;
  if (!r) { return '0'; }
  const body = await r.json().catch(() => ({ error: '?' }));
  return r.status() + ' ' + (body.error || '-');
}

/** Wie antwortAuf, fuer einen Abruf von ?a=read&id=<id> als Bild oder mit
    fetch: Status und Sec-Fetch-Site, etwa "403 cross-site". Ein Bild mit
    JSON darin verwirft Chromium (ORB), eine cors-Antwort ohne
    Access-Control-Allow-Origin ebenso, und Playwright sieht dann keine
    Antwort. Die Chrome-Schnittstelle sieht sie, mit dem Status, den der
    Server schickte. Ohne eval, denn die eigene Seite verbietet es (CSP). */
const sitzungen = new WeakMap();
async function leseAntwort(p, id, wie) {
  const url = API + '?a=read&id=' + id;
  if (!sitzungen.has(p)) {
    const cdp = await p.context().newCDPSession(p);
    const s = { urls: {}, site: {}, status: {}, warten: [] };
    cdp.on('Network.requestWillBeSent', (e) => { s.urls[e.requestId] = e.request.url; });
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
      s.site[e.requestId] = e.headers['Sec-Fetch-Site'] || e.headers['sec-fetch-site'] || '-';
    });
    cdp.on('Network.responseReceivedExtraInfo', (e) => {
      s.status[e.requestId] = e.statusCode;
      s.warten.forEach((w) => w());
    });
    await cdp.send('Network.enable');
    sitzungen.set(p, s);
  }
  const s = sitzungen.get(p);
  const gefunden = () => Object.keys(s.status).find((rid) => s.urls[rid] === url);
  const fertig = new Promise((ja) => {
    const w = () => { if (gefunden()) { ja(); } };
    s.warten.push(w);
    setTimeout(ja, 8000);
  });
  await p.evaluate(({ url, wie }) => {
    if (wie === 'ein Bild') { const b = new Image(); b.src = url; return; }
    fetch(url, wie === 'fetch no-cors' ? { mode: 'no-cors' } : {}).catch(() => null);
  }, { url, wie });
  await fertig;
  const rid = gefunden();
  return rid ? s.status[rid] + ' ' + s.site[rid] : '0';
}

for (const h of HERKUENFTE) {
  console.log('· ' + h.name + ' (' + h.url + ')');
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(h.url);

  /* 1 · fetch ohne cors, als text/plain */
  const a = auftrag();
  const statusFetch = await antwortAuf(p, () => p.evaluate(({ api, body }) => fetch(api, {
    method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body)
  }).then(() => 'gesendet', () => 'abgewiesen'), { api: API, body: a.body }));
  /* Der Koerper ist hier nicht lesbar (bei antwortAuf). Es genuegt der
     Status: Beim Anlegen kommt 403 allein aus same_origin_only(),
     require_json() antwortete mit 415. */
  ok('fetch no-cors kommt beim Server an und endet in 403',
     /^403 (cross_origin|\?)$/.test(statusFetch), statusFetch);
  const nachFetch = await lesestatus(a.id);
  ok('danach gibt es die Liste nicht', nachFetch === 404, 'read ' + nachFetch);

  /* 2 · Formular mit enctype text/plain. Feldname und Wert ergeben mit dem
     "=" dazwischen ein JSON-Objekt: {..., "x":"="} */
  const f = auftrag();
  const statusForm = await antwortAuf(p, () => p.evaluate(({ api, body }) => {
    const json = JSON.stringify(body);
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = api;
    form.enctype = 'text/plain';
    form.target = 'ziel';
    const feld = document.createElement('input');
    feld.type = 'hidden';
    feld.name = json.slice(0, -1) + ',"x":"';
    feld.value = '"}';
    form.appendChild(feld);
    document.body.appendChild(form);
    form.submit();
  }, { api: API, body: f.body }));
  ok('Formular text/plain kommt beim Server an und endet in 403 cross_origin',
     statusForm === '403 cross_origin', statusForm);
  const nachForm = await lesestatus(f.id);
  ok('danach gibt es auch diese Liste nicht', nachForm === 404, 'read ' + nachForm);

  /* 3 · Mit application/json braucht es eine Vorabanfrage, und die
     beantwortet api.php nicht. Das galt schon vorher; es steht hier, weil
     es der Grund ist, warum der Inhaltstyp die Grenze zieht. */
  const j = auftrag();
  const ergebnis = await p.evaluate(({ api, body }) => fetch(api, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(() => 'gesendet', () => 'abgewiesen'), { api: API, body: j.body });
  ok('fetch mit application/json scheitert an der Vorabanfrage', ergebnis === 'abgewiesen', ergebnis);
  const nachJson = await lesestatus(j.id);
  ok('und legt nichts an', nachJson === 404, 'read ' + nachJson);

  /* 4 · Lesen, als Bild und mit fetch in beiden Modi */
  for (const wie of ['ein Bild', 'fetch no-cors', 'fetch cors']) {
    const status = await leseAntwort(p, randomBytes(16).toString('hex'), wie);
    ok('Lesen über ' + wie + ' kommt beim Server an und endet in 403 (' + h.site + ')', status === '403 ' + h.site, status);
  }

  await ctx.close();
}

/* Die Gegenprobe von der eigenen Seite: Dieselbe Anfrage, wie apiPost sie
   stellt, kommt durch. Die eigenen Seiten setzen Referrer-Policy
   no-referrer; nachgesehen wird, dass der Browser trotzdem die echte
   Herkunft schickt und nicht "null" — sonst wiese api.php die eigene
   Anwendung ab. */
console.log('· eigene Seite (' + BASE + ')');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const e = auftrag();
  const anfrage = p.waitForRequest((r) => r.url() === API && r.method() === 'POST', { timeout: 8000 });
  const status = await p.evaluate((body) => fetch('api.php', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body)
  }).then((r) => r.status), e.body);
  const origin = await (await anfrage).headerValue('origin');
  ok('der Browser schickt die eigene Herkunft', origin === ZIEL.origin, String(origin));
  ok('Anlegen von der eigenen Seite → 200', status === 200, 'Status ' + status);
  const nachEigen = await lesestatus(e.id);
  ok('und die Liste steht auf dem Server', nachEigen === 200, 'read ' + nachEigen);
  const weg = await p.evaluate((arg) => fetch('api.php', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'delete', id: arg.id, proof: arg.proof })
  }).then((r) => r.status), { id: e.id, proof: e.proof });
  ok('Loeschen von der eigenen Seite → 200', weg === 200, 'Status ' + weg);
  /* Und das Lesen: als Bild und mit fetch, wie apiGet. Die Liste gibt es
     nicht mehr, durch heisst also 404. */
  for (const wie of ['ein Bild', 'fetch cors']) {
    const status = await leseAntwort(p, e.id, wie);
    ok('Lesen über ' + wie + ' von der eigenen Seite kommt durch', status === '404 same-origin', status);
  }
  await ctx.close();
}

await br.close();
fremd.close();
process.exit(bilanz());
