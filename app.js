/*!
 * Leih-Katalog · leihichdir.de
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
  var UNDO_MS        = 9000;   // Frist, in der sich ein Löschen zurücknehmen lässt
  var LS_PREFIX      = 'lid.'; // localStorage-Namensraum (Vorschaumodus)
  var LS_LANG        = 'lid.lang';
  var LS_MINE        = 'lid.mine'; // auf diesem Gerät gemerkte eigene Listen
  var MINE_MAX       = 8;      // mehr merkt sich niemand, und die Startseite bliebe voll

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

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** Zeichen des Hauses aus dem eingebetteten Symbolsatz (siehe index.html). */
  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  /** Statuspunkt: grün für verfügbar, orange für verliehen. */
  function statusDot(status) {
    return el('span', 'dot' + (status === 'lent' ? ' dot--warn' : ''));
  }

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
      'a11y.lang': 'Switch to English',
      'banner.preview': 'Vorschaumodus: Es ist kein PHP-Backend erreichbar. Listen werden nur lokal in diesem Browser gespeichert. Das ist ideal, um die Oberfläche auszuprobieren.',
      'badge.local': 'lokal',

      'hero.a': 'Leih',
      'hero.b': 'ich',
      'hero.c': 'Dir.',
      'hero.lead': 'Versende Deine Liste an Leihgegenständen an andere.',

      'trust.label': 'Eigenschaften',
      'trust.tracking': 'Kostenlos',
      'trust.account': 'Werbefrei',
      'trust.ads': 'Ohne Login',
      'trust.crypto': 'Verschlüsselt',

      'steps.headline': 'So geht\u2019s',
      'steps.one': 'Gegenstände eintragen',
      'steps.oneText': 'Tippen oder einsprechen. Erst nur der Name, alles Weitere steht hinter dem Eintrag.',
      'steps.two': 'Kontaktdetails angeben',
      'steps.twoText': 'Name und E-Mail, damit Deine Freunde Dich erreichen. Beides wird mitverschlüsselt.',
      'steps.three': 'Link weitergeben',
      'steps.threeText': 'Freunde sehen, was gerade frei ist, und fragen mit einem Klick an.',

      'start.create': 'Neue Liste anlegen',
      'start.creating': 'Liste wird angelegt …',

      'list.titleLabel': 'Titel der Liste',
      'list.titlePlaceholder': 'Titel der Liste',
      'list.untitled': 'Leih-Katalog',
      'list.updated': 'Zuletzt aktualisiert: {date}',
      'list.by': 'Liste von {name}',
      'list.free': '{n} gerade frei',
      'list.free_1': '1 gerade frei',
      'list.lentCount': '{n} verliehen',
      'list.newTitle': 'Meine Leihliste',

      'mine.headline': 'Deine Listen auf diesem Gerät',
      'mine.link': 'Meine Listen',

      'key.headline': 'Bewahre diesen Link auf!',
      'key.label': 'Bearbeiten-Link',
      'key.remember': 'Auf diesem Gerät gemerkt — beim nächsten Besuch findest Du die Liste auf der Startseite wieder.',
      'key.done': 'Ich habe den Link gesichert',

      'share.headline': 'Link teilen',
      'share.tabView': 'Ansehen',
      'share.tabEdit': 'Bearbeiten',
      'share.viewHint': 'Diesen Link geben Deine Freunde weiter. Er zeigt die Liste, ändern lässt sich damit nichts.',
      'share.editHint': 'Dieser Link ist Dein Zugang. Gib ihn niemandem und speichere ihn als Lesezeichen.',
      'share.viewLabel': 'Ansehen-Link für Freunde',
      'share.editLabel': 'Bearbeiten-Link, geheim',
      'share.copy': 'Kopieren',
      'share.send': 'Teilen',
      'share.message': 'Schau Dir an, was ich verleihe: {title}',
      'share.copied': 'Link kopiert.',
      'share.copyfail': 'Kopieren nicht möglich. Bitte den Link von Hand markieren.',
      'share.reveal': 'Zeigen',
      'share.hide': 'Verbergen',
      'share.hint': 'Der Schlüssel steht hinter dem Rautezeichen und wird technisch nie an den Server übertragen.',

      'add.nameLabel': 'Gegenstand',
      'add.namePlaceholder': 'zum Beispiel Bohrmaschine',
      'add.notePlaceholder': 'Notiz, optional',
      'add.submit': 'Hinzufügen',

      'items.headline': 'Inventar',
      'items.refresh': 'Aktualisieren',
      'items.count': '{n} Gegenstände',
      'items.count_1': '1 Gegenstand',
      'items.empty': 'Noch nichts eingetragen. Füge oben Deinen ersten Gegenstand hinzu.',
      'items.emptyView': 'Diese Liste ist im Moment leer.',
      'items.checked': 'zuletzt geprüft vor {n} Min.',
      'items.checkedNow': 'gerade geprüft',

      'item.available': 'Verfügbar',
      'item.lent': 'Verliehen',
      'item.delete': 'Löschen',
      'item.ask': 'Anfragen',
      'item.deleted': '„{name}“ entfernt.',
      'item.undo': 'Rückgängig',
      'item.borrower': 'Verliehen an',
      'item.borrowerPlaceholder': 'Name, optional',
      'item.since': 'seit',
      'item.lentTo': 'Verliehen an {name} seit {date}',
      'item.lentSince': 'Verliehen seit {date}',
      'item.lentToPlain': 'Verliehen an {name}',

      'modal.name': 'Gegenstand',
      'modal.note': 'Notiz',
      'modal.status': 'Verfügbarkeit',
      'modal.done': 'Fertig',
      'modal.close': 'Schließen',

      'request.headline': '{item} anfragen',
      'request.mail': 'Per E-Mail anfragen',
      'request.share': 'Anfrage teilen',
      'request.copy': 'Anfragetext kopieren',
      'request.copied': 'Anfragetext kopiert.',
      'request.subject': 'Leihanfrage: {item}',
      'request.body': 'Hallo, ich möchte {item} ausleihen. Passt das bei Dir?',
      'request.bodyNamed': 'Hallo {name}, ich möchte {item} ausleihen. Passt das bei Dir?',

      'settings.headline': 'Einstellungen',
      'settings.pageHint': 'Diese Angaben gelten für diesen Browser, nicht für Deine Listen.',
      'settings.back': 'Zurück zur Liste',
      'settings.backStart': 'Zurück zur Startseite',
      'contact.headline': 'Kontakt',
      'contact.sub': 'Name und E-Mail für Anfragen',
      'contact.name': 'Dein Name',
      'contact.namePlaceholder': '',
      'contact.nameHint': 'Steht über der Liste und in der Anrede, wenn jemand anfragt.',
      'contact.hint': 'Diese Angaben werden mitverschlüsselt und nur für die Anfrage-Schaltflächen Deiner Freunde genutzt.',
      'settings.themeHeadline': 'Erscheinungsbild',
      'settings.themeSystem': 'Wie das System',
      'settings.themeLight': 'Hell',
      'settings.themeDark': 'Dunkel',
      'settings.cacheHeadline': 'Zwischenspeicher',
      'settings.cacheHint': 'Entfernt alles, was diese Anwendung in diesem Browser ablegt: Sprache, Erscheinungsbild, KI-Schlüssel und im Vorschaumodus die lokal gehaltenen Listen. Deine Liste auf dem Server und Deine Links bleiben unberührt.',
      'settings.cacheClear': 'Zwischenspeicher löschen',
      'settings.cacheConfirm': 'Alles löschen, was diese Anwendung in diesem Browser ablegt? Die Liste auf dem Server bleibt bestehen.',
      'settings.cacheDone': 'Zwischenspeicher geleert.',
      'settings.dangerHeadline': 'Liste löschen',
      'settings.dangerHint': 'Die Liste wird unwiderruflich vom Server entfernt. Beide Links laufen danach ins Leere.',
      'settings.email': 'E-Mail für Anfragen',
      'settings.showBorrower': 'Namen der Ausleihenden auch im Ansehen-Link zeigen',
      'settings.delete': 'Liste endgültig löschen',
      'settings.deleteConfirm': 'Die gesamte Liste wird unwiderruflich vom Server gelöscht. Fortfahren?',
      'settings.deleted': 'Liste gelöscht.',
      'settings.aiHeadline': 'Sprache und KI-Strukturierung',
      'settings.aiHint': 'Ohne Schlüssel zerlegt der Browser den gesprochenen Text selbst. Mit einem eigenen Gemini-Schlüssel übernimmt das die KI, dann verlässt der gesprochene Text Dein Gerät.',
      'settings.aiKey': 'Gemini-API-Schlüssel, optional',
      'settings.aiKeyHint': 'Bleibt ausschließlich in diesem Browser. Er wird weder auf den Server übertragen noch in die Liste aufgenommen und gilt daher nicht für Deine Freunde.',
      'settings.aiProxy': 'Dieser Server bietet eine KI-Strukturierung an. Ohne eigenen Schlüssel wird der gesprochene Text dorthin übertragen.',
      'settings.aiKeySaved': 'Schlüssel im Browser gespeichert.',
      'settings.aiKeyCleared': 'Schlüssel aus dem Browser entfernt.',

      'voice.start': 'Einsprechen',
      'voice.bulk': 'Mehrere auf einmal',
      'voice.stop': 'Aufnahme beenden',
      'voice.textLabel': 'Erkannter Text',
      'voice.placeholder': 'Mehrere Gegenstände am Stück sprechen oder eintippen',
      'voice.apply': 'Übernehmen',
      'voice.listening': 'Hört zu …',
      'voice.processing': 'Wird ausgewertet …',
      'voice.hintLocal': 'Zerlegung findet im Browser statt. Ein Gemini-Schlüssel in den Einstellungen liefert bessere Ergebnisse.',
      'voice.hintAi': 'Gemini strukturiert den Text. Er wird dazu an Google übertragen.',
      'voice.hintProxy': 'Die Strukturierung übernimmt der Server dieser Anwendung.',
      'voice.hintNoSpeech': 'Dieser Browser kennt keine Spracherkennung. Eintippen und Übernehmen funktioniert trotzdem.',
      'voice.added': '{n} Gegenstände übernommen.',
      'voice.added_1': 'Ein Gegenstand übernommen.',
      'voice.none': 'Daraus ließ sich kein Gegenstand ableiten.',
      'voice.denied': 'Zugriff auf das Mikrofon wurde abgelehnt.',
      'voice.noSpeechHeard': 'Nichts verstanden. Bitte noch einmal.',
      'voice.errorMic': 'Die Spracherkennung ist fehlgeschlagen.',
      'voice.errorAi': 'Die KI war nicht erreichbar; der Text wurde im Browser zerlegt.',
      'voice.insecure': 'Spracheingabe benötigt eine HTTPS-Verbindung.',

      'status.saved': 'Gespeichert',
      'status.saving': 'Speichere …',
      'status.unsaved': 'Nicht gespeichert',
      'status.error': 'Speichern fehlgeschlagen',
      'status.overwritten': 'Die Liste wurde parallel geändert. Dein Stand wurde übernommen.',
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

      'footer.imprint': 'Impressum',
      'footer.privacy': 'Datenschutz',
      'footer.about': 'Über'
    },

    en: {
      'a11y.skip': 'Skip to content',
      'a11y.lang': 'Auf Deutsch umschalten',
      'banner.preview': 'Preview mode: no PHP backend reachable. Lists are stored locally in this browser only. Handy for trying out the interface.',
      'badge.local': 'local',

      'hero.a': 'Borrow',
      'hero.b': 'it',
      'hero.c': 'from me.',
      'hero.lead': 'Send your list of things to lend to other people.',

      'trust.label': 'Properties',
      'trust.tracking': 'Free',
      'trust.account': 'No ads',
      'trust.ads': 'No login',
      'trust.crypto': 'Encrypted',

      'steps.headline': 'How it works',
      'steps.one': 'Add your things',
      'steps.oneText': 'Type or speak. Just the name at first, everything else sits behind the entry.',
      'steps.two': 'Add your contact details',
      'steps.twoText': 'Name and e-mail, so your friends can reach you. Both are encrypted with the list.',
      'steps.three': 'Pass the link on',
      'steps.threeText': 'Friends see what is free right now and ask with one click.',

      'start.create': 'Create a new list',
      'start.creating': 'Creating list …',

      'list.titleLabel': 'List title',
      'list.titlePlaceholder': 'List title',
      'list.untitled': 'Lending catalogue',
      'list.updated': 'Last updated: {date}',
      'list.by': 'List by {name}',
      'list.free': '{n} free right now',
      'list.free_1': '1 free right now',
      'list.lentCount': '{n} lent out',
      'list.newTitle': 'My lending list',

      'mine.headline': 'Your lists on this device',
      'mine.link': 'My lists',

      'key.headline': 'Keep this link!',
      'key.label': 'Edit link',
      'key.remember': 'Remembered on this device — next time you will find the list on the start page.',
      'key.done': 'I have saved the link',

      'share.headline': 'Share link',
      'share.tabView': 'View',
      'share.tabEdit': 'Edit',
      'share.viewHint': 'This is the link your friends get. It shows the list; nothing can be changed with it.',
      'share.editHint': 'This link is your way in. Give it to nobody and bookmark it.',
      'share.viewLabel': 'View link for friends',
      'share.editLabel': 'Edit link, secret',
      'share.copy': 'Copy',
      'share.send': 'Share',
      'share.message': 'Have a look at what I lend out: {title}',
      'share.copied': 'Link copied.',
      'share.copyfail': 'Copying failed. Please select the link by hand.',
      'share.reveal': 'Show',
      'share.hide': 'Hide',
      'share.hint': 'The key lives behind the # sign and is technically never sent to the server.',

      'add.nameLabel': 'Item',
      'add.namePlaceholder': 'e.g. cordless drill',
      'add.notePlaceholder': 'Note, optional',
      'add.submit': 'Add',

      'items.headline': 'Inventory',
      'items.refresh': 'Refresh',
      'items.count': '{n} items',
      'items.count_1': '1 item',
      'items.empty': 'Nothing here yet. Add your first item above.',
      'items.emptyView': 'This list is empty at the moment.',
      'items.checked': 'checked {n} min ago',
      'items.checkedNow': 'just checked',

      'item.available': 'Available',
      'item.lent': 'Lent out',
      'item.delete': 'Delete',
      'item.ask': 'Ask',
      'item.deleted': '“{name}” removed.',
      'item.undo': 'Undo',
      'item.borrower': 'Lent to',
      'item.borrowerPlaceholder': 'Name, optional',
      'item.since': 'since',
      'item.lentTo': 'Lent to {name} since {date}',
      'item.lentSince': 'Lent out since {date}',
      'item.lentToPlain': 'Lent to {name}',

      'modal.name': 'Item',
      'modal.note': 'Note',
      'modal.status': 'Availability',
      'modal.done': 'Done',
      'modal.close': 'Close',

      'request.headline': 'Ask for {item}',
      'request.mail': 'Ask by e-mail',
      'request.share': 'Share request',
      'request.copy': 'Copy request text',
      'request.copied': 'Request text copied.',
      'request.subject': 'Borrowing request: {item}',
      'request.body': 'Hi, I would like to borrow {item}. Does that work for you?',
      'request.bodyNamed': 'Hi {name}, I would like to borrow {item}. Does that work for you?',

      'settings.headline': 'Settings',
      'settings.pageHint': 'These apply to this browser, not to your lists.',
      'settings.back': 'Back to the list',
      'settings.backStart': 'Back to the start page',
      'contact.headline': 'Contact',
      'contact.sub': 'Name and e-mail for requests',
      'contact.name': 'Your name',
      'contact.namePlaceholder': '',
      'contact.nameHint': 'Shown above the list and in the greeting when somebody asks.',
      'contact.hint': 'These details are encrypted along with the list and only feed the request buttons your friends see.',
      'settings.themeHeadline': 'Appearance',
      'settings.themeSystem': 'Follow the system',
      'settings.themeLight': 'Light',
      'settings.themeDark': 'Dark',
      'settings.cacheHeadline': 'Local data',
      'settings.cacheClear': 'Clear local data',
      'settings.cacheHint': 'Removes everything this application stores in this browser: language, appearance, AI key, and in preview mode the locally held lists. Your list on the server and your links stay untouched.',
      'settings.cacheConfirm': 'Remove everything this application stores in this browser? The list on the server stays.',
      'settings.cacheDone': 'Local data cleared.',
      'settings.dangerHeadline': 'Delete list',
      'settings.dangerHint': 'The list is irreversibly removed from the server. Both links then lead nowhere.',
      'settings.email': 'E-mail for requests',
      'settings.showBorrower': 'Show borrower names in the view link as well',
      'settings.delete': 'Delete list permanently',
      'settings.deleteConfirm': 'The entire list will be irreversibly deleted from the server. Continue?',
      'settings.deleted': 'List deleted.',
      'settings.aiHeadline': 'Voice and AI structuring',
      'settings.aiHint': 'Without a key the browser splits the spoken text itself. With your own Gemini key the AI takes over, and the spoken text then leaves your device.',
      'settings.aiKey': 'Gemini API key, optional',
      'settings.aiKeyHint': 'Stays in this browser only. It is never sent to the server and never stored in the list, so it does not apply to your friends.',
      'settings.aiProxy': 'This server offers AI structuring. Without your own key the spoken text is sent there.',
      'settings.aiKeySaved': 'Key stored in this browser.',
      'settings.aiKeyCleared': 'Key removed from this browser.',

      'voice.start': 'Speak items',
      'voice.bulk': 'Several at once',
      'voice.stop': 'Stop recording',
      'voice.textLabel': 'Recognised text',
      'voice.placeholder': 'Say or type several items in one go',
      'voice.apply': 'Apply',
      'voice.listening': 'Listening …',
      'voice.processing': 'Processing …',
      'voice.hintLocal': 'Splitting happens in your browser. A Gemini key in the settings gives better results.',
      'voice.hintAi': 'Gemini structures the text. It is sent to Google for that.',
      'voice.hintProxy': 'This application\u2019s server handles the structuring.',
      'voice.hintNoSpeech': 'This browser has no speech recognition. Typing and Apply still works.',
      'voice.added': '{n} items added.',
      'voice.added_1': 'One item added.',
      'voice.none': 'No item could be derived from that.',
      'voice.denied': 'Microphone access was denied.',
      'voice.noSpeechHeard': 'Nothing understood. Please try again.',
      'voice.errorMic': 'Speech recognition failed.',
      'voice.errorAi': 'The AI was unreachable; the text was split in the browser.',
      'voice.insecure': 'Voice input requires an HTTPS connection.',

      'status.saved': 'Saved',
      'status.saving': 'Saving …',
      'status.unsaved': 'Not saved',
      'status.error': 'Saving failed',
      'status.overwritten': 'The list was changed elsewhere. Your version was kept.',
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

      'footer.imprint': 'Imprint',
      'footer.privacy': 'Privacy',
      'footer.about': 'About'
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
    $$('[data-i18n-label]').forEach(function (node) {
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-label')));
    });
    $$('[data-i18n-title]').forEach(function (node) {
      node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
    });
    /* Regel 19: das Bedienelement zeigt das Ziel, nicht den Zustand. */
    var langBtn = $('#btnLang');
    if (langBtn) {
      var target = (lang === 'de') ? 'en' : 'de';
      langBtn.textContent = target.toUpperCase();
      langBtn.setAttribute('title', t('a11y.lang'));
      langBtn.setAttribute('aria-label', t('a11y.lang'));
    }
    /* Das Abzeichen nennt den Speicherort nur dann, wenn er vom Erwarteten
       abweicht: im Vorschaumodus liegt die Liste im Browser, sonst auf dem
       Server, und Letzteres muss niemand lesen. */
    var badge = $('#storageBadge');
    if (Store && badge) {
      badge.textContent = t('badge.local');
      badge.hidden = (Store.kind !== 'local');
    }
    updateVoiceHint();
    if (window.LeihTheme) { window.LeihTheme.setLang(lang); }
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
  var serverInfo = null;   // Antwort von ?a=ping; nennt u. a. einen angebotenen KI-Proxy

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
      if (ok) { serverInfo = res.body; }
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
    saving: false,
    checkedAt: 0     // Zeitpunkt des letzten erfolgreichen Serverabgleichs
  };

  var saveTimer = null;
  var refreshTimer = null;
  var docGen = 0;   // zählt Änderungen; erkennt Bearbeitungen während eines Schreibvorgangs
  var voiceOpen = false;   // die Sprachbox steht zu, bis das Mikrofon oder der Verweis sie öffnet

  function emptyDoc() {
    return {
      v: SCHEMA_VERSION,
      title: '',
      contact: { name: '', email: '' },
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
      doc.contact.name = typeof raw.contact.name === 'string' ? raw.contact.name.slice(0, 60) : '';
      doc.contact.email = typeof raw.contact.email === 'string' ? raw.contact.email : '';
      /* Eine frueher gepflegte Telefonnummer wird nicht mehr uebernommen:
         Die Anfrage laeuft jetzt ueber die Weitergabe des Geraets und ist
         damit an keinen Dienst gebunden. */
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

  /* ------------------------------------------------------------------ *
   * Eigene Listen, auf diesem Gerät gemerkt
   *
   * Kein Konto, kein Server: eine Zeile im localStorage, die den Bearbeiten-
   * Link derselben Herkunft festhält, in der er ohnehin schon steht — im
   * Verlauf des Browsers. Sie erspart den häufigsten Verlustfall, nämlich den
   * geschlossenen Reiter, und verschwindet mit „Zwischenspeicher löschen".
   * ------------------------------------------------------------------ */

  function readMine() {
    var raw = null;
    try { raw = localStorage.getItem(LS_MINE); } catch (e) { return []; }
    if (!raw) { return []; }
    var list;
    try { list = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(list)) { return []; }
    return list.filter(function (entry) {
      return entry && typeof entry.id === 'string' && typeof entry.hash === 'string';
    });
  }

  function writeMine(list) {
    try { localStorage.setItem(LS_MINE, JSON.stringify(list.slice(0, MINE_MAX))); }
    catch (e) { /* privater Modus oder voll: dann eben nicht */ }
  }

  /** Legt die Liste vorn ab oder frischt ihren Eintrag auf. */
  function rememberList() {
    if (state.mode !== 'edit' || !state.id || !state.token) { return; }
    var entry = {
      id: state.id,
      hash: editHash(state.id, state.keyStr, state.token),
      title: state.doc.title || '',
      ts: Date.now()
    };
    var rest = readMine().filter(function (it) { return it.id !== entry.id; });
    rest.unshift(entry);
    writeMine(rest);
  }

  function forgetList(id) {
    writeMine(readMine().filter(function (it) { return it.id !== id; }));
  }

  /** Im privaten Fenster schlaegt das Merken fehl; dann darf es auch niemand
      versprechen. */
  function mineWorks() {
    return readMine().some(function (it) { return it.id === state.id; });
  }

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

  var shownView = null;

  function showView(name) {
    ['viewStart', 'viewList', 'viewError'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) { node.hidden = (id !== name); }
    });
    /* Die Startseite steht in drei Spalten und braucht mehr Breite als eine
       Liste von Gegenstaenden, die schmal besser zu lesen ist. */
    var main = document.getElementById('main');
    if (main) { main.classList.toggle('page--wide', name === 'viewStart'); }

    /* Ein Wechsel der Ansicht ist ein Ortswechsel und beginnt deshalb oben.
       Der Browser behaelt den Rollstand sonst bei, weil das Dokument
       dasselbe bleibt: Wer die Schaltflaeche am Fuss der Startseite bedient,
       landete mitten in der neuen Liste, beim Teilen statt beim Anfang. */
    if (shownView !== null && shownView !== name) { window.scrollTo(0, 0); }
    shownView = name;
  }

  function showError(code) {
    state.mode = 'error';
    $('#errorText').textContent = t('error.' + code) || t('error.network');
    showView('viewError');
  }

  var toastTimer = null;

  /**
   * Meldung am unteren Rand. Mit `action` traegt sie eine Gegenhandlung und
   * bleibt laenger stehen: Das ersetzt die Rueckfrage vor dem Loeschen durch
   * die Moeglichkeit, es zurueckzunehmen.
   *
   * @param {string} msg
   * @param {{label: string, run: function}=} action
   */
  function toast(msg, action) {
    var node = $('#toast');
    var act = $('#toastAct');
    $('#toastText').textContent = msg;
    clearTimeout(toastTimer);

    if (action) {
      act.textContent = action.label;
      act.hidden = false;
      act.onclick = function () {
        clearTimeout(toastTimer);
        node.hidden = true;
        act.hidden = true;
        act.onclick = null;
        action.run();
      };
    } else {
      act.hidden = true;
      act.onclick = null;
    }

    node.hidden = false;
    toastTimer = setTimeout(function () {
      node.hidden = true;
      act.hidden = true;
      act.onclick = null;
    }, action ? UNDO_MS : 3600);
  }

  function setSaveState(kind) {
    var node = $('#saveState');
    if (!node) { return; }
    if (state.mode !== 'edit' || !kind) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.textContent = t('status.' + kind);
    node.className = 'chip' + (kind === 'saved' ? ' chip--ok' : (kind === 'error' ? ' chip--warn' : ''));
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

    /* Bereiche, die nur im Bearbeitenmodus sichtbar sind */
    $('#shareBox').hidden = !isEdit;
    $('#addForm').hidden = !isEdit;
    $('#contactBox').hidden = !isEdit;
    $('#btnRefresh').hidden = isEdit;
    if (!isEdit) { $('#keyBox').hidden = true; }

    if (isEdit) {
      $('#linkView').value = viewLink();
      $('#linkEdit').value = editLink();
      if (document.activeElement !== $('#cfgName')) { $('#cfgName').value = state.doc.contact.name; }
      if (document.activeElement !== $('#cfgEmail')) { $('#cfgEmail').value = state.doc.contact.email; }
      $('#cfgShowBorrower').checked = state.doc.showBorrower;
    }

    /* Das Mikrofon steht neben dem Hinzufügen und erscheint nur, wenn der
       Browser Spracherkennung mitbringt. Die Box darunter bleibt zu, bis sie
       gebraucht wird; ohne Mikrofon führt der Verweis daneben hinein. */
    $('#btnMic').hidden = !speechSupported();
    $('#voiceBox').hidden = !(isEdit && voiceOpen);
    updateVoiceHint();

    /* Die Weitergabe des Geraets gibt es nicht ueberall; ohne sie bleibt Kopieren. */
    $('#btnShareView').hidden = !(isEdit && canShare());

    renderItems();
    updateSettingsLink();
    updateMineLink();
    setSaveState(state.saving ? 'saving' : (state.dirty ? 'unsaved' : 'saved'));
  }

  /**
   * Die Zeile unter dem Titel. Sie sagt im Bearbeiten-Modus, wie viel in der
   * Liste steht und wann zuletzt gespeichert wurde; im Ansehen-Modus, von wem
   * die Liste ist und was gerade frei ist — die einzige Zahl, die Freunde
   * wirklich interessiert.
   */
  function renderMeta() {
    var items = state.doc.items;
    var lent = 0;
    items.forEach(function (it) { if (it.status === 'lent') { lent++; } });
    var free = items.length - lent;
    var parts = [];

    if (state.mode === 'view') {
      var owner = (state.doc.contact.name || '').trim();
      if (owner) { parts.push(t('list.by', { name: owner })); }
      parts.push(free === 1 ? t('list.free_1') : t('list.free', { n: free }));
    } else {
      parts.push(items.length === 1 ? t('items.count_1') : t('items.count', { n: items.length }));
      if (lent > 0) { parts.push(t('list.lentCount', { n: lent })); }
      if (state.updated) { parts.push(t('list.updated', { date: formatDate(state.updated) })); }
    }
    $('#listMeta').textContent = parts.join(' · ');
  }

  /** „zuletzt geprüft vor …" — macht die Schaltfläche daneben entbehrlich. */
  function renderChecked() {
    var node = $('#checkedAt');
    if (!node) { return; }
    if (state.mode !== 'view' || !state.checkedAt) { node.textContent = ''; return; }
    var min = Math.round((Date.now() - state.checkedAt) / 60000);
    node.textContent = min < 1 ? t('items.checkedNow') : t('items.checked', { n: min });
  }

  /** Zeichnet nur die Liste neu, etwa wenn im Fenster ein Name geaendert wird. */
  function renderItems() {
    var items = state.doc.items;
    var listNode = $('#itemList');
    listNode.className = 'items' + (state.mode === 'view' ? ' items--read' : '');
    listNode.textContent = '';
    items.forEach(function (item) { listNode.appendChild(renderRow(item)); });

    $('#itemsEmpty').hidden = items.length > 0;
    $('#itemsEmptyText').textContent = t(state.mode === 'edit' ? 'items.empty' : 'items.emptyView');
    renderMeta();
    renderChecked();
  }

  /**
   * Die gemerkten Listen auf der Startseite. Sie stehen dort, wo jemand sie
   * sucht, der den Reiter geschlossen hat — und nur dann, wenn es sie gibt.
   */
  function updateMineLink() {
    var link = $('#lnkMine');
    if (!link) { return; }
    link.hidden = !(readMine().length > 0 && state.mode !== 'start');
  }

  function renderMine() {
    var box = $('#mineBox');
    var list = $('#mineList');
    if (!box || !list) { return; }
    var mine = readMine();
    list.textContent = '';
    box.hidden = mine.length === 0;
    if (!mine.length) { return; }

    updateMineLink();
    mine.forEach(function (entry) {
      var li = el('li');
      var a = el('a');
      a.href = entry.hash;
      a.appendChild(el('span', 'name', entry.title || t('list.untitled')));
      if (entry.ts) { a.appendChild(el('span', 'when', formatDay(new Date(entry.ts).toISOString().slice(0, 10)))); }
      a.appendChild(icon('chev'));
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function statusLabel(item) { return t(item.status === 'lent' ? 'item.lent' : 'item.available'); }

  /** Die runde Marke links in der Zeile. Sie traegt die einzige Aussage, die
      sich auf einen Blick lesen lassen muss: frei oder nicht. */
  function statusBadge(item) {
    var lent = item.status === 'lent';
    var badge = el('span', 'item-badge');
    badge.appendChild(icon(lent ? 'out' : 'check'));
    return badge;
  }

  /** Wer hat es, und seit wann. Ohne Namen bleibt es bei der Tatsache. */
  function lentLine(item) {
    var show = state.mode === 'edit' || state.doc.showBorrower;
    var who = (item.borrower || '').trim();
    if (show && who && item.since) { return t('item.lentTo', { name: who, date: formatDay(item.since) }); }
    if (show && who) { return t('item.lentToPlain', { name: who }); }
    if (item.since) { return t('item.lentSince', { date: formatDay(item.since) }); }
    return t('item.lent');
  }

  /**
   * Eine Zeile im Inventar. Verfuegbares bleibt schmucklos — dass etwas da
   * ist, ist der Normalfall und braucht keine Auszeichnung. Verliehenes
   * traegt, was man wissen will: bei wem und seit wann, in der Zeile und
   * nicht erst im Fenster dahinter.
   *
   * Im Ansehen-Modus steht die Anfrage in der Zeile. Sie ist der Zweck der
   * Seite und hat nichts hinter einem zweiten Tipper verloren.
   */
  function renderRow(item) {
    var lent = item.status === 'lent';
    var li = el('li', 'item item--' + item.status);
    li.setAttribute('data-id', item.id);

    var text = el('span', 'item-text');
    text.appendChild(el('span', 'item-name', item.name));
    if (lent) { text.appendChild(el('span', 'item-state', lentLine(item))); }
    else if (item.note) { text.appendChild(el('span', 'item-note', item.note)); }

    if (state.mode === 'view') {
      var row = el('div', 'itemrow' + (lent ? ' items-read-lent' : ''));
      row.appendChild(statusBadge(item));
      row.appendChild(text);
      if (!lent) {
        var ask = el('button', 'btn btn--primary btn--sm item-ask');
        ask.type = 'button';
        ask.setAttribute('data-act', 'ask');
        ask.textContent = t('item.ask');
        row.appendChild(ask);
      }
      li.appendChild(row);
      return li;
    }

    var btn = el('button', 'itemrow');
    btn.type = 'button';
    btn.setAttribute('data-act', 'open');
    btn.appendChild(statusBadge(item));
    btn.appendChild(text);
    btn.appendChild(el('span', 'sr-only', statusLabel(item)));
    var chev = el('span', 'item-chev');
    chev.appendChild(icon('chev'));
    btn.appendChild(chev);
    li.appendChild(btn);
    return li;
  }

  /* ------------------------------------------------------------------ *
   * Fenster zu einem Gegenstand
   * ------------------------------------------------------------------ */

  var modalItemId = null;

  function modalField(labelText, node) {
    var field = el('div', 'field');
    var label = el('label', 'field__label', labelText);
    label.setAttribute('for', node.id);
    field.appendChild(label);
    field.appendChild(node);
    return field;
  }

  function textInput(id, value, max, placeholder) {
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'input';
    input.value = value || '';
    input.maxLength = max;
    if (placeholder) { input.placeholder = placeholder; }
    return input;
  }

  /**
   * Der Inhalt des Fensters im Bearbeiten-Modus. Der Name steht hier als
   * Feld, nicht noch einmal als Ueberschrift: zweimal dasselbe Wort
   * uebereinander sagt nichts doppelt so gut.
   */
  /**
   * Der Kopf des Fensters. Im Bearbeiten-Modus ist die Ueberschrift selbst
   * das Feld: Der Name eines Gegenstands zweimal untereinander zu zeigen,
   * einmal als Titel und einmal als Eingabe, sagt nichts doppelt so gut.
   */
  function buildModalHead(item) {
    var head = $('#modalTitle');
    var dialog = $('#itemModal');
    head.textContent = '';

    if (state.mode !== 'edit') {
      head.textContent = t('request.headline', { item: item.name });
      dialog.setAttribute('aria-label', head.textContent);
      return;
    }

    var label = el('label', 'sr-only', t('modal.name'));
    label.setAttribute('for', 'mdName');
    var name = textInput('mdName', item.name, 120);
    name.className = 'input modal-title-input';
    name.addEventListener('input', function () {
      item.name = this.value;
      dialog.setAttribute('aria-label', this.value);
      touch();
      renderItems();
    });
    head.appendChild(label);
    head.appendChild(name);
    dialog.setAttribute('aria-label', item.name);
  }

  function buildModalBody(item) {
    var body = $('#modalBody');
    body.textContent = '';

    var note = textInput('mdNote', item.note, 200, t('add.notePlaceholder'));
    note.addEventListener('input', function () { item.note = this.value; touch(); renderItems(); });
    body.appendChild(modalField(t('modal.note'), note));

    /* Zweistellige Wahl statt einer Schaltflaeche, die ihren eigenen Zustand
       nicht verraet: Beide Moeglichkeiten stehen nebeneinander, die geltende
       ist gefuellt. */
    var field = el('div', 'field');
    field.appendChild(el('span', 'field__label', t('modal.status')));
    var seg = el('div', 'seg');

    var free = el('button', null);
    free.type = 'button';
    free.textContent = t('item.available');
    free.setAttribute('aria-pressed', item.status === 'available' ? 'true' : 'false');
    free.addEventListener('click', function () {
      if (item.status === 'available') { return; }
      toggleItem(item.id);
      refreshModal();
    });

    var lent = el('button', 'is-lent');
    lent.type = 'button';
    lent.textContent = t('item.lent');
    lent.setAttribute('aria-pressed', item.status === 'lent' ? 'true' : 'false');
    lent.addEventListener('click', function () {
      if (item.status === 'lent') { return; }
      toggleItem(item.id);
      refreshModal();
    });

    seg.appendChild(free);
    seg.appendChild(lent);
    field.appendChild(seg);
    body.appendChild(field);

    if (item.status === 'lent') {
      var who = textInput('mdBorrower', item.borrower, 80, t('item.borrowerPlaceholder'));
      who.addEventListener('input', function () { item.borrower = this.value; touch(); renderItems(); });
      body.appendChild(modalField(t('item.borrower'), who));

      var since = document.createElement('input');
      since.type = 'date';
      since.id = 'mdSince';
      since.className = 'input';
      since.value = item.since || '';
      since.addEventListener('input', function () { item.since = this.value; touch(); renderItems(); });
      body.appendChild(modalField(t('item.since'), since));
    }
  }

  /**
   * Die Fussleiste. Loeschen steht links und traegt keine Flaeche: Es ist die
   * einzige Handlung hier, die sich nicht zuruecknehmen laesst, indem man sie
   * noch einmal ausfuehrt — und genau deshalb darf sie nicht wie die erste
   * Wahl aussehen. Die Rueckfrage entfaellt, dafuer laesst sich das Loeschen
   * neun Sekunden lang zuruecknehmen.
   */
  function buildModalFoot(item) {
    var foot = $('#modalFoot');
    foot.textContent = '';

    var del = el('button', 'btn btn--danger');
    del.type = 'button';
    del.appendChild(icon('trash'));
    del.appendChild(el('span', null, t('item.delete')));
    del.addEventListener('click', function () {
      var id = item.id;
      closeItemModal();
      deleteItem(id);
    });
    foot.appendChild(del);

    var done = el('button', 'btn btn--primary');
    done.type = 'button';
    done.textContent = t('modal.done');
    done.addEventListener('click', closeItemModal);
    foot.appendChild(done);
  }

  function openItemModal(id) {
    var item = findItem(id);
    if (!item || state.mode !== 'edit') { return; }
    modalItemId = id;
    buildModalHead(item);
    buildModalBody(item);
    buildModalFoot(item);
    openDialog();
  }

  /**
   * Das Fenster, das Freunde sehen: nur die Wege, ueber die sie anfragen
   * koennen. Es traegt keinen weiteren Inhalt, weil alles Uebrige bereits in
   * der Zeile steht.
   */
  function openAskModal(id) {
    var item = findItem(id);
    if (!item || item.status !== 'available') { return; }
    modalItemId = id;
    buildModalHead(item);

    var body = $('#modalBody');
    body.textContent = '';
    body.appendChild(el('p', 'hint', requestBody(item)));

    var foot = $('#modalFoot');
    foot.textContent = '';
    var close = el('button', 'btn btn--ghost');
    close.type = 'button';
    close.textContent = t('modal.close');
    close.addEventListener('click', closeItemModal);
    foot.appendChild(close);
    foot.appendChild(el('span', 'spacer'));
    requestActions(item).forEach(function (node) { foot.appendChild(node); });

    openDialog();
  }

  function openDialog() {
    var dialog = $('#itemModal');
    if (dialog.showModal) { dialog.showModal(); } else { dialog.setAttribute('open', 'open'); }
  }

  function refreshModal() {
    var item = findItem(modalItemId);
    if (!item) { closeItemModal(); return; }
    buildModalBody(item);
    buildModalFoot(item);
  }

  function closeItemModal() {
    var dialog = $('#itemModal');
    if (dialog.close) { dialog.close(); } else { dialog.removeAttribute('open'); }
    modalItemId = null;
  }

  /* ------------------------------------------------------------------ *
   * Weitergabe
   * ------------------------------------------------------------------ */

  function canShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  /**
   * Reicht Text oder Verweis an das Gerät weiter, das daraufhin jede
   * installierte Anwendung anbietet. Ein Abbruch durch die Nutzerin ist kein
   * Fehler und bleibt deshalb stumm.
   */
  function nativeShare(data) {
    if (!canShare()) { return Promise.resolve(false); }
    return navigator.share(data).then(function () { return true; }, function () { return false; });
  }

  /**
   * Anfrage zu einem Gegenstand. Kein Dienst ist fest verdrahtet: Entweder
   * E-Mail, wenn eine Adresse hinterlegt ist, oder die Weitergabe des Geraets,
   * und als Rueckfallebene die Zwischenablage.
   *
   * @return {Array<HTMLElement>}
   */
  /** Mit hinterlegtem Namen wird die Anfrage persoenlich angesprochen. */
  function requestBody(item) {
    var owner = (state.doc.contact.name || '').trim();
    return owner
      ? t('request.bodyNamed', { name: owner, item: item.name })
      : t('request.body', { item: item.name });
  }

  function requestActions(item) {
    var nodes = [];
    var subject = t('request.subject', { item: item.name });
    var body = requestBody(item);
    var email = (state.doc.contact.email || '').trim();

    /* Hat die Besitzerin eine Adresse hinterlegt, ist das ihr Weg, und der
       traegt deshalb die Flaeche. Sonst fuehrt die Weitergabe des Geraets. */
    if (email) {
      var mail = el('a', 'btn btn--primary');
      mail.href = 'mailto:' + encodeURIComponent(email) +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      mail.rel = 'noopener';
      mail.appendChild(icon('mail'));
      mail.appendChild(el('span', null, t('request.mail')));
      nodes.push(mail);
    }

    if (canShare()) {
      var share = el('button', email ? 'btn' : 'btn btn--primary');
      share.type = 'button';
      share.appendChild(icon('share'));
      share.appendChild(el('span', null, t('request.share')));
      share.addEventListener('click', function () { nativeShare({ text: body }); });
      nodes.push(share);
    } else if (!email) {
      var copy = el('button', 'btn btn--primary');
      copy.type = 'button';
      copy.textContent = t('request.copy');
      copy.addEventListener('click', function () {
        copyText(body).then(function (ok) { toast(t(ok ? 'request.copied' : 'share.copyfail')); });
      });
      nodes.push(copy);
    }
    return nodes;
  }

  /** Schaltet zwischen den Reitern im Abschnitt Link teilen. */
  function selectTab(name) {
    ['View', 'Edit'].forEach(function (key) {
      var active = (key === name);
      $('#tabBtn' + key).setAttribute('aria-selected', active ? 'true' : 'false');
      $('#tab' + key).hidden = !active;
    });
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
        rememberList();
        renderMeta();
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

  /**
   * Loeschen ohne Rueckfrage, dafuer mit Rueckweg: Der Eintrag verschwindet
   * sofort, und die Meldung bietet neun Sekunden lang an, ihn an seine Stelle
   * zurueckzusetzen. Das ist die freundlichere Ordnung — eine Abfrage vor
   * jedem Loeschen wird nach dem dritten Mal ohnehin weggeklickt, und dann
   * schuetzt sie niemanden mehr.
   */
  function deleteItem(id) {
    var index = -1;
    for (var i = 0; i < state.doc.items.length; i++) {
      if (state.doc.items[i].id === id) { index = i; break; }
    }
    if (index < 0) { return; }

    var removed = state.doc.items[index];
    state.doc.items.splice(index, 1);
    touch();
    render();

    toast(t('item.deleted', { name: removed.name }), {
      label: t('item.undo'),
      run: function () {
        /* Die Liste kann sich zwischenzeitlich geaendert haben; der Eintrag
           kehrt an seine alte Stelle zurueck, hoechstens ans Ende. */
        var at = Math.min(index, state.doc.items.length);
        state.doc.items.splice(at, 0, removed);
        touch();
        render();
      }
    });
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
    doc.title = t('list.newTitle');
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
        rememberList();
        render();
        stopRefresh();

        /* Der Zugang, einmal und deutlich. Er steht ueber allem anderen, bis
           er bestaetigt wurde: Wer diesen Link verliert, verliert die Liste,
           und niemand kann ihn wiederherstellen. */
        $('#keyLink').value = editLink();
        $('#keyBox').hidden = false;
        $('#keyRemember').hidden = !mineWorks();
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
      state.checkedAt = Date.now();
      if (state.mode === 'edit') { rememberList(); }
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
      state.checkedAt = Date.now();
      if (res.body.unchanged) {
        renderChecked();
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

  /**
   * Leert alles, was diese Anwendung im Browser ablegt. Die Liste auf dem
   * Server bleibt; im Vorschaumodus ist der lokale Speicher allerdings der
   * Server, dort verschwindet sie mit. Der Hinweis daneben sagt das.
   */
  function clearLocalData() {
    if (!window.confirm(t('settings.cacheConfirm'))) { return; }
    try {
      var doomed = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('lid.') === 0) { doomed.push(key); }
      }
      doomed.forEach(function (key) { localStorage.removeItem(key); });
    } catch (e) { /* privater Modus: dann gab es nichts zu loeschen */ }
    toast(t('settings.cacheDone'));
    setTimeout(function () { location.reload(); }, 600);
  }

  function deleteList() {
    if (state.mode !== 'edit') { return; }
    if (!window.confirm(t('settings.deleteConfirm'))) { return; }
    Store.remove(state.id, state.proof).then(function (res) {
      if (res.status !== 200) { throw new AppError(mapError(res)); }
      forgetList(state.id);
      state.mode = 'start';
      state.doc = null;
      if (isSettingsPage()) { location.href = './'; return; }
      history.replaceState(null, '', location.pathname);
      renderMine();
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
   * 12 · Spracheingabe und KI-Strukturierung
   *
   *     Zwei Wege führen von gesprochenem Freitext zu Einträgen:
   *     a) lokal im Browser über Trennwörter – ohne Schlüssel, ohne Übertragung,
   *     b) über Gemini – genauer, dafür verlässt der Text das Gerät.
   *     Der Schlüssel liegt ausschließlich im localStorage; er gehört bewusst
   *     nicht in das verschlüsselte Dokument, das Freunde lesen können.
   * ===================================================================== */

  /* Endpunkt und Kopfzeile sind gegen die Auskunftsdokumente von v1 und v1beta
     geprüft (Fassung 20260910). Die Modellkennung lässt sich unangemeldet nicht
     prüfen, weil die Anmeldung vor der Modellauflösung greift; gemini-2.5-flash
     ist die am besten belegte Kennung. Wer sie ändert, prüft sie vorher mit
     einem gültigen Schlüssel über GET /v1beta/models. */
  var AI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var AI_MODEL = 'gemini-2.5-flash';
  var AI_MAX_CHARS = 1500;
  var LS_AIKEY = 'lid.aikey';

  /* Systemanweisung: ausschließlich ein JSON-Array, kein Markdown, keine Erklärung. */
  var AI_SYSTEM_PROMPT = [
    'You convert a spoken inventory description into structured data.',
    'Return ONLY a valid JSON array. No markdown, no code fences, no commentary, no other keys.',
    'Format: [{"item": "Gegenstandsname", "status": "available"}]',
    'Rules:',
    '- "status" is exactly "available" or "lent". Use "lent" only when the speaker states the thing is currently lent out, borrowed or otherwise unavailable.',
    '- Keep "item" in the language the speaker used. Use a short, singular, capitalised noun phrase without articles, numerals or filler words.',
    '- Split enumerations into separate entries. If a count is stated, repeat the entry that many times, at most ten.',
    '- Ignore anything that is not a lendable object.',
    '- If nothing usable is present, return [].'
  ].join('\n');

  /* Erzwingt das Format zusätzlich auf Protokollebene, nicht nur per Anweisung.
     Der Typ wird hier groß geschrieben, das verlangt der Dialekt: eine Auswahl
     aus OpenAPI 3.0, nicht JSON Schema. Kein $ref, kein oneOf.
     responseSchema ist im Auskunftsdokument als abgekündigt markiert, arbeitet
     aber in v1 und v1beta und wird am breitesten unterstützt. Nachfolger sind
     responseJsonSchema und responseFormat; ein Wechsel gehört in einen eigenen
     Schritt, nicht nebenbei. */
  var AI_RESPONSE_SCHEMA = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        item: { type: 'STRING' },
        status: { type: 'STRING', enum: ['available', 'lent'] }
      },
      required: ['item', 'status']
    }
  };

  var speechRec = null;      // SpeechRecognition-Instanz, einmal erzeugt
  var speechActive = false;
  var speechFinal = '';      // bereits endgültig erkannte Wortfolgen
  var speechBefore = '';     // Feldinhalt beim Start, erkennt "nichts Neues gesagt"

  /* -- Schlüsselverwaltung (nur dieses Gerät) ----------------------------- */

  function getAiKey() {
    try { return localStorage.getItem(LS_AIKEY) || ''; } catch (e) { return ''; }
  }

  function setAiKey(value) {
    try {
      if (value) { localStorage.setItem(LS_AIKEY, value); }
      else { localStorage.removeItem(LS_AIKEY); }
    } catch (e) { /* privater Modus: dann eben nur für diese Sitzung */ }
  }

  function aiProxyAvailable() {
    return !!(Store && Store.kind === 'remote' && serverInfo && serverInfo.aiProxy);
  }

  /* -- Lokale Zerlegung --------------------------------------------------- */

  /* Füllwörter und Artikel am Anfang eines Fragments, beide Sprachen. */
  var FILLER_RE = /^(?:\s*(?:und|and|sowie|plus|auch|außerdem|noch|dann|also|ich\s+(?:habe|hab|besitze|verleihe)|i\s+(?:have|own|lend)|da\s+(?:ist|sind)|there\s+(?:is|are)|ein(?:e|en|em|er|es)?|der|die|das|den|dem|mein(?:e|en|em|er)?|unser(?:e|en)?|a|an|the|my|our)\b[\s,]*)+/i;

  /* Kennzeichnet einen als verliehen gesprochenen Gegenstand. */
  var LENT_RE = /\s*(?:\b(?:ist|sind|is|are)\b\s*)?(?:\b(?:gerade|zurzeit|aktuell|currently)\b\s*)?\b(?:verliehen|ausgeliehen|vergeben|lent(?:\s+out)?|borrowed|on\s+loan)\b\s*/i;

  /* Aufzählungstrenner. String.split zerlegt an allen Treffern. */
  var SPLIT_RE = /\s*(?:[,;\n\/]|\bund\b|\bsowie\b|\band\b|\bplus\b)\s*/i;

  var NUMBER_WORDS = {
    ein: 1, eine: 1, einen: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3,
    vier: 4, four: 4, fünf: 5, five: 5, sechs: 6, six: 6
  };

  /** Trennt eine führende Mengenangabe ab: "zwei Campingstühle" → 2 × "Campingstühle". */
  function splitCount(fragment) {
    var digits = /^(\d{1,2})\s+(.+)$/.exec(fragment);
    if (digits) {
      return { count: Math.min(10, Math.max(1, parseInt(digits[1], 10))), rest: digits[2] };
    }
    var word = /^([A-Za-zÄÖÜäöüß]+)\s+(.+)$/.exec(fragment);
    if (word && NUMBER_WORDS[word[1].toLowerCase()]) {
      return { count: NUMBER_WORDS[word[1].toLowerCase()], rest: word[2] };
    }
    return { count: 1, rest: fragment };
  }

  /** Gleicht gegen den Katalog ab – normalisiert Schreibweise, übersetzt aber nicht. */
  function canonicalName(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].de.toLowerCase() === lower) { return CATALOG[i].de; }
      if (CATALOG[i].en.toLowerCase() === lower) { return CATALOG[i].en; }
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Rückfallebene ohne KI: zerlegt den Freitext anhand von Trennwörtern.
   * Bewusst bescheiden – sie soll das Mikrofon ohne Schlüssel nutzbar machen,
   * nicht Sprachverstehen nachbilden.
   */
  function localStructure(text) {
    var entries = [];
    String(text).split(SPLIT_RE).forEach(function (raw) {
      var fragment = String(raw || '').replace(/[.!?]+\s*$/, '').trim();
      if (!fragment) { return; }

      var lent = LENT_RE.test(fragment);
      if (lent) { fragment = fragment.replace(LENT_RE, ' ').trim(); }

      fragment = fragment.replace(FILLER_RE, '').trim();
      if (fragment.length < 2) { return; }

      var parsed = splitCount(fragment);
      var name = parsed.rest.replace(FILLER_RE, '').trim();
      if (name.length < 2) { return; }
      name = canonicalName(name.slice(0, 80));

      for (var n = 0; n < parsed.count; n++) {
        entries.push({ item: name, status: lent ? 'lent' : 'available' });
      }
    });
    return entries;
  }

  /* -- KI-Strukturierung -------------------------------------------------- */

  /** Nimmt auch dann noch ein Array an, wenn das Modell Zaunzeichen mitschickt. */
  function parseAiJson(raw) {
    var text = String(raw || '').trim();
    var fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fenced) { text = fenced[1].trim(); }
    if (text.charAt(0) !== '[') {
      var start = text.indexOf('[');
      var end = text.lastIndexOf(']');
      if (start === -1 || end <= start) { throw new AppError('aiFormat'); }
      text = text.slice(start, end + 1);
    }
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new AppError('aiFormat'); }
    if (!Array.isArray(data)) { throw new AppError('aiFormat'); }
    return normaliseEntries(data);
  }

  /** Fremde Antworten defensiv behandeln: nur bekannte Felder, begrenzte Länge. */
  function normaliseEntries(list) {
    var out = [];
    (Array.isArray(list) ? list : []).slice(0, 50).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') { return; }
      var name = typeof entry.item === 'string' ? entry.item.trim() : '';
      if (name.length < 2) { return; }
      out.push({
        item: name.slice(0, 80),
        status: entry.status === 'lent' ? 'lent' : 'available'
      });
    });
    return out;
  }

  /**
   * Direkter Aufruf aus dem Browser. Das geht, weil die Gegenstelle CORS
   * erlaubt und dabei jede Herkunft zurückspiegelt.
   *
   * ACHTUNG, hier keinen weiteren Kopfzeileneintrag ergänzen. Die Vorabanfrage
   * prüft die angefragten Kopfzeilen gegen eine Erlaubnisliste. Erlaubt sind
   * content-type, x-goog-api-key, authorization, x-goog-api-client und
   * x-goog-user-project. Jede andere lässt die Vorabanfrage mit 403 und ganz
   * ohne CORS-Kopfzeilen scheitern; im Browser erscheint dann nur ein
   * nichtssagendes „Failed to fetch", und die eigentliche Anfrage geht nie raus.
   */
  function aiViaGemini(text, key) {
    return fetch(AI_BASE + encodeURIComponent(AI_MODEL) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: text }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: AI_RESPONSE_SCHEMA
        }
      })
    }).then(function (res) {
      if (!res.ok) { throw new AppError('aiHttp'); }
      return res.json();
    }).then(function (data) {
      var candidate = data && data.candidates && data.candidates[0];
      var parts = candidate && candidate.content && candidate.content.parts;
      return parseAiJson(parts && parts[0] && parts[0].text);
    });
  }

  function aiViaProxy(text) {
    return apiPost({ a: 'ai', text: text, lang: lang }).then(function (res) {
      if (res.status !== 200 || !res.body || !Array.isArray(res.body.items)) {
        throw new AppError('aiHttp');
      }
      return normaliseEntries(res.body.items);
    });
  }

  /**
   * Wählt den Weg und fällt bei jedem Fehlschlag auf die lokale Zerlegung
   * zurück – die Spracheingabe soll nie an einer fremden API scheitern.
   */
  function structureText(text) {
    var key = getAiKey();
    var viaAi = null;
    if (key) { viaAi = aiViaGemini(text, key); }
    else if (aiProxyAvailable()) { viaAi = aiViaProxy(text); }
    if (!viaAi) { return Promise.resolve(localStructure(text)); }

    return viaAi.then(function (entries) {
      return entries.length ? entries : localStructure(text);
    }, function () {
      toast(t('voice.errorAi'));
      return localStructure(text);
    });
  }

  /* -- Oberfläche --------------------------------------------------------- */

  /**
   * Prüft nicht nur den Konstruktor, sondern auch, ob er etwas kann.
   * Firefox 142 stellt SpeechRecognition bereits bereit, aber ohne jedes
   * Mitglied: start, lang, continuous und sämtliche Ereignisse kamen erst mit
   * 143. Ein Konstruktor allein ist also kein Versprechen.
   */
  /** Oeffnet oder schliesst die Box mit dem erkannten Text. */
  function setVoiceOpen(open) {
    voiceOpen = !!open;
    $('#voiceBox').hidden = !(state.mode === 'edit' && voiceOpen);
  }

  function speechSupported() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!(Ctor && Ctor.prototype && typeof Ctor.prototype.start === 'function');
  }

  function setVoiceState(message, isError) {
    var node = $('#voiceState');
    if (!node) { return; }
    node.textContent = message || '';
    node.className = 'tag voicestate' + (isError ? ' voicestate-error' : '');
  }

  function updateVoiceHint() {
    var proxyNote = $('#aiProxyNote');
    if (proxyNote) { proxyNote.hidden = !aiProxyAvailable(); }

    var node = $('#voiceHint');
    if (!node) { return; }
    var parts = [];
    if (!speechSupported()) { parts.push(t('voice.hintNoSpeech')); }
    if (getAiKey()) { parts.push(t('voice.hintAi')); }
    else if (aiProxyAvailable()) { parts.push(t('voice.hintProxy')); }
    else { parts.push(t('voice.hintLocal')); }
    node.textContent = parts.join(' ');
  }

  function setListening(active) {
    speechActive = active;
    var btn = $('#btnMic');
    if (!btn) { return; }
    btn.classList.toggle('is-listening', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    $('.micbtn-label', btn).textContent = t(active ? 'voice.stop' : 'voice.start');
    if (active) {
      var node = $('#voiceState');
      node.className = 'tag voicestate';
      node.textContent = '';
      node.appendChild(statusDot('available'));
      node.appendChild(el('span', null, t('voice.listening')));
    } else {
      setVoiceState('', false);
    }
  }

  /** Erzeugt die Erkennung einmalig und hängt die Ereignisse an. */
  function buildRecognition() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { return null; }
    var rec = new Ctor();
    rec.continuous = true;      // mehrere Gegenstände am Stück
    rec.interimResults = true;  // Zwischenstand sichtbar machen
    rec.maxAlternatives = 1;

    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var transcript = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          speechFinal += (speechFinal ? ' ' : '') + transcript.trim();
        } else {
          interim += transcript;
        }
      }
      $('#voiceText').value = (speechFinal + ' ' + interim).trim().slice(0, AI_MAX_CHARS);
    };

    rec.onerror = function (ev) {
      var code = ev && ev.error;
      if (code === 'no-speech') { setVoiceState(t('voice.noSpeechHeard'), true); return; }
      if (code === 'aborted') { return; }  // vom Nutzer beendet
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setVoiceState(t('voice.denied'), true);
      } else {
        setVoiceState(t('voice.errorMic'), true);
      }
    };

    rec.onend = function () {
      setListening(false);
      var text = $('#voiceText').value.trim();
      if (text && text !== speechBefore) { processVoiceText(text); }
    };

    return rec;
  }

  function toggleMic() {
    if (!speechSupported()) { return; }
    if (speechActive) {
      try { speechRec.stop(); } catch (e) { setListening(false); }
      return;
    }
    if (!window.isSecureContext) { setVoiceState(t('voice.insecure'), true); return; }

    if (!speechRec) { speechRec = buildRecognition(); }
    if (!speechRec) { return; }

    setVoiceOpen(true);
    speechRec.lang = (lang === 'de') ? 'de-DE' : 'en-US';
    speechFinal = $('#voiceText').value.trim();
    speechBefore = speechFinal;
    try {
      speechRec.start();
      setListening(true);
    } catch (e) {
      setListening(false);
      setVoiceState(t('voice.errorMic'), true);
    }
  }

  /** Freitext → Einträge → Liste. Gemeinsamer Weg für Sprache und Tastatur. */
  function processVoiceText(text) {
    var input = String(text).trim().slice(0, AI_MAX_CHARS);
    if (!input) { return Promise.resolve(); }
    setVoiceState(t('voice.processing'), false);

    return structureText(input).then(function (entries) {
      if (!entries.length) {
        setVoiceState(t('voice.none'), true);
        return;
      }
      /* Rückwärts einfügen, damit die Reihenfolge des Gesprochenen erhalten bleibt. */
      entries.slice().reverse().forEach(function (entry) {
        state.doc.items.unshift({
          id: randomHex(6),
          name: entry.item,
          note: '',
          status: entry.status === 'lent' ? 'lent' : 'available',
          borrower: '',
          since: entry.status === 'lent' ? new Date().toISOString().slice(0, 10) : ''
        });
      });
      touch();
      render();
      $('#voiceText').value = '';
      speechFinal = '';
      speechBefore = '';
      setVoiceState('', false);
      setVoiceOpen(false);
      toast(entries.length === 1 ? t('voice.added_1') : t('voice.added', { n: entries.length }));
    });
  }

  /* ===================================================================== *
   * 13 · Ereignisse
   * ===================================================================== */

  function bindEvents() {
    $('#btnLang').addEventListener('click', function () {
      setLang(lang === 'de' ? 'en' : 'de');
    });

    $('#btnMic').addEventListener('click', toggleMic);

    /* Der Verweis oeffnet dieselbe Box zum Eintippen, auch ohne Mikrofon. */
    $('#btnBulk').addEventListener('click', function () {
      setVoiceOpen(!voiceOpen);
      if (voiceOpen) { $('#voiceText').focus(); }
    });

    /* Reiter im Abschnitt Link teilen */
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-tab')); });
    });
    $('#btnVoiceApply').addEventListener('click', function () {
      processVoiceText($('#voiceText').value);
    });

    $('#btnCreate').addEventListener('click', createList);
    $('#btnRefresh').addEventListener('click', function () { refresh(true); });

    $('#addForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      addItem($('#addName').value, '');
      $('#addName').value = '';
      $('#addName').focus();
    });

    /* Der Zugang wird weggeräumt, wenn er ausdrücklich gesichert wurde. */
    $('#btnKeyDone').addEventListener('click', function () {
      $('#keyBox').hidden = true;
    });

    $('#modalClose').addEventListener('click', closeItemModal);
    $('#itemModal').addEventListener('close', function () { modalItemId = null; });

    $('#btnShareView').addEventListener('click', function () {
      nativeShare({
        title: state.doc.title || t('list.untitled'),
        text: t('share.message', { title: state.doc.title || t('list.untitled') }),
        url: viewLink()
      });
    });

    $('#listTitleInput').addEventListener('input', function () {
      state.doc.title = this.value;
      touch();
    });

    $('#cfgName').addEventListener('input', function () { state.doc.contact.name = this.value; touch(); });
    $('#cfgEmail').addEventListener('input', function () { state.doc.contact.email = this.value.trim(); touch(); });
    $('#cfgShowBorrower').addEventListener('change', function () { state.doc.showBorrower = this.checked; touch(); });

    /* Delegation für die Inventarliste */
    $('#itemList').addEventListener('click', function (ev) {
      var hit = ev.target.closest('[data-act]');
      if (!hit) { return; }
      var id = hit.closest('.item').getAttribute('data-id');
      if (hit.getAttribute('data-act') === 'ask') { openAskModal(id); return; }
      openItemModal(id);
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
   * 14 · Router und Start
   * ===================================================================== */

  /** Der Verweis auf die Einstellungen traegt die offene Liste mit sich. */
  function updateSettingsLink() {
    var link = $('#lnkSettings');
    if (!link) { return; }
    var hash = (state.mode === 'edit' && state.id && state.token)
      ? editHash(state.id, state.keyStr, state.token)
      : '';
    link.setAttribute('href', 'einstellungen.html' + hash);
  }

  function route() {
    var parsed;
    try { parsed = parseHash(); }
    catch (err) { showError(err.code || 'badlink'); return; }

    if (!parsed) {
      stopRefresh();
      state.mode = 'start';
      renderMine();
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

  /* ===================================================================== *
   * 14a · Einstellungsseite
   *
   * Die Einstellungen stehen auf einer eigenen Seite. Sie teilt sich mit der
   * Anwendung diese Datei, weil sie dieselbe Sprache, dasselbe Erscheinungs-
   * bild und denselben Speicher braucht — aber sie zeichnet keine Liste und
   * ruft deshalb nichts aus dem Abschnitt Rendering auf.
   * ===================================================================== */

  function isSettingsPage() {
    return document.body.getAttribute('data-page') === 'settings';
  }

  function initSettings() {
    lang = detectLang();
    document.documentElement.lang = lang;
    applyStaticI18n();

    $('#btnLang').addEventListener('click', function () {
      setLang(lang === 'de' ? 'en' : 'de');
    });

    $('#cfgAiKey').value = getAiKey();
    $('#cfgAiKey').addEventListener('change', function () {
      var value = this.value.trim();
      setAiKey(value);
      updateVoiceHint();
      toast(t(value ? 'settings.aiKeySaved' : 'settings.aiKeyCleared'));
    });
    $('#btnClearCache').addEventListener('click', clearLocalData);

    /* Wurde die Seite aus einer offenen Liste heraus aufgerufen, trägt das
       Fragment deren Bearbeiten-Link. Nur dann führt der Weg zurück, und nur
       dann gibt es hier etwas zu löschen. */
    var parsed = null;
    try { parsed = parseHash(); } catch (err) { parsed = null; }
    var back = (parsed && parsed.mode === 'edit')
      ? './' + editHash(parsed.id, parsed.key, parsed.token)
      : './';
    $('#lnkBack').setAttribute('href', back);
    if (!parsed || parsed.mode !== 'edit') {
      /* Das Merkmal wird getauscht, nicht der Text: sonst überschreibt der
         nächste Sprachwechsel die Beschriftung wieder. */
      $('#lnkBack').setAttribute('data-i18n', 'settings.backStart');
      $('#lnkBack').textContent = t('settings.backStart');
    }

    var mineLink = $('#lnkMine');
    if (mineLink) { mineLink.hidden = readMine().length === 0; }

    detectStore().then(function (store) {
      Store = store;
      applyStaticI18n();
      updateVoiceHint();
      if (!parsed || parsed.mode !== 'edit') { return; }

      state.mode = 'edit';
      state.id = parsed.id;
      state.keyStr = parsed.key;
      state.token = parsed.token;
      return Crypt.proof(parsed.token).then(function (proof) {
        state.proof = proof;
        $('#dangerBox').hidden = false;
        $('#btnDeleteList').addEventListener('click', deleteList);
      });
    });
  }

  function init() {
    if (isSettingsPage()) { initSettings(); return; }

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
