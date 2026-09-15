/*
 * Gemeinsame Bausteine der Browsertests.
 *
 * Die Suiten selbst sind absichtlich schlicht: kein Testrahmen, keine
 * Zusicherungsbibliothek, ein ok() und eine Bilanz. Was hier steht, ist
 * allein das, was sonst in jeder Datei stuende und beim Umzug auf einen
 * anderen Rechner auseinanderliefe.
 *
 * Playwright ist die einzige Abhaengigkeit, und sie gehoert zu den Tests,
 * nicht zur Anwendung: Ausgeliefert wird nichts davon, tests/ ist sowohl
 * ueber .htaccess gesperrt als auch aus der Oberflaechen-Vorschau entfernt.
 */

/** Wo Playwright liegt. Ueberschreibbar, weil der Pfad je nach Installation
    anders lautet: global, in node_modules oder in einem Werkzeugkasten. */
const MODUL = process.env.LID_PLAYWRIGHT
  || '/opt/node22/lib/node_modules/playwright/index.mjs';

const pw = await import(MODUL);
export const chromium = pw.chromium;

/** Der mitgelieferte Chromium. Ohne Angabe sucht Playwright selbst. */
export const BROWSER = process.env.LID_CHROMIUM || undefined;

/** Die laufende Anwendung, ohne Schraegstrich am Ende. */
export const BASE = (process.env.LID_BASE || 'http://127.0.0.1:8099').replace(/\/$/, '');

/** Wohin Bildschirmfotos gehen. Das Verzeichnis ist nicht im Depot. */
export const BILDER = process.env.LID_SHOTS || new URL('./.bilder/', import.meta.url).pathname;

/** Startet den Browser mit den aufgeloesten Pfaden. */
export function starteBrowser(opts) {
  const o = Object.assign({}, opts || {});
  if (BROWSER) { o.executablePath = BROWSER; }
  return chromium.launch(o);
}

/**
 * Zaehlt Zusicherungen und schreibt sie mit. Die Suiten rufen ok() und am
 * Ende bilanz(): Der Rueckgabewert von bilanz() ist der Prozessstatus.
 */
export function pruefer() {
  let pass = 0, fail = 0;
  const ok = (name, bedingung, detail = '') => {
    if (bedingung) { pass++; console.log('  ok    ' + name); }
    else { fail++; console.log('  FEHLT ' + name + (detail ? '  — ' + detail : '')); }
  };
  const bilanz = () => {
    console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
    return fail === 0 ? 0 : 1;
  };
  return { ok, bilanz, zahlen: () => ({ pass, fail }) };
}

/**
 * Legt eine Liste unmittelbar ueber die Schnittstelle an, mit derselben
 * Kryptografie, die die Anwendung benutzt. So haengt eine Suite, die eine
 * gefuellte Liste braucht, nicht an sechzig Klicks.
 *
 * Laeuft im Seitenkontext, weil dort crypto.subtle und dieselbe Herkunft
 * verfuegbar sind. Die Seite muss also schon geladen sein.
 */
export function macheListe(page, doc) {
  return page.evaluate(async (doc) => {
    const enc = (b) => { let s = ''; for (const x of b) { s += String.fromCharCode(x); }
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map(x => ('0' + x.toString(16)).slice(-2)).join('');
    const id = hex(16);
    const token = enc(crypto.getRandomValues(new Uint8Array(24)));
    const proof = enc(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const keyStr = enc(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id), tagLength: 128 },
      key, new TextEncoder().encode(JSON.stringify(doc))));
    const res = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 'create', id, proof, payload: { iv: enc(iv), ct: enc(ct) } }) });
    return { id, keyStr, token, status: res.status };
  }, doc);
}

/** Holt ein Dokument vom Server und entschluesselt es mit dem Schluessel aus
    dem Fragment. Erwartet "id.key", also die ersten beiden Teile. */
export function liesListe(page, idUndKey) {
  return page.evaluate(async (arg) => {
    const dec = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) { s += '='; }
      const b = atob(s); const o = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) { o[i] = b.charCodeAt(i); } return o; };
    const [id, keyStr] = arg.split('.');
    const r = await (await fetch('api.php?a=read&id=' + id)).json();
    const key = await crypto.subtle.importKey('raw', dec(keyStr), { name: 'AES-GCM' }, true, ['decrypt']);
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: dec(r.payload.iv), additionalData: new TextEncoder().encode(id), tagLength: 128 },
      key, dec(r.payload.ct));
    return { rev: r.rev, doc: JSON.parse(new TextDecoder().decode(buf)) };
  }, idUndKey);
}

/** Ein Listendokument, wie es die Anwendung nach dem Entschluesseln sieht. */
export function L(title, name, items, extra) {
  return Object.assign({
    v: 1, title, contact: { name, email: '', phone: '' },
    showBorrower: false, items: items || []
  }, extra || {});
}
