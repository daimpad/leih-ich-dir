/*!
 * Leih-Katalog · leih-ich-dir.de
 * ---------------------------------------------------------------------------
 * Vollständige Client-Logik: Ende-zu-Ende-Verschlüsselung (Web Crypto API),
 * Zweisprachigkeit, Rendering und Zugriff auf den Flat-File-Speicher (api.php).
 *
 * Grundprinzip: Der Server sieht ausschließlich Chiffrat. Der AES-Schlüssel
 * steht im URL-Fragment (#) und wird von Browsern niemals an den Server
 * gesendet. Ent- und Verschlüsselung finden ausschließlich hier statt.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ===================================================================== *
   * 0 · Konfiguration
   * ===================================================================== */

  var API_URL        = 'api.php';
  var SCHEMA_VERSION = 1;      // Version des *entschlüsselten* Dokuments
  var SAVE_DEBOUNCE  = 800;    // ms bis zum automatischen Speichern
  var REFRESH_MS     = 45000;  // Intervall für Live-Daten im Ansehen-Modus
  var LS_PREFIX      = 'lid.'; // localStorage-Namensraum (Vorschaumodus)
  var LS_LANG        = 'lid.lang';

  /* ===================================================================== *
   * 1 · Kleine Helfer
   * ===================================================================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** Erzeugt ein Element; Text wird immer via textContent gesetzt (kein innerHTML). */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  /** Fehler mit maschinenlesbarem Code (siehe I18N-Schlüssel error.*). */
  function AppError(code) { this.code = code; this.message = code; }
  AppError.prototype = Object.create(Error.prototype);

  /* base64url ohne Padding – URL-sicher und damit fragmenttauglich. */
  var b64u = {
    encode: function (bytes) {
      var bin = '';
      for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode: function (str) {
      var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) { s += '='; }
      var bin = atob(s);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
      return out;
    }
  };

  /** Kryptografisch sichere Hex-ID (n Bytes). */
  function randomHex(n) {
    var b = crypto.getRandomValues(new Uint8Array(n));
    return Array.prototype.map.call(b, function (x) {
      return ('0' + x.toString(16)).slice(-2);
    }).join('');
  }

  function randomToken(n) { return b64u.encode(crypto.getRandomValues(new Uint8Array(n || 24))); }

  /* ===================================================================== *
   * 2 · Kryptografie (AES-GCM 256, Web Crypto API)
   * ===================================================================== */

  var Crypt = {
    generateKey: function () {
      return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    },

    exportKey: function (key) {
      return crypto.subtle.exportKey('raw', key).then(function (raw) {
        return b64u.encode(new Uint8Array(raw));
      });
    },

    importKey: function (str) {
      return crypto.subtle.importKey('raw', b64u.decode(str), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
        .catch(function () { throw new AppError('badlink'); });
    },

    /**
     * Verschlüsselt ein JS-Objekt. Die Listen-ID dient als "additional
     * authenticated data": Chiffrat und Speicherplatz sind damit aneinander
     * gebunden, ein Umkopieren zwischen Listen fällt beim Entschlüsseln auf.
     */
    encrypt: function (key, obj, aad) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var enc = new TextEncoder();
      return crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad), tagLength: 128 },
        key,
        enc.encode(JSON.stringify(obj))
      ).then(function (buf) {
        return { iv: b64u.encode(iv), ct: b64u.encode(new Uint8Array(buf)) };
      });
    },

    decrypt: function (key, payload, aad) {
      if (!payload || !payload.iv || !payload.ct) { return Promise.reject(new AppError('decrypt')); }
      var enc = new TextEncoder();
      return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64u.decode(payload.iv), additionalData: enc.encode(aad), tagLength: 128 },
        key,
        b64u.decode(payload.ct)
      ).then(function (buf) {
        return JSON.parse(new TextDecoder().decode(buf));
      }).catch(function () { throw new AppError('decrypt'); });
    },

    /**
     * Schreibnachweis: SHA-256 des Bearbeiten-Tokens. Nur dieser Nachweis
     * verlässt den Browser; der Server legt davon wiederum nur den Hash ab.
     */
    proof: function (token) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(function (buf) {
        return b64u.encode(new Uint8Array(buf));
      });
    }
  };

  /* ===================================================================== *
   * 3 · Zweisprachigkeit (i18n)
   * ===================================================================== */

  var I18N = {
    de: {
      'a11y.skip': 'Zum Inhalt springen',
      'banner.preview': 'Vorschaumodus: Es ist kein PHP-Backend erreichbar. Listen werden nur lokal in diesem Browser gespeichert – ideal zum Ausprobieren der Oberfläche.',
      'badge.local': 'lokal',
      'badge.cloud': 'Server',

      'start.headline': 'Dein Leih-Katalog',
      'start.lead': 'Eine Liste deiner Gegenstände, die du an Freunde verleihst. Ohne Konto, ohne Tracking – und nur du und deine Freunde können die Inhalte lesen.',
      'start.point1': 'Inhalte werden im Browser verschlüsselt; der Server speichert nur unlesbare Zeichenketten.',
      'start.point2': 'Ein geheimer Bearbeiten-Link für dich, ein Ansehen-Link für deine Freunde.',
      'start.point3': 'Freunde sehen immer den aktuellen Stand und fragen per E-Mail oder WhatsApp an.',
      'start.create': 'Neue Liste anlegen',
      'start.creating': 'Liste wird angelegt …',
      'start.hint': 'Wichtig: Der Bearbeiten-Link ist dein einziger Zugang. Speichere ihn als Lesezeichen – er lässt sich nicht wiederherstellen.',

      'list.titleLabel': 'Titel der Liste',
      'list.titlePlaceholder': 'Titel der Liste',
      'list.untitled': 'Leih-Katalog',
      'list.updated': 'Zuletzt aktualisiert: {date}',
      'list.readonly': 'Nur-Lese-Ansicht',

      'share.headline': 'Links',
      'share.viewLabel': 'Ansehen-Link für Freunde',
      'share.editLabel': 'Bearbeiten-Link (geheim)',
      'share.copy': 'Kopieren',
      'share.copied': 'Link kopiert.',
      'share.copyfail': 'Kopieren nicht möglich – bitte den Link manuell markieren.',
      'share.reveal': 'Zeigen',
      'share.hide': 'Verbergen',
      'share.hint': 'Der Schlüssel steht hinter dem #-Zeichen und wird technisch nie an den Server übertragen.',

      'add.headline': 'Gegenstand hinzufügen',
      'add.nameLabel': 'Gegenstand',
      'add.namePlaceholder': 'z. B. Bohrmaschine',
      'add.noteLabel': 'Notiz',
      'add.notePlaceholder': 'Notiz (optional)',
      'add.submit': 'Hinzufügen',

      'items.headline': 'Inventar',
      'items.refresh': 'Aktualisieren',
      'items.count': '{n} Gegenstände',
      'items.count_1': '1 Gegenstand',
      'items.empty': 'Noch nichts eingetragen. Füge oben deinen ersten Gegenstand hinzu.',
      'items.emptyView': 'Diese Liste ist im Moment leer.',

      'item.available': 'Verfügbar',
      'item.lent': 'Verliehen',
      'item.markLent': 'Als verliehen markieren',
      'item.markAvailable': 'Als verfügbar markieren',
      'item.delete': 'Löschen',
      'item.deleteConfirm': '„{name}“ wirklich aus der Liste entfernen?',
      'item.borrower': 'Verliehen an',
      'item.borrowerPlaceholder': 'Name (optional)',
      'item.since': 'seit',
      'item.lentTo': 'Verliehen an {name} seit {date}',
      'item.lentSince': 'Verliehen seit {date}',

      'request.mail': 'Per E-Mail anfragen',
      'request.whatsapp': 'Per WhatsApp anfragen',
      'request.copy': 'Anfragetext kopieren',
      'request.copied': 'Anfragetext kopiert.',
      'request.subject': 'Leihanfrage: {item}',
      'request.body': 'Hallo! Ich möchte {item} ausleihen. Passt das bei dir?',

      'settings.headline': 'Einstellungen & Kontakt',
      'settings.hint': 'Diese Angaben werden mitverschlüsselt und nur für die Anfrage-Buttons deiner Freunde genutzt.',
      'settings.email': 'E-Mail für Anfragen',
      'settings.phone': 'WhatsApp-Nummer',
      'settings.phoneHint': 'Internationales Format, z. B. +49 …',
      'settings.showBorrower': 'Namen der Ausleihenden auch im Ansehen-Link zeigen',
      'settings.delete': 'Liste endgültig löschen',
      'settings.deleteConfirm': 'Die gesamte Liste wird unwiderruflich vom Server gelöscht. Fortfahren?',
      'settings.deleted': 'Liste gelöscht.',

      'status.saved': 'Gespeichert',
      'status.saving': 'Speichere …',
      'status.unsaved': 'Nicht gespeichert',
      'status.error': 'Speichern fehlgeschlagen',
      'status.overwritten': 'Die Liste wurde parallel geändert; dein Stand wurde übernommen.',
      'status.refreshed': 'Aktualisiert.',

      'error.headline': 'Das hat nicht geklappt',
      'error.back': 'Zur Startseite',
      'error.badlink': 'Dieser Link ist unvollständig oder beschädigt.',
      'error.notfound': 'Diese Liste gibt es nicht (mehr).',
      'error.decrypt': 'Die Daten lassen sich mit diesem Schlüssel nicht entschlüsseln.',
      'error.network': 'Der Server ist gerade nicht erreichbar.',
      'error.forbidden': 'Dieser Bearbeiten-Link ist nicht gültig.',
      'error.nocrypto': 'Dieser Browser stellt die Web Crypto API nicht bereit. Bitte rufe die Seite über HTTPS auf und nutze einen aktuellen Browser.',
      'error.toolarge': 'Die Liste ist zu groß für den Server.',
      'error.ratelimit': 'Zu viele neue Listen in kurzer Zeit. Bitte später erneut versuchen.',
      'error.exists': 'Diese Listen-Kennung ist bereits vergeben. Bitte erneut versuchen.',

      'footer.text': 'Freie Software, MIT-Lizenz – Ende-zu-Ende-verschlüsselt.'
    },

    en: {
      'a11y.skip': 'Skip to content',
      'banner.preview': 'Preview mode: no PHP backend reachable. Lists are stored locally in this browser only – handy for trying out the interface.',
      'badge.local': 'local',
      'badge.cloud': 'server',

      'start.headline': 'Your lending catalogue',
      'start.lead': 'A list of the things you lend to friends. No account, no tracking – and only you and your friends can read the contents.',
      'start.point1': 'Contents are encrypted in the browser; the server only stores unreadable strings.',
      'start.point2': 'One secret edit link for you, one view link for your friends.',
      'start.point3': 'Friends always see the current state and ask via e-mail or WhatsApp.',
      'start.create': 'Create a new list',
      'start.creating': 'Creating list …',
      'start.hint': 'Important: the edit link is your only way back in. Bookmark it – it cannot be recovered.',

      'list.titleLabel': 'List title',
      'list.titlePlaceholder': 'List title',
      'list.untitled': 'Lending catalogue',
      'list.updated': 'Last updated: {date}',
      'list.readonly': 'Read-only view',

      'share.headline': 'Links',
      'share.viewLabel': 'View link for friends',
      'share.editLabel': 'Edit link (secret)',
      'share.copy': 'Copy',
      'share.copied': 'Link copied.',
      'share.copyfail': 'Copying failed – please select the link manually.',
      'share.reveal': 'Show',
      'share.hide': 'Hide',
      'share.hint': 'The key lives behind the # sign and is technically never sent to the server.',

      'add.headline': 'Add an item',
      'add.nameLabel': 'Item',
      'add.namePlaceholder': 'e.g. cordless drill',
      'add.noteLabel': 'Note',
      'add.notePlaceholder': 'Note (optional)',
      'add.submit': 'Add',

      'items.headline': 'Inventory',
      'items.refresh': 'Refresh',
      'items.count': '{n} items',
      'items.count_1': '1 item',
      'items.empty': 'Nothing here yet. Add your first item above.',
      'items.emptyView': 'This list is empty at the moment.',

      'item.available': 'Available',
      'item.lent': 'Lent out',
      'item.markLent': 'Mark as lent out',
      'item.markAvailable': 'Mark as available',
      'item.delete': 'Delete',
      'item.deleteConfirm': 'Really remove “{name}” from the list?',
      'item.borrower': 'Lent to',
      'item.borrowerPlaceholder': 'Name (optional)',
      'item.since': 'since',
      'item.lentTo': 'Lent to {name} since {date}',
      'item.lentSince': 'Lent out since {date}',

      'request.mail': 'Ask by e-mail',
      'request.whatsapp': 'Ask via WhatsApp',
      'request.copy': 'Copy request text',
      'request.copied': 'Request text copied.',
      'request.subject': 'Borrowing request: {item}',
      'request.body': 'Hi! I would like to borrow {item}. Does that work for you?',

      'settings.headline': 'Settings & contact',
      'settings.hint': 'These details are encrypted along with the list and only feed the request buttons your friends see.',
      'settings.email': 'E-mail for requests',
      'settings.phone': 'WhatsApp number',
      'settings.phoneHint': 'International format, e.g. +49 …',
      'settings.showBorrower': 'Show borrower names in the view link as well',
      'settings.delete': 'Delete list permanently',
      'settings.deleteConfirm': 'The entire list will be irreversibly deleted from the server. Continue?',
      'settings.deleted': 'List deleted.',

      'status.saved': 'Saved',
      'status.saving': 'Saving …',
      'status.unsaved': 'Not saved',
      'status.error': 'Saving failed',
      'status.overwritten': 'The list was changed elsewhere; your version was kept.',
      'status.refreshed': 'Refreshed.',

      'error.headline': 'That did not work',
      'error.back': 'Back to start',
      'error.badlink': 'This link is incomplete or damaged.',
      'error.notfound': 'This list does not exist (any more).',
      'error.decrypt': 'The data cannot be decrypted with this key.',
      'error.network': 'The server cannot be reached right now.',
      'error.forbidden': 'This edit link is not valid.',
      'error.nocrypto': 'This browser does not provide the Web Crypto API. Please open the page via HTTPS and use an up-to-date browser.',
      'error.toolarge': 'The list is too large for the server.',
      'error.ratelimit': 'Too many new lists in a short time. Please try again later.',
      'error.exists': 'This list id is already taken. Please try again.',

      'footer.text': 'Free software, MIT licence – end-to-end encrypted.'
    }
  };

  var lang = 'de';

  /** Übersetzt einen Schlüssel und ersetzt {platzhalter}. */
  function t(key, vars) {
    var table = I18N[lang] || I18N.de;
    var s = table[key];
    if (s === undefined) { s = (I18N.de[key] !== undefined) ? I18N.de[key] : key; }
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return (vars[name] !== undefined) ? String(vars[name]) : m;
      });
    }
    return s;
  }

  function detectLang() {
    var stored = null;
    try { stored = localStorage.getItem(LS_LANG); } catch (e) { /* private mode */ }
    if (stored === 'de' || stored === 'en') { return stored; }
    var nav = (navigator.language || 'de').toLowerCase();
    return nav.indexOf('de') === 0 ? 'de' : 'en';
  }

  function setLang(next) {
    lang = (next === 'en') ? 'en' : 'de';
    try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    applyStaticI18n();
    fillDatalist();
    render();
  }

  /** Überträgt die Wörterbücher auf alle statisch ausgezeichneten Knoten. */
  function applyStaticI18n() {
    $$('[data-i18n]').forEach(function (node) { node.textContent = t(node.getAttribute('data-i18n')); });
    $$('[data-i18n-placeholder]').forEach(function (node) {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
    });
    $$('.langbtn').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var badge = $('#storageBadge');
    if (Store && badge) {
      badge.textContent = t(Store.kind === 'local' ? 'badge.local' : 'badge.cloud');
      badge.hidden = false;
    }
  }

  function formatDate(tsSeconds) {
    if (!tsSeconds) { return ''; }
    try {
      return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(tsSeconds * 1000));
    } catch (e) {
      return new Date(tsSeconds * 1000).toLocaleString();
    }
  }

  function formatDay(iso) {
    if (!iso) { return ''; }
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) { return iso; }
    try {
      return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(d);
    } catch (e) { return iso; }
  }

  /* ===================================================================== *
   * 4 · Zweisprachiger Katalog typischer Leih-Gegenstände
   *     Füllt das native <datalist>-Element (kein eigenes Dropdown-Widget).
   * ===================================================================== */

  var CATALOG = [
    { de: 'Bohrmaschine',           en: 'Cordless drill' },
    { de: 'Akkuschrauber',          en: 'Power screwdriver' },
    { de: 'Stichsäge',              en: 'Jigsaw' },
    { de: 'Winkelschleifer',        en: 'Angle grinder' },
    { de: 'Werkzeugkoffer',         en: 'Tool box' },
    { de: 'Leiter',                 en: 'Ladder' },
    { de: 'Tapeziertisch',          en: 'Pasting table' },
    { de: 'Sackkarre',              en: 'Hand truck' },
    { de: 'Bollerwagen',            en: 'Handcart' },
    { de: 'Rasenmäher',             en: 'Lawn mower' },
    { de: 'Heckenschere',           en: 'Hedge trimmer' },
    { de: 'Hochdruckreiniger',      en: 'Pressure washer' },
    { de: 'Nähmaschine',            en: 'Sewing machine' },
    { de: 'Fahrradpumpe',           en: 'Bicycle pump' },
    { de: 'Fahrradanhänger',        en: 'Bicycle trailer' },
    { de: 'Dachgepäckträger',       en: 'Roof rack' },
    { de: 'Reisekoffer',            en: 'Suitcase' },
    { de: 'Zelt',                   en: 'Tent' },
    { de: 'Schlafsack',             en: 'Sleeping bag' },
    { de: 'Isomatte',               en: 'Sleeping pad' },
    { de: 'Campingkocher',          en: 'Camping stove' },
    { de: 'Kühlbox',                en: 'Cool box' },
    { de: 'Raclette-Grill',         en: 'Raclette grill' },
    { de: 'Waffeleisen',            en: 'Waffle iron' },
    { de: 'Beamer',                 en: 'Projector' },
    { de: 'Bluetooth-Lautsprecher', en: 'Bluetooth speaker' },
    { de: 'Musikanlage',            en: 'PA system' },
    { de: 'Brettspiel',             en: 'Board game' },
    { de: 'Kinderwagen',            en: 'Stroller' }
  ];

  function fillDatalist() {
    var list = $('#itemSuggestions');
    if (!list) { return; }
    list.textContent = '';
    CATALOG.map(function (entry) { return entry[lang] || entry.de; })
      .sort(function (a, b) { return a.localeCompare(b, lang); })
      .forEach(function (label) {
        var opt = document.createElement('option');
        opt.value = label;
        list.appendChild(opt);
      });
  }

  /* ===================================================================== *
   * 5 · Speicher-Adapter
   *     Beide Adapter liefern {status, body} – die Oberfläche muss nicht
   *     wissen, ob gerade PHP oder localStorage dahintersteht.
   * ===================================================================== */

  function apiPost(payload) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload)
    }).then(readJson, function () { throw new AppError('network'); });
  }

  function apiGet(query) {
    return fetch(API_URL + query, { cache: 'no-store' })
      .then(readJson, function () { throw new AppError('network'); });
  }

  function readJson(res) {
    return res.text().then(function (txt) {
      var body = null;
      try { body = JSON.parse(txt); } catch (e) { throw new AppError('network'); }
      return { status: res.status, body: body };
    });
  }

  var RemoteStore = {
    kind: 'remote',
    create: function (id, proof, payload) { return apiPost({ a: 'create', id: id, proof: proof, payload: payload }); },
    read:   function (id, rev) { return apiGet('?a=read&id=' + encodeURIComponent(id) + (rev ? '&rev=' + rev : '')); },
    write:  function (id, proof, rev, payload) { return apiPost({ a: 'write', id: id, proof: proof, rev: rev, payload: payload }); },
    remove: function (id, proof) { return apiPost({ a: 'delete', id: id, proof: proof }); }
  };

  /** Vorschaumodus (GitHub Pages, file://): identische Semantik, lokaler Speicher. */
  var LocalStore = {
    kind: 'local',
    _get: function (id) {
      try {
        var raw = localStorage.getItem(LS_PREFIX + id);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    _put: function (id, rec) {
      try { localStorage.setItem(LS_PREFIX + id, JSON.stringify(rec)); return true; }
      catch (e) { return false; }
    },
    create: function (id, proof, payload) {
      if (this._get(id)) { return Promise.resolve({ status: 409, body: { error: 'exists' } }); }
      var rec = { proof: proof, rev: 1, updated: nowSec(), payload: payload };
      if (!this._put(id, rec)) { return Promise.resolve({ status: 507, body: { error: 'toolarge' } }); }
      return Promise.resolve({ status: 200, body: { id: id, rev: 1, updated: rec.updated } });
    },
    read: function (id, rev) {
      var rec = this._get(id);
      if (!rec) { return Promise.resolve({ status: 404, body: { error: 'notfound' } }); }
      if (rev && Number(rev) === rec.rev) { return Promise.resolve({ status: 200, body: { rev: rec.rev, unchanged: true } }); }
      return Promise.resolve({ status: 200, body: { rev: rec.rev, updated: rec.updated, payload: rec.payload } });
    },
    write: function (id, proof, rev, payload) {
      var rec = this._get(id);
      if (!rec) { return Promise.resolve({ status: 404, body: { error: 'notfound' } }); }
      if (rec.proof !== proof) { return Promise.resolve({ status: 403, body: { error: 'forbidden' } }); }
      if (Number(rev) !== rec.rev) { return Promise.resolve({ status: 409, body: { error: 'conflict', rev: rec.rev } }); }
      rec.rev += 1; rec.updated = nowSec(); rec.payload = payload;
      if (!this._put(id, rec)) { return Promise.resolve({ status: 507, body: { error: 'toolarge' } }); }
      return Promise.resolve({ status: 200, body: { rev: rec.rev, updated: rec.updated } });
    },
    remove: function (id, proof) {
      var rec = this._get(id);
      if (!rec) { return Promise.resolve({ status: 404, body: { error: 'notfound' } }); }
      if (rec.proof !== proof) { return Promise.resolve({ status: 403, body: { error: 'forbidden' } }); }
      try { localStorage.removeItem(LS_PREFIX + id); } catch (e) { /* ignore */ }
      return Promise.resolve({ status: 200, body: { ok: true } });
    }
  };

  var Store = null;

  /**
   * Wählt den Speicher: Antwortet api.php mit der erwarteten Kennung, läuft
   * die App im Produktivmodus, sonst im lokalen Vorschaumodus. GitHub Pages
   * liefert PHP-Dateien als Text aus – die JSON-Prüfung fängt das ab.
   */
  function detectStore() {
    if (location.protocol === 'file:' || /(^|\.)github\.io$/.test(location.hostname)) {
      return Promise.resolve(LocalStore);
    }
    return apiGet('?a=ping').then(function (res) {
      var ok = res.status === 200 && res.body && res.body.service === 'leih-katalog';
      return ok ? RemoteStore : LocalStore;
    }, function () { return LocalStore; });
  }

  /* ===================================================================== *
   * 6 · Zustand
   * ===================================================================== */

  var state = {
    mode: 'start',   // 'start' | 'edit' | 'view'
    id: null,
    key: null,       // CryptoKey
    keyStr: null,    // base64url
    token: null,     // Bearbeiten-Token (nur im Bearbeiten-Link)
    proof: null,     // SHA-256(token), nur dieser Wert erreicht den Server
    rev: 0,
    updated: 0,
    doc: null,       // Klartext-Dokument
    dirty: false,
    saving: false
  };

  var saveTimer = null;
  var refreshTimer = null;
  var docGen = 0;   // zählt Änderungen; erkennt Bearbeitungen während eines Schreibvorgangs

  function emptyDoc() {
    return {
      v: SCHEMA_VERSION,
      title: '',
      contact: { email: '', phone: '' },
      showBorrower: false,
      items: []
    };
  }

  /** Normalisiert ein entschlüsseltes Dokument (Fremddaten defensiv behandeln). */
  function normalizeDoc(raw) {
    var doc = emptyDoc();
    if (!raw || typeof raw !== 'object') { return doc; }
    doc.title = typeof raw.title === 'string' ? raw.title : '';
    doc.showBorrower = raw.showBorrower === true;
    if (raw.contact && typeof raw.contact === 'object') {
      doc.contact.email = typeof raw.contact.email === 'string' ? raw.contact.email : '';
      doc.contact.phone = typeof raw.contact.phone === 'string' ? raw.contact.phone : '';
    }
    if (Array.isArray(raw.items)) {
      doc.items = raw.items.filter(function (it) {
        return it && typeof it === 'object' && typeof it.name === 'string';
      }).map(function (it) {
        return {
          id: typeof it.id === 'string' ? it.id : randomHex(6),
          name: it.name.slice(0, 120),
          note: typeof it.note === 'string' ? it.note.slice(0, 200) : '',
          status: it.status === 'lent' ? 'lent' : 'available',
          borrower: typeof it.borrower === 'string' ? it.borrower.slice(0, 80) : '',
          since: typeof it.since === 'string' ? it.since.slice(0, 10) : ''
        };
      });
    }
    return doc;
  }

  /* ===================================================================== *
   * 7 · Links & Navigation
   * ===================================================================== */

  function baseUrl() { return location.origin + location.pathname; }
  function viewHash(id, key) { return '#v=' + id + '.' + key; }
  function editHash(id, key, token) { return '#e=' + id + '.' + key + '.' + token; }
  function viewLink() { return baseUrl() + viewHash(state.id, state.keyStr); }
  function editLink() { return baseUrl() + editHash(state.id, state.keyStr, state.token); }

  /** Zerlegt das URL-Fragment. Rückgabe: null | {mode, id, key, token}. */
  function parseHash() {
    var raw = location.hash.replace(/^#/, '');
    if (!raw) { return null; }
    var m = /^([ev])=(.+)$/.exec(raw);
    if (!m) { return null; }
    var parts = m[2].split('.');
    var id = parts[0] || '';
    if (!/^[0-9a-f]{32}$/.test(id) || !parts[1]) { throw new AppError('badlink'); }
    if (m[1] === 'e') {
      if (!parts[2]) { throw new AppError('badlink'); }
      return { mode: 'edit', id: id, key: parts[1], token: parts[2] };
    }
    return { mode: 'view', id: id, key: parts[1], token: null };
  }

  /* ===================================================================== *
   * 8 · Rendering
   * ===================================================================== */

  function showView(name) {
    ['viewStart', 'viewList', 'viewError'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) { node.hidden = (id !== name); }
    });
  }

  function showError(code) {
    state.mode = 'error';
    $('#errorText').textContent = t('error.' + code) || t('error.network');
    showView('viewError');
  }

  var toastTimer = null;
  function toast(msg) {
    var node = $('#toast');
    node.textContent = msg;
    node.hidden = false;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.classList.remove('is-visible');
      setTimeout(function () { node.hidden = true; }, 250);
    }, 3200);
  }

  function setSaveState(kind) {
    var node = $('#saveState');
    if (!node) { return; }
    if (state.mode !== 'edit' || !kind) { node.textContent = ''; node.className = 'savestate'; return; }
    node.textContent = t('status.' + kind);
    node.className = 'savestate savestate--' + kind;
  }

  /** Vollständiges Neuzeichnen der Listenansicht. */
  function render() {
    if (state.mode !== 'edit' && state.mode !== 'view') { return; }
    var isEdit = state.mode === 'edit';
    showView('viewList');

    /* Kopfbereich */
    var titleRead = $('#listTitleRead');
    var titleWrap = $('#listTitleEditWrap');
    var titleInput = $('#listTitleInput');
    titleWrap.hidden = !isEdit;
    titleRead.hidden = isEdit;
    if (isEdit) {
      if (document.activeElement !== titleInput) { titleInput.value = state.doc.title; }
    } else {
      titleRead.textContent = state.doc.title || t('list.untitled');
    }
    document.title = (state.doc.title || t('list.untitled')) + ' · leih-ich-dir';

    var meta = [];
    if (state.updated) { meta.push(t('list.updated', { date: formatDate(state.updated) })); }
    if (!isEdit) { meta.push(t('list.readonly')); }
    $('#listMeta').textContent = meta.join(' · ');

    /* Bereiche, die nur im Bearbeitenmodus sichtbar sind */
    $('#shareBox').hidden = !isEdit;
    $('#addForm').hidden = !isEdit;
    $('#settingsBox').hidden = !isEdit;
    $('#btnRefresh').hidden = isEdit;

    if (isEdit) {
      $('#linkView').value = viewLink();
      $('#linkEdit').value = editLink();
      if (document.activeElement !== $('#cfgEmail')) { $('#cfgEmail').value = state.doc.contact.email; }
      if (document.activeElement !== $('#cfgPhone')) { $('#cfgPhone').value = state.doc.contact.phone; }
      $('#cfgShowBorrower').checked = state.doc.showBorrower;
    }

    /* Inventar */
    var items = state.doc.items;
    var count = items.length;
    $('#itemsCount').textContent = count === 1 ? t('items.count_1') : t('items.count', { n: count });

    var listNode = $('#itemList');
    listNode.textContent = '';
    items.forEach(function (item) { listNode.appendChild(isEdit ? renderEditRow(item) : renderViewRow(item)); });

    var empty = $('#itemsEmpty');
    empty.hidden = count > 0;
    empty.textContent = t(isEdit ? 'items.empty' : 'items.emptyView');

    setSaveState(state.saving ? 'saving' : (state.dirty ? 'unsaved' : 'saved'));
  }

  function statusLabel(item) { return t(item.status === 'lent' ? 'item.lent' : 'item.available'); }

  function renderEditRow(item) {
    var li = el('li', 'item item--' + item.status);
    li.setAttribute('data-id', item.id);

    var toggle = el('button', 'statusbtn statusbtn--' + item.status, statusLabel(item));
    toggle.type = 'button';
    toggle.setAttribute('data-act', 'toggle');
    toggle.title = t(item.status === 'lent' ? 'item.markAvailable' : 'item.markLent');
    li.appendChild(toggle);

    var main = el('div', 'item-main');
    main.appendChild(el('span', 'item-name', item.name));
    if (item.note) { main.appendChild(el('span', 'item-note', item.note)); }

    if (item.status === 'lent') {
      var meta = el('div', 'item-lentmeta');

      var whoLabel = el('label', 'inline-label', t('item.borrower'));
      var who = document.createElement('input');
      who.type = 'text';
      who.className = 'input input--inline';
      who.value = item.borrower;
      who.maxLength = 80;
      who.placeholder = t('item.borrowerPlaceholder');
      who.setAttribute('data-field', 'borrower');
      whoLabel.appendChild(who);
      meta.appendChild(whoLabel);

      var sinceLabel = el('label', 'inline-label', t('item.since'));
      var since = document.createElement('input');
      since.type = 'date';
      since.className = 'input input--inline';
      since.value = item.since || '';
      since.setAttribute('data-field', 'since');
      sinceLabel.appendChild(since);
      meta.appendChild(sinceLabel);

      main.appendChild(meta);
    }
    li.appendChild(main);

    var del = el('button', 'iconbtn iconbtn--danger', '✕');
    del.type = 'button';
    del.setAttribute('data-act', 'delete');
    del.title = t('item.delete');
    del.setAttribute('aria-label', t('item.delete') + ': ' + item.name);
    li.appendChild(del);
    return li;
  }

  function renderViewRow(item) {
    var li = el('li', 'item item--' + item.status);
    li.setAttribute('data-id', item.id);
    li.appendChild(el('span', 'badge badge--' + item.status, statusLabel(item)));

    var main = el('div', 'item-main');
    main.appendChild(el('span', 'item-name', item.name));
    if (item.note) { main.appendChild(el('span', 'item-note', item.note)); }

    if (item.status === 'lent' && item.since) {
      var info = (state.doc.showBorrower && item.borrower)
        ? t('item.lentTo', { name: item.borrower, date: formatDay(item.since) })
        : t('item.lentSince', { date: formatDay(item.since) });
      main.appendChild(el('span', 'item-lentinfo', info));
    }
    li.appendChild(main);

    if (item.status === 'available') {
      li.appendChild(requestActions(item));
    }
    return li;
  }

  /**
   * Anfrage-Buttons: die Links werden rein lokal erzeugt, es wird nichts
   * an Dritte übertragen, bevor die Nutzerin klickt.
   */
  function requestActions(item) {
    var box = el('div', 'item-actions');
    var subject = t('request.subject', { item: item.name });
    var body = t('request.body', { item: item.name });
    var email = (state.doc.contact.email || '').trim();
    var phone = (state.doc.contact.phone || '').replace(/[^\d]/g, '');

    if (email) {
      var mail = el('a', 'btn btn--small', t('request.mail'));
      mail.href = 'mailto:' + encodeURIComponent(email) +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      mail.rel = 'noopener';
      box.appendChild(mail);
    }
    if (phone) {
      var wa = el('a', 'btn btn--small', t('request.whatsapp'));
      wa.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(body);
      wa.target = '_blank';
      wa.rel = 'noopener noreferrer';
      box.appendChild(wa);
    }
    if (!email && !phone) {
      var copy = el('button', 'btn btn--small btn--ghost', t('request.copy'));
      copy.type = 'button';
      copy.addEventListener('click', function () {
        copyText(body).then(function (ok) { toast(t(ok ? 'request.copied' : 'share.copyfail')); });
      });
      box.appendChild(copy);
    }
    return box;
  }

  /* ===================================================================== *
   * 9 · Mutationen und Persistenz
   * ===================================================================== */

  function touch() {
    docGen++;
    state.dirty = true;
    setSaveState('unsaved');
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE);
  }

  function save() {
    if (state.mode !== 'edit' || !state.dirty) { return Promise.resolve(); }
    /* Läuft bereits ein Schreibvorgang, wird der nächste angehängt statt verworfen. */
    if (state.saving) { scheduleSave(); return Promise.resolve(); }

    state.saving = true;
    setSaveState('saving');
    var generation = docGen;
    var snapshot = JSON.parse(JSON.stringify(state.doc));
    snapshot.v = SCHEMA_VERSION;

    return Crypt.encrypt(state.key, snapshot, state.id).then(function (payload) {
      return Store.write(state.id, state.proof, state.rev, payload).then(function (res) {
        /* Optimistisches Sperren: bei Konflikt einmal mit aktueller Revision neu schreiben. */
        if (res.status === 409 && res.body && typeof res.body.rev === 'number') {
          state.rev = res.body.rev;
          return Store.write(state.id, state.proof, state.rev, payload).then(function (retry) {
            if (retry.status === 200) { toast(t('status.overwritten')); }
            return retry;
          });
        }
        return res;
      });
    }).then(function (res) {
      state.saving = false;
      if (res.status === 200) {
        state.rev = res.body.rev;
        state.updated = res.body.updated;
        /* Während des Schreibens erfolgte Änderungen bleiben offen und
           werden im nächsten Durchlauf mitgenommen. */
        state.dirty = (docGen !== generation);
        setSaveState(state.dirty ? 'unsaved' : 'saved');
        if (state.dirty) { scheduleSave(); }
        $('#listMeta').textContent = t('list.updated', { date: formatDate(state.updated) });
      } else {
        setSaveState('error');
        toast(t('error.' + mapError(res)));
      }
    }).catch(function (err) {
      state.saving = false;
      setSaveState('error');
      toast(t('error.' + (err && err.code ? err.code : 'network')));
    });
  }

  function mapError(res) {
    var known = { notfound: 1, forbidden: 1, toolarge: 1, ratelimit: 1, exists: 1, conflict: 1 };
    var code = res && res.body && res.body.error;
    if (code === 'conflict') { return 'network'; }
    return (code && known[code]) ? code : 'network';
  }

  function addItem(name, note) {
    name = (name || '').trim();
    if (!name) { return; }
    state.doc.items.unshift({
      id: randomHex(6),
      name: name.slice(0, 120),
      note: (note || '').trim().slice(0, 200),
      status: 'available',
      borrower: '',
      since: ''
    });
    touch();
    render();
  }

  function findItem(id) {
    for (var i = 0; i < state.doc.items.length; i++) {
      if (state.doc.items[i].id === id) { return state.doc.items[i]; }
    }
    return null;
  }

  function toggleItem(id) {
    var item = findItem(id);
    if (!item) { return; }
    if (item.status === 'available') {
      item.status = 'lent';
      item.since = new Date().toISOString().slice(0, 10);
    } else {
      item.status = 'available';
      item.borrower = '';
      item.since = '';
    }
    touch();
    render();
  }

  function deleteItem(id) {
    var item = findItem(id);
    if (!item) { return; }
    if (!window.confirm(t('item.deleteConfirm', { name: item.name }))) { return; }
    state.doc.items = state.doc.items.filter(function (it) { return it.id !== id; });
    touch();
    render();
  }

  /* ===================================================================== *
   * 10 · Laden, Anlegen, Aktualisieren
   * ===================================================================== */

  function createList() {
    var btn = $('#btnCreate');
    btn.disabled = true;
    btn.textContent = t('start.creating');

    var id = randomHex(16);
    var token = randomToken(24);
    var doc = emptyDoc();
    var keyRef = null;

    Crypt.generateKey().then(function (key) {
      keyRef = key;
      return Promise.all([Crypt.exportKey(key), Crypt.proof(token), Crypt.encrypt(key, doc, id)]);
    }).then(function (parts) {
      var keyStr = parts[0], proof = parts[1], payload = parts[2];
      return Store.create(id, proof, payload).then(function (res) {
        if (res.status !== 200) { throw new AppError(mapError(res)); }
        state.mode = 'edit';
        state.id = id;
        state.key = keyRef;
        state.keyStr = keyStr;
        state.token = token;
        state.proof = proof;
        state.rev = res.body.rev;
        state.updated = res.body.updated;
        state.doc = doc;
        state.dirty = false;
        history.replaceState(null, '', editHash(id, keyStr, token));
        render();
        stopRefresh();
      });
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = t('start.create');
      toast(t('error.' + (err && err.code ? err.code : 'network')));
    });
  }

  /** Lädt eine Liste anhand der Fragmentdaten und entschlüsselt sie lokal. */
  function openList(route) {
    return Crypt.importKey(route.key).then(function (key) {
      state.key = key;
      state.keyStr = route.key;
      state.id = route.id;
      state.mode = route.mode;
      state.token = route.token;
      return route.token ? Crypt.proof(route.token) : null;
    }).then(function (proof) {
      state.proof = proof;
      return Store.read(state.id, 0);
    }).then(function (res) {
      if (res.status === 404) { throw new AppError('notfound'); }
      if (res.status !== 200) { throw new AppError(mapError(res)); }
      state.rev = res.body.rev;
      state.updated = res.body.updated;
      return Crypt.decrypt(state.key, res.body.payload, state.id);
    }).then(function (raw) {
      state.doc = normalizeDoc(raw);
      state.dirty = false;
      render();
      if (state.mode === 'view') { startRefresh(); } else { stopRefresh(); }
    }).catch(function (err) {
      showError(err && err.code ? err.code : 'network');
    });
  }

  /** Holt den aktuellen Serverstand (Live-Daten hinter dem Ansehen-Link). */
  function refresh(manual) {
    if (state.mode !== 'view' || !state.id) { return; }
    Store.read(state.id, state.rev).then(function (res) {
      if (res.status !== 200) { return; }
      if (res.body.unchanged) {
        if (manual) { toast(t('status.refreshed')); }
        return;
      }
      return Crypt.decrypt(state.key, res.body.payload, state.id).then(function (raw) {
        state.rev = res.body.rev;
        state.updated = res.body.updated;
        state.doc = normalizeDoc(raw);
        render();
        if (manual) { toast(t('status.refreshed')); }
      });
    }).catch(function () { /* stiller Fehlschlag – nächster Durchlauf versucht es erneut */ });
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(function () {
      if (!document.hidden) { refresh(false); }
    }, REFRESH_MS);
  }

  function stopRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  function deleteList() {
    if (state.mode !== 'edit') { return; }
    if (!window.confirm(t('settings.deleteConfirm'))) { return; }
    Store.remove(state.id, state.proof).then(function (res) {
      if (res.status !== 200) { throw new AppError(mapError(res)); }
      state.mode = 'start';
      state.doc = null;
      history.replaceState(null, '', location.pathname);
      showView('viewStart');
      toast(t('settings.deleted'));
    }).catch(function (err) {
      toast(t('error.' + (err && err.code ? err.code : 'network')));
    });
  }

  /* ===================================================================== *
   * 11 · Zwischenablage
   * ===================================================================== */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.className = 'offscreen';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ===================================================================== *
   * 12 · Ereignisse
   * ===================================================================== */

  function bindEvents() {
    $$('.langbtn').forEach(function (btn) {
      btn.addEventListener('click', function () { setLang(btn.getAttribute('data-lang')); });
    });

    $('#btnCreate').addEventListener('click', createList);
    $('#btnRefresh').addEventListener('click', function () { refresh(true); });
    $('#btnDeleteList').addEventListener('click', deleteList);

    $('#addForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      addItem($('#addName').value, $('#addNote').value);
      $('#addName').value = '';
      $('#addNote').value = '';
      $('#addName').focus();
    });

    $('#listTitleInput').addEventListener('input', function () {
      state.doc.title = this.value;
      touch();
    });

    $('#cfgEmail').addEventListener('input', function () { state.doc.contact.email = this.value.trim(); touch(); });
    $('#cfgPhone').addEventListener('input', function () { state.doc.contact.phone = this.value.trim(); touch(); });
    $('#cfgShowBorrower').addEventListener('change', function () { state.doc.showBorrower = this.checked; touch(); });

    /* Delegation für die Inventarliste */
    var list = $('#itemList');
    list.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) { return; }
      var id = btn.closest('.item').getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'toggle') { toggleItem(id); }
      if (btn.getAttribute('data-act') === 'delete') { deleteItem(id); }
    });
    list.addEventListener('input', function (ev) {
      var field = ev.target.getAttribute && ev.target.getAttribute('data-field');
      if (!field) { return; }
      var item = findItem(ev.target.closest('.item').getAttribute('data-id'));
      if (!item) { return; }
      item[field] = ev.target.value;
      touch();
    });

    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.getAttribute('data-copy'));
        copyText(input.value).then(function (ok) { toast(t(ok ? 'share.copied' : 'share.copyfail')); });
      });
    });

    $('#btnRevealEdit').addEventListener('click', function () {
      var input = $('#linkEdit');
      var hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      this.textContent = t(hidden ? 'share.hide' : 'share.reveal');
    });

    /* Ungespeicherte Änderungen vor dem Verlassen wegschreiben. */
    window.addEventListener('beforeunload', function (ev) {
      if (state.mode === 'edit' && state.dirty) {
        save();
        ev.preventDefault();
        ev.returnValue = '';
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { return; }
      if (state.mode === 'view') { refresh(false); }
    });

    window.addEventListener('hashchange', route);
  }

  /* ===================================================================== *
   * 13 · Router und Start
   * ===================================================================== */

  function route() {
    var parsed;
    try { parsed = parseHash(); }
    catch (err) { showError(err.code || 'badlink'); return; }

    if (!parsed) {
      stopRefresh();
      state.mode = 'start';
      showView('viewStart');
      return;
    }
    /* Bereits geladene Liste nicht erneut anfordern. */
    if (state.id === parsed.id && state.mode === parsed.mode && state.doc) {
      render();
      return;
    }
    openList(parsed);
  }

  function init() {
    lang = detectLang();
    document.documentElement.lang = lang;
    applyStaticI18n();
    fillDatalist();
    bindEvents();

    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      showError('nocrypto');
      return;
    }

    detectStore().then(function (store) {
      Store = store;
      $('#previewBanner').hidden = (store.kind !== 'local');
      applyStaticI18n();
      route();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
