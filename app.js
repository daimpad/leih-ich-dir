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
  var MAX_FRIENDS    = 24;     // Listen je Superliste; Begruendung bei ladeKreis()
  var LEBENSZEICHEN_TAGE = 30; // Tage ohne Schreibvorgang, dann eines; Begruendung bei lebenszeichen()
  var KREIS_PAR      = 4;      // gleichzeitige Abrufe beim Oeffnen eines Kreises
  var KREIS_LANGSAM  = 6000;   // ms, ab denen eine Zeile als "dauert" gilt

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

  /* Die beiden Formen, die ein Fragment tragen darf. Sie stehen hier einmal,
     weil parseFragment, normalizeCircle und das Aufnehmen eines Freundes
     dieselbe Regel brauchen; zwei Fassungen laufen frueher oder spaeter
     auseinander. Die ID spiegelt die Pruefung in api.php, der Schluessel
     entsteht aus exportKey ueber b64u.encode: 32 Byte roh, ohne
     Auffuellzeichen also genau 43 Zeichen. */
  var ID_RE  = /^[0-9a-f]{32}$/;
  var KEY_RE = /^[A-Za-z0-9_-]{43}$/;

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
      /* b64u.decode ruft atob, und atob wirft synchron — im Argumentausdruck,
         also bevor es ein Promise gibt. Ohne diesen Block verliesse die
         Ausnahme importKey als geworfener Fehler statt als abgelehntes
         Promise, und der Aufrufer haengt sein catch an nichts. Heute ist das
         eine weisse Seite: openList() (Abschnitt 10) hat importKey als
         allerersten Ausdruck, die Ausnahme verlaesst die Funktion vor dem
         .catch, und in index.html beginnen alle Ansichten mit hidden. Im
         Superliste genuegte ein einziger beschaedigter Schluessel, um die
         ganze Uebersicht wortlos abzuraeumen. */
      var bytes;
      try { bytes = b64u.decode(str); }
      catch (e) { return Promise.reject(new AppError('badlink')); }
      return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
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

    /* Dieselbe Bauart wie importKey: b64u.decode steht auch hier im
       Argumentausdruck. Unauffaellig ist das nur, weil beide Aufrufstellen
       innerhalb eines .then-Rueckrufs liegen und die Kette den Wurf faengt.
       Gerettet wird decrypt also von seiner Aufrufstelle, nicht von sich
       selbst — wer es kuenftig ausserhalb einer Kette ruft, muss das wissen. */
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
      'hero.lead': 'Zeig Deinen Freund:innen, was sie bei Dir ausleihen können!',

      'trust.label': 'Eigenschaften',
      'trust.tracking': 'Kostenlos',
      'trust.account': 'Werbefrei',
      'trust.ads': 'Ohne Login',
      'trust.crypto': 'Verschlüsselt',

      'steps.headline': 'So geht\u2019s: eine eigene Leihliste einstellen',
      'steps.lead': 'Eine Liste der Dinge, die Du verleihst. Sie liegt verschlüsselt auf dem Server, und sehen kann sie, wer den Link von Dir bekommt.',
      'steps.one': 'Gegenstände eintragen',
      'steps.oneText': 'Tippen oder einsprechen. Erst nur der Name, alles Weitere steht hinter dem Eintrag.',
      'steps.two': 'Kontaktdetails angeben',
      'steps.twoText': 'Name und E-Mail, damit Deine Freunde Dich erreichen. Beides wird mitverschlüsselt.',
      'steps.three': 'Link weitergeben',
      'steps.threeText': 'Freunde sehen, was gerade frei ist, und fragen mit einem Klick an.',

      'start.create': 'Leihliste anlegen',
      'start.creating': 'Leihliste wird angelegt …',

      'circleSteps.headline': 'So geht\u2019s: aus vielen Leihlisten eine Superliste',
      'circleSteps.lead': 'Du hast schon ein paar Leihlisten von Freunden zusammengetragen und möchtest sie zusammen durchsuchen. Genau dafür ist eine Superliste da: eine Liste der Leihlisten. Sie führt alle zusammen, die Dir geteilt wurden, und macht sie nach Gegenstand und Verfügbarkeit durchsuchbar.',
      'circleSteps.one': 'Ansehen-Links sammeln',
      'circleSteps.oneText': 'Deine Freunde schicken Dir die Links zu ihren Leihlisten, so wie Du ihnen Deinen schickst.',
      'circleSteps.two': 'In die Superliste legen',
      'circleSteps.twoText': 'Den Link einfügen und einen Namen dazu vergeben. Gespeichert werden Kennung und Schlüssel, keine Gegenstände.',
      'circleSteps.three': 'An einer Stelle suchen',
      'circleSteps.threeText': 'Alle Sachen aus allen gesammelten Leihlisten in einer Liste, durchsuchbar nach Gegenstand, Person und Notiz, mit frei oder verliehen daneben.',

      'list.titleLabel': 'Titel der Liste, freiwillig',
      'list.titlePlaceholder': 'Titel der Liste',
      'list.untitled': 'Leih-Katalog',
      'list.by': 'Liste von {name}',
      'list.free': '{n} gerade frei',
      'list.free_1': '1 gerade frei',
      'list.newTitle': 'Meine Leihliste',

      'mine.headline': 'Auf diesem Gerät gemerkt',
      'mine.hint': 'Deine Leihlisten und Superlisten. Die Links dazu kennt nur dieser Browser.',

      'nav.mine': 'Meine Listen',
      'nav.list': 'Leihliste',
      'nav.circle': 'Superliste',

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

      'backup.headline': 'Sichern',
      'backup.hint': 'Legt Deine Liste als Datei auf diesem Gerät ab: Gegenstände, Kontakt und Stand, im Klartext. Der Link ist nicht darin. Aus der Datei lässt sich auf der Startseite eine neue Liste anlegen, mit neuen Links, falls diese hier einmal verloren geht. Bewahre sie dort auf, wo Du auch Deinen Bearbeiten-Link aufbewahrst.',
      'backup.download': 'Als Datei sichern',
      'backup.restore': 'Aus einer Sicherung wiederherstellen',
      'backup.restoring': 'Liste wird wiederhergestellt …',
      'backup.badFile': 'Das ist keine Sicherung einer Leihliste.',
      'backup.restored': 'Wiederhergestellt als neue Liste, mit neuen Links.',
      'share.hint': 'Der Schlüssel steht hinter dem Rautezeichen und wird technisch nie an den Server übertragen.',

      'add.nameLabel': 'Gegenstand',
      'add.namePlaceholder': 'z. B. {name}',
      'add.emptyWarn': 'Gib dem Gegenstand zuerst einen Namen.',
      'form.required': 'Pflichtfeld',
      'add.notePlaceholder': 'Notiz, optional',
      'add.submit': 'Hinzufügen',

      'items.headline': 'Inventar',
      'items.refresh': 'Aktualisieren',
      'items.empty': 'Was liegt bei Dir herum und wird kaum benutzt?',
      'items.emptyView': 'In dieser Liste steht im Moment nichts.',
      'items.checked': 'zuletzt geprüft vor {n} Min.',
      'items.checkedNow': 'gerade geprüft',

      'item.available': 'Verfügbar',
      'item.lent': 'Verliehen',
      'item.delete': 'Löschen',
      'item.ask': 'Anfragen',
      'item.more': 'Details ergänzen',
      'item.deleted': '„{name}“ entfernt.',
      'item.undo': 'Rückgängig',
      'item.borrower': 'Verliehen an, freiwillig',
      'item.borrowerPlaceholder': 'Name, optional',
      'item.since': 'Seit wann, freiwillig',
      'item.lentTo': 'Verliehen an {name} seit {date}',
      'item.lentSince': 'Verliehen seit {date}',
      'item.lentToPlain': 'Verliehen an {name}',

      'modal.name': 'Gegenstand',
      'modal.note': 'Notiz, freiwillig',
      'modal.status': 'Verfügbarkeit',
      'modal.done': 'Fertig',
      'modal.close': 'Schließen',

      'request.headline': '{item} anfragen',
      'request.mail': 'Per E-Mail anfragen',
      'request.share': 'Anfrage teilen',
      'request.call': 'Anrufen',
      'request.copy': 'Anfragetext kopieren',
      'request.copied': 'Anfragetext kopiert.',
      'request.shared': 'Anfrage weitergegeben.',
      'request.subject': 'Leihanfrage: {item}',
      'request.body': 'Hallo, ich möchte {item} ausleihen. Passt das bei Dir?',
      'request.bodyNamed': 'Hallo {name}, ich möchte {item} ausleihen. Passt das bei Dir?',

      'settings.headline': 'Einstellungen',
      'settings.pageHint': 'Diese Angaben gelten für diesen Browser, nicht für Deine Listen.',
      'settings.back': 'Zurück zur Liste',
      'settings.backStart': 'Zurück zur Startseite',
      'contact.headline': 'Kontakt',
      'contact.sub': 'Name, E-Mail und Telefon für Anfragen',
      'contact.name': 'Dein Name, freiwillig',
      'contact.namePlaceholder': '',
      'contact.nameHint': 'Steht über der Liste und in der Anrede, wenn jemand anfragt.',
      'contact.phone': 'Telefon, freiwillig',
      'contact.phonePlaceholder': '+49 …',
      'contact.phoneHint': 'Erscheint als Anrufen-Schaltfläche, wenn jemand einen Gegenstand anfragt. Wer lieber schreibt, lässt das Feld leer.',
      'contact.hint': 'Diese Angaben werden mitverschlüsselt und nur für die Anfrage-Schaltflächen Deiner Freunde genutzt.',
      'settings.themeHeadline': 'Erscheinungsbild',
      'settings.themeSystem': 'Wie das System',
      'settings.themeLight': 'Hell',
      'settings.themeDark': 'Dunkel',
      'settings.cacheHeadline': 'Zwischenspeicher',
      'settings.cacheHint': 'Entfernt alles, was diese Anwendung in diesem Browser ablegt: Sprache, Erscheinungsbild, KI-Schlüssel, Töne, die Ruhigstellung, die gemerkten Leihlisten und Superlisten, Deine Runden und Abzeichen und im Vorschaumodus die lokal gehaltenen Leihlisten und Superlisten. Deine Liste auf dem Server und Deine Links bleiben unberührt.',
      'settings.cacheClear': 'Zwischenspeicher löschen',
      'settings.cacheConfirm': 'Alles löschen, was diese Anwendung in diesem Browser ablegt? Die Liste auf dem Server bleibt bestehen.',
      'settings.cacheDone': 'Zwischenspeicher geleert.',
      'settings.dangerHeadline': 'Liste löschen',
      'settings.dangerHint': 'Die Liste wird unwiderruflich vom Server entfernt. Beide Links laufen danach ins Leere.',
      'settings.email': 'E-Mail für Anfragen, freiwillig',
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
      'voice.hintAi': 'Gemini strukturiert den Text. Er wird dazu an Google übertragen.',
      'voice.hintProxy': 'Die Strukturierung übernimmt der Server dieser Anwendung.',
      'voice.added': '{n} Gegenstände übernommen.',
      'voice.added_1': 'Ein Gegenstand übernommen.',
      'voice.emptyWarn': 'Schreib oder sprich zuerst etwas.',
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
      'error.kindmix': 'Dieser Link gehört zu einer anderen Art von Liste.',

      /* -- Superliste ------------------------------------------------- */

      'circle.badge': 'Superliste',
      'list.badge': 'Leihliste',
      'title.edit': 'Deine Leihliste · LeihIchDir',
      'title.view': 'Eine Leihliste · LeihIchDir',
      'circle.untitled': 'Superliste',
      'circle.newTitle': 'Meine Superliste',
      'circle.unnamed': 'Ohne Namen',
      'circle.titleLabel': 'Name der Superliste, freiwillig',
      'circle.titlePlaceholder': 'Superliste',
      'circle.honest': 'Die Personen, deren Leihlisten hier stehen, erfahren davon nichts. Eine Benachrichtigung setzte voraus, dass festgehalten wird, wer welche Liste liest. Diese Superliste hält das nicht fest.',
      'circle.previewNote': 'Im Vorschaumodus liegen Listen nur in diesem Browser. Die Superliste findet deshalb nur Leihlisten, die Du hier selbst angelegt hast; die Listen Deiner Freunde liegen in deren Browsern.',
      'circle.itemsHeadline': 'Was es gibt',
      'circle.meta': '{n} Leihlisten gesammelt',
      'circle.meta_1': '1 Leihliste gesammelt',
      'circle.searchLabel': 'Unter allen Sachen suchen',
      'circle.searchPlaceholder': 'Suchen',
      'circle.total': '{n} Sachen',
      'circle.total_1': '1 Sache',
      'circle.hits': '{n} von {g}',
      'circle.hits_1': '1 von {g}',
      'circle.none': 'Nichts gefunden',
      'circle.missing': '{n} Leihlisten konnten nicht geladen werden',
      'circle.missing_1': '1 Leihliste konnte nicht geladen werden',
      'circle.beyond': '{n} weitere Leihlisten sind nicht dabei',
      'circle.beyond_1': '1 weitere Leihliste ist nicht dabei',
      'circle.noHit': 'Nichts gefunden.',
      'circle.reset': 'Suche zurücksetzen',
      'circle.emptyNoneHead': 'Ergänze hier die Leihlisten Deiner Freunde',
      'circle.emptyNoneText': 'Füge den Ansehen-Link einer Leihliste ein. Die Superliste holt sie bei jedem Öffnen frisch und zeigt alles daraus in einer Liste.',
      'circle.emptyAllHead': 'Nichts eingetragen',
      'circle.emptyAllText': 'Die gesammelten Leihlisten sind erreichbar, aber noch leer.',
      'circle.manageHeadline': 'Leihliste eines Freundes hinzufügen',
      'circle.addLabel': 'Ansehen-Link der Leihliste',
      'circle.addPlaceholder': 'Link einfügen',
      'circle.add': 'Aufnehmen',
      'circle.addName': 'Name der Person, freiwillig',
      'circle.addHere': 'Zur Superliste hinzufügen',
      'circle.startNew': 'Superliste anlegen',
      'circle.added': 'Aufgenommen in {kreis}.',
      'circle.selfAdd': 'Das ist diese Superliste selbst.',
      'circle.nestAdd': 'Eine Superliste lässt sich nicht in eine andere aufnehmen.',
      'circle.dupAdd': 'Diese Leihliste steht schon in der Superliste.',
      'circle.full': 'Mehr als {n} Leihlisten fasst eine Superliste nicht.',
      'circle.remove': 'Aus der Superliste nehmen',
      'circle.removed': 'Aus der Superliste genommen.',
      'circle.undo': 'Rückgängig',
      'circle.retry': 'Erneut versuchen',
      'circle.fPending': 'wird geholt',
      'circle.fOverflow': 'über der Grenze von {n}, wird nicht geholt',
      'circle.fSlow': 'dauert gerade',
      'circle.fPreview': 'liegt im Browser dieser Person, hier nicht abrufbar',
      'circle.fCount': '{n} Sachen',
      'circle.fCount_1': '1 Sache',
      'circle.keyHeadline': 'Bewahre diesen Link auf',
      'circle.keyLabel': 'Zugangs-Link der Superliste',
      'circle.keyRemember': 'Auf diesem Gerät gemerkt, beim nächsten Besuch findest Du die Superliste auf der Startseite wieder.',
      'circle.shareHeadline': 'Superliste weitergeben',
      'circle.shareWarn': 'Wer diesen Link bekommt, sieht alle Leihlisten Deiner Superliste. Einen Link nur zum Ansehen gibt es hier nicht.',
      'circle.shareLabel': 'Link zur Superliste',
      'circle.copied': 'Gut verwahrt.',
      'circle.deleteConfirm': 'Die gesamte Superliste wird unwiderruflich vom Server gelöscht. Die Leihlisten Deiner Freunde bleiben unberührt. Fortfahren?',
      'circle.dangerHeadline': 'Superliste löschen',
      'circle.dangerHint': 'Die Superliste wird unwiderruflich vom Server entfernt. Ihr Link läuft danach ins Leere. Die Leihlisten Deiner Freunde bleiben unberührt.',
      'circle.delete': 'Superliste endgültig löschen',


      /* -- Das Spielerische ------------------------------------------- */

      'items.updatedLabel': 'Zuletzt gespeichert: {date}',
      'items.emptyHead': 'Noch nichts drin',
      'items.emptyEg': 'z. B.',
      'item.longOut': '{name} ist seit {n} Tagen unterwegs. Ein kurzer Anruf wäre kein Drama.',

      'spiel.badge': 'Abzeichen · {name}',
      'spiel.level': 'Stufe {n}: {name}!',
      'spiel.levelText': '{n} Sachen sind gekommen und wieder gegangen.',

      'key.klappe': 'Abzeichen · Schlüsselmeister',
      'key.feier': 'Der Link liegt sicher. Trag ein, was Du verleihst.',

      'add.k1': 'Der Erste',
      'add.k2': 'Zwei. Das wird eine Liste',
      'add.k3': 'Und noch einer',
      'add.k25': 'Fünfundzwanzig',
      'add.s1': '{name} ist jetzt aktenkundig.',
      'add.s2': '{name} liegt bereit.',
      'add.s3': '{name} gehört ab jetzt zum Angebot.',
      'add.s4': '{name} ist eingezogen.',
      'add.s5': 'Notiert: {name}.',
      'add.s6': '{name} steht im Regal.',
      'add.s25': 'Fünfundzwanzig Sachen. Dein Regal ächzt.',

      'sonder.bohr': 'Eine Bohrmaschine. Das halbe Haus wird sich freuen.',
      'sonder.waffel': 'Ein Waffeleisen. Ab jetzt bist Du sonntags gefragt.',
      'sonder.zelt': 'Ein Zelt. Damit verleihst Du ein Wochenende.',
      'sonder.leiter': 'Eine Leiter. Merk Dir gut, wer sie holt.',
      'sonder.brett': 'Ein Brettspiel. Bitte mit allen Teilen zurück.',
      'sonder.beamer': 'Ein Beamer. Damit verleihst Du Kinoabende.',
      'sonder.rasen': 'Ein Rasenmäher. Der lauteste Gegenstand in Deiner Liste.',

      'raus.k1': 'Abzeichen · Aus dem Haus',
      'raus.k2': 'Unterwegs',
      'raus.s1': '{name} ist unterwegs. Gute Reise.',
      'raus.s2': '{name} macht Ausgang.',
      'raus.s3': 'Weg ist {name}. Wiederkommen ist eingeplant.',
      'raus.s4': '{name} arbeitet jetzt woanders.',

      'heim.k': 'Wieder da!',
      'heim.sWer': '{who} bringt {name} zurück. {n} Tage unterwegs.',
      'heim.sHeute': '{who} bringt {name} zurück, noch am selben Tag.',
      'heim.sTage': '{name} ist wieder da. {n} Tage unterwegs.',
      'heim.sPlain': '{name} ist wieder da.',
      'heim.sKurz': 'Wieder da. {name} hat es überstanden.',

      'weiter.k2': 'Weitergesagt',
      'weiter.s2': 'Link kopiert. Jetzt wissen andere, was bei Dir steht.',
      'weiter.s3': 'Link kopiert. Jetzt kann jemand fragen.',
      'share.copiedEdit': 'Gut verwahrt.',

      'stufe.1': 'Erste Runde',
      'stufe.2': 'Kurzer Draht',
      'stufe.3': 'Dachboden mit Auftrag',
      'stufe.4': 'Ehrenamt für alles',
      'stufe.5': 'Kreisverleihamt',
      'stufe.6': 'Wandelnde Leihstation',

      'abz.schluessel': 'Schlüsselmeister',
      'abz.schluessel.text': 'Der Link liegt sicher. Den Rest kannst Du Dir aussuchen.',
      'abz.erster': 'Der Erste',
      'abz.erster.text': 'Einer ist immer der erste. Beim zweiten geht es schneller.',
      'abz.sortiment': 'Kleines Sortiment',
      'abz.sortiment.text': 'Zehn Sachen. Da findet jeder etwas.',
      'abz.aushaus': 'Aus dem Haus',
      'abz.aushaus.text': 'Zum ersten Mal ist etwas unterwegs. Es kommt wieder, fast immer.',
      'abz.heimkehr': 'Heimkehr',
      'abz.heimkehr.text': 'Einmal raus, einmal zurück. Genau darum geht es hier.',
      'abz.bumerang': 'Bumerang',
      'abz.bumerang.text': 'Zehnmal raus, zehnmal zurück. Deine Sachen haben Heimweh.',
      'abz.tagesflug': 'Tagesausflug',
      'abz.tagesflug.text': 'Raus und rein am selben Tag. Das nennt man Vertrauen.',
      'abz.langeratem': 'Langer Atem',
      'abz.langeratem.text': 'Vier Wochen unterwegs, und es kam zurück. Frag nicht, wo es war.',
      'abz.allesda': 'Alles wieder da',
      'abz.allesda.text': 'Nichts unterwegs, alles wieder im Regal. Ein guter Stand.',
      'abz.kleinfein': 'Klein und fein',
      'abz.kleinfein.text': 'Drei Sachen, die wirklich rausgehen. Mehr braucht es nicht.',
      'abz.tueroeffner': 'Türöffner',
      'abz.tueroeffner.text': 'Der Link ist raus. Wer draufschaut, bleibt Dein Geheimnis, auch vor uns.',

      'buch.title': 'Rundenbuch',
      'buch.open': 'Rundenbuch öffnen, Stufe {name}',
      'buch.none': 'Noch keine Runde',
      'buch.dinge': 'eingetragen',
      'buch.unterwegs': 'unterwegs',
      'buch.runden': 'Runden',
      'buch.weiter': 'weitergegeben',
      'buch.rest': 'Es gibt noch {n} weitere Abzeichen. Die kommen von selbst.',
      'buch.first': 'Noch keine Abzeichen. Das erste kommt mit dem ersten Gegenstand.',
      'buch.local': 'Diese Zahlen stehen nur in diesem Browser. Sie gehen nie an den Server und nie in Deine Liste. Auf einem anderen Gerät fängst Du bei null an.',

      'settings.soundHeadline': 'Töne',
      'settings.soundLabel': 'Kleine Töne beim Verleihen und Zurückbekommen',
      'settings.soundHint': 'Standardmäßig aus. Vier kurze Töne, sonst nichts. Beim Einschalten hörst Du gleich einen davon. Der Schalter gilt nur für diesen Browser.',
      'settings.soundOn': 'Töne sind an.',
      'settings.motionHeadline': 'Bewegung',
      'settings.motionLabel': 'Bewegte Anteile ruhigstellen',
      'settings.motionHint': 'Konfetti, aufpoppende Gesichter und das Aufklappen entfallen dann; alles erscheint sofort. Der Schalter gilt nur für diesen Browser.',
      'settings.motionSystem': 'Dein System verlangt bereits wenig Bewegung. Die Anwendung folgt dem, unabhängig von diesem Schalter.',

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
      'hero.lead': 'Show your friends what they can borrow from you!',

      'trust.label': 'Properties',
      'trust.tracking': 'Free',
      'trust.account': 'No ads',
      'trust.ads': 'No login',
      'trust.crypto': 'Encrypted',

      'steps.headline': 'How it works: set up your own lending list',
      'steps.lead': 'A list of the things you lend out. It lives encrypted on the server, and whoever gets the link from you can see it.',
      'steps.one': 'Add your things',
      'steps.oneText': 'Type or speak. Just the name at first, everything else sits behind the entry.',
      'steps.two': 'Add your contact details',
      'steps.twoText': 'Name and e-mail, so your friends can reach you. Both are encrypted with the list.',
      'steps.three': 'Pass the link on',
      'steps.threeText': 'Friends see what is free right now and ask with one click.',

      'start.create': 'Create a lending list',
      'start.creating': 'Creating lending list …',

      'circleSteps.headline': 'How it works: many lending lists, one super list',
      'circleSteps.lead': 'You have collected a few lending lists from friends and would like to search them together. That is what a super list is for: a list of lending lists. It brings together everything shared with you and makes it searchable by thing and availability.',
      'circleSteps.one': 'Collect view links',
      'circleSteps.oneText': 'Your friends send you the links to their lending lists, just as you send them yours.',
      'circleSteps.two': 'Put them in the super list',
      'circleSteps.twoText': 'Paste the link and give it a name. The id and the key are stored, no things.',
      'circleSteps.three': 'Search in one place',
      'circleSteps.threeText': 'Everything from all collected lending lists in one list, searchable by thing, person and note, with free or lent beside it.',

      'list.titleLabel': 'List title, optional',
      'list.titlePlaceholder': 'List title',
      'list.untitled': 'Lending catalogue',
      'list.by': 'List by {name}',
      'list.free': '{n} free right now',
      'list.free_1': '1 free right now',
      'list.newTitle': 'My lending list',

      'mine.headline': 'Remembered on this device',
      'mine.hint': 'Your lending lists and super lists. Only this browser knows the links.',

      'nav.mine': 'My lists',
      'nav.list': 'Lending list',
      'nav.circle': 'Super list',

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

      'backup.headline': 'Back up',
      'backup.hint': 'Saves your list as a file on this device: things, contact and status, in plain text. The link is not in it. From the file you can create a new list on the start page, with new links, should this one ever be lost. Keep it where you keep your edit link.',
      'backup.download': 'Save as file',
      'backup.restore': 'Restore from a backup',
      'backup.restoring': 'Restoring list …',
      'backup.badFile': 'That is not a backup of a lending list.',
      'backup.restored': 'Restored as a new list, with new links.',
      'share.hint': 'The key lives behind the # sign and is technically never sent to the server.',

      'add.nameLabel': 'Item',
      'add.namePlaceholder': 'e.g. {name}',
      'add.emptyWarn': 'Give the item a name first.',
      'form.required': 'Required field',
      'add.notePlaceholder': 'Note, optional',
      'add.submit': 'Add',

      'items.headline': 'Inventory',
      'items.refresh': 'Refresh',
      'items.empty': 'What is lying around at your place, barely ever used?',
      'items.emptyView': 'There is nothing in this list at the moment.',
      'items.checked': 'checked {n} min ago',
      'items.checkedNow': 'just checked',

      'item.available': 'Available',
      'item.lent': 'Lent out',
      'item.delete': 'Delete',
      'item.ask': 'Ask',
      'item.more': 'Add details',
      'item.deleted': '“{name}” removed.',
      'item.undo': 'Undo',
      'item.borrower': 'Lent to, optional',
      'item.borrowerPlaceholder': 'Name, optional',
      'item.since': 'Since when, optional',
      'item.lentTo': 'Lent to {name} since {date}',
      'item.lentSince': 'Lent out since {date}',
      'item.lentToPlain': 'Lent to {name}',

      'modal.name': 'Item',
      'modal.note': 'Note, optional',
      'modal.status': 'Availability',
      'modal.done': 'Done',
      'modal.close': 'Close',

      'request.headline': 'Ask for {item}',
      'request.mail': 'Ask by e-mail',
      'request.share': 'Share request',
      'request.call': 'Call',
      'request.copy': 'Copy request text',
      'request.copied': 'Request text copied.',
      'request.shared': 'Request passed on.',
      'request.subject': 'Borrowing request: {item}',
      'request.body': 'Hi, I would like to borrow {item}. Does that work for you?',
      'request.bodyNamed': 'Hi {name}, I would like to borrow {item}. Does that work for you?',

      'settings.headline': 'Settings',
      'settings.pageHint': 'These apply to this browser, not to your lists.',
      'settings.back': 'Back to the list',
      'settings.backStart': 'Back to the start page',
      'contact.headline': 'Contact',
      'contact.sub': 'Name, e-mail and phone for requests',
      'contact.name': 'Your name, optional',
      'contact.namePlaceholder': '',
      'contact.nameHint': 'Shown above the list and in the greeting when somebody asks.',
      'contact.phone': 'Phone, optional',
      'contact.phonePlaceholder': '+49 …',
      'contact.phoneHint': 'Appears as a call button when somebody asks about an item. Leave it empty if you would rather be written to.',
      'contact.hint': 'These details are encrypted along with the list and only feed the request buttons your friends see.',
      'settings.themeHeadline': 'Appearance',
      'settings.themeSystem': 'Follow the system',
      'settings.themeLight': 'Light',
      'settings.themeDark': 'Dark',
      'settings.cacheHeadline': 'Local data',
      'settings.cacheClear': 'Clear local data',
      'settings.cacheHint': 'Removes everything this application stores in this browser: language, appearance, AI key, sounds, the motion setting, the remembered lending lists and super lists, your rounds and badges, and in preview mode the locally held lending lists and super lists. Your list on the server and your links stay untouched.',
      'settings.cacheConfirm': 'Remove everything this application stores in this browser? The list on the server stays.',
      'settings.cacheDone': 'Local data cleared.',
      'settings.dangerHeadline': 'Delete list',
      'settings.dangerHint': 'The list is irreversibly removed from the server. Both links then lead nowhere.',
      'settings.email': 'E-mail for requests, optional',
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
      'voice.hintAi': 'Gemini structures the text. It is sent to Google for that.',
      'voice.hintProxy': 'This application\u2019s server handles the structuring.',
      'voice.added': '{n} items added.',
      'voice.added_1': 'One item added.',
      'voice.emptyWarn': 'Type or say something first.',
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
      'error.kindmix': 'This link belongs to a different kind of list.',

      /* -- Super list ------------------------------------------------- */

      'circle.badge': 'Super list',
      'list.badge': 'Lending list',
      'title.edit': 'Your lending list · LeihIchDir',
      'title.view': 'A lending list · LeihIchDir',
      'circle.untitled': 'Super list',
      'circle.newTitle': 'My super list',
      'circle.unnamed': 'No name',
      'circle.titleLabel': 'Name of the super list, optional',
      'circle.titlePlaceholder': 'Super list',
      'circle.honest': 'The people whose lending lists are kept here are not told about it. A notice would require a record of who reads which list. This super list keeps no such record.',
      'circle.previewNote': 'In preview mode lists live in this browser only. The super list therefore finds just the lending lists you created here; your friends\u2019 lists live in their own browsers.',
      'circle.itemsHeadline': 'What there is',
      'circle.meta': '{n} lending lists collected',
      'circle.meta_1': '1 lending list collected',
      'circle.searchLabel': 'Search across all things',
      'circle.searchPlaceholder': 'Search',
      'circle.total': '{n} things',
      'circle.total_1': '1 thing',
      'circle.hits': '{n} of {g}',
      'circle.hits_1': '1 of {g}',
      'circle.none': 'Nothing found',
      'circle.missing': '{n} lending lists could not be loaded',
      'circle.missing_1': '1 lending list could not be loaded',
      'circle.beyond': '{n} further lending lists are not included',
      'circle.beyond_1': '1 further lending list is not included',
      'circle.noHit': 'Nothing found.',
      'circle.reset': 'Clear the search',
      'circle.emptyNoneHead': 'Add your friends\u2019 lending lists here',
      'circle.emptyNoneText': 'Paste the view link of a lending list. The super list fetches it fresh every time you open it and shows everything from it in one list.',
      'circle.emptyAllHead': 'Nothing listed',
      'circle.emptyAllText': 'The collected lending lists can be reached, but they are still empty.',
      'circle.manageHeadline': 'Add a friend\u2019s lending list',
      'circle.addLabel': 'View link of the lending list',
      'circle.addPlaceholder': 'Paste link',
      'circle.add': 'Add',
      'circle.addName': 'Name of the person, optional',
      'circle.addHere': 'Add to my super list',
      'circle.startNew': 'Create a super list',
      'circle.added': 'Added to {kreis}.',
      'circle.selfAdd': 'That is this super list itself.',
      'circle.nestAdd': 'A super list cannot be added to another one.',
      'circle.dupAdd': 'This lending list is already in the super list.',
      'circle.full': 'A super list holds no more than {n} lending lists.',
      'circle.remove': 'Remove from the super list',
      'circle.removed': 'Removed from the super list.',
      'circle.undo': 'Undo',
      'circle.retry': 'Try again',
      'circle.fPending': 'loading',
      'circle.fOverflow': 'beyond the limit of {n}, not loaded',
      'circle.fSlow': 'taking a while',
      'circle.fPreview': 'lives in that persons browser, not reachable here',
      'circle.fCount': '{n} things',
      'circle.fCount_1': '1 thing',
      'circle.keyHeadline': 'Keep this link safe',
      'circle.keyLabel': 'Access link of the super list',
      'circle.keyRemember': 'Remembered on this device, you will find the super list on the start page next time.',
      'circle.shareHeadline': 'Pass on the super list',
      'circle.shareWarn': 'Anyone who gets this link sees every lending list in your super list. There is no view-only link for it.',
      'circle.shareLabel': 'Link to the super list',
      'circle.copied': 'Kept safe.',
      'circle.deleteConfirm': 'The entire super list will be irreversibly deleted from the server. Your friends\u2019 lending lists stay untouched. Continue?',
      'circle.dangerHeadline': 'Delete the super list',
      'circle.dangerHint': 'The super list will be irreversibly removed from the server. Its link then leads nowhere. Your friends\u2019 lending lists stay untouched.',
      'circle.delete': 'Delete the super list for good',


      /* -- The playful part ------------------------------------------- */

      'items.updatedLabel': 'Last saved: {date}',
      'items.emptyHead': 'Nothing here yet',
      'items.emptyEg': 'e.g.',
      'item.longOut': '{name} has been out for {n} days. A short call would not be a drama.',

      'spiel.badge': 'Badge · {name}',
      'spiel.level': 'Level {n}: {name}!',
      'spiel.levelText': '{n} things went out and came back.',

      'key.klappe': 'Badge · Keeper of the key',
      'key.feier': 'The link is safe. Now add what you lend out.',

      'add.k1': 'The first one',
      'add.k2': 'Two. This is becoming a list',
      'add.k3': 'And another',
      'add.k25': 'Twenty-five',
      'add.s1': '{name} is on the record now.',
      'add.s2': '{name} is ready to go.',
      'add.s3': '{name} is part of the offer from now on.',
      'add.s4': '{name} has moved in.',
      'add.s5': 'Noted: {name}.',
      'add.s6': '{name} is on the shelf.',
      'add.s25': 'Twenty-five things. Your shelf is creaking.',

      'sonder.bohr': 'A drill. Half the neighbourhood will be pleased.',
      'sonder.waffel': 'A waffle iron. Expect visitors on Sundays.',
      'sonder.zelt': 'A tent. You are lending out a weekend.',
      'sonder.leiter': 'A ladder. Remember well who picks it up.',
      'sonder.brett': 'A board game. Please return it with all the pieces.',
      'sonder.beamer': 'A projector. You are lending out film nights.',
      'sonder.rasen': 'A lawn mower. The loudest item on your list.',

      'raus.k1': 'Badge · Out of the house',
      'raus.k2': 'On the road',
      'raus.s1': '{name} is on its way. Safe travels.',
      'raus.s2': '{name} is out for the day.',
      'raus.s3': '{name} is gone. Coming back is part of the plan.',
      'raus.s4': '{name} is working somewhere else now.',

      'heim.k': 'Back again!',
      'heim.sWer': '{who} brings {name} back. Out for {n} days.',
      'heim.sHeute': '{who} brings {name} back, on the very same day.',
      'heim.sTage': '{name} is back. Out for {n} days.',
      'heim.sPlain': '{name} is back.',
      'heim.sKurz': 'Back again. {name} survived it.',

      'weiter.k2': 'Passed on',
      'weiter.s2': 'Link copied. Now others know what you have.',
      'weiter.s3': 'Link copied. Now someone can ask.',
      'share.copiedEdit': 'Kept safe.',

      'stufe.1': 'First round',
      'stufe.2': 'On speed dial',
      'stufe.3': 'Attic on duty',
      'stufe.4': 'Volunteer for everything',
      'stufe.5': 'District lending office',
      'stufe.6': 'Walking lending library',

      'abz.schluessel': 'Keeper of the key',
      'abz.schluessel.text': 'The link is safe. The rest is up to you.',
      'abz.erster': 'The first one',
      'abz.erster.text': 'Someone has to be first. The second one is quicker.',
      'abz.sortiment': 'A small range',
      'abz.sortiment.text': 'Ten things. Everyone will find something.',
      'abz.aushaus': 'Out of the house',
      'abz.aushaus.text': 'Something is out for the first time. It comes back, almost always.',
      'abz.heimkehr': 'Homecoming',
      'abz.heimkehr.text': 'Out once, back once. That is what this is about.',
      'abz.bumerang': 'Boomerang',
      'abz.bumerang.text': 'Ten times out, ten times back. Your things are homesick.',
      'abz.tagesflug': 'Day trip',
      'abz.tagesflug.text': 'Out and back on the same day. That is called trust.',
      'abz.langeratem': 'Long breath',
      'abz.langeratem.text': 'Four weeks out, and it came back. Do not ask where it was.',
      'abz.allesda': 'All back home',
      'abz.allesda.text': 'Nothing out, everything on the shelf. A good state of affairs.',
      'abz.kleinfein': 'Small and good',
      'abz.kleinfein.text': 'Three things that really go out. No more needed.',
      'abz.tueroeffner': 'Door opener',
      'abz.tueroeffner.text': 'The link is out. Who looks at it stays your secret, even from us.',

      'buch.title': 'Round book',
      'buch.open': 'Open the round book, level {name}',
      'buch.none': 'No round yet',
      'buch.dinge': 'listed',
      'buch.unterwegs': 'out',
      'buch.runden': 'rounds',
      'buch.weiter': 'passed on',
      'buch.rest': 'There are {n} more badges. They come by themselves.',
      'buch.first': 'No badges yet. The first comes with the first item.',
      'buch.local': 'These numbers live in this browser only. They never reach the server and never enter your list. On another device you start at zero.',

      'settings.soundHeadline': 'Sounds',
      'settings.soundLabel': 'Small sounds when lending and getting things back',
      'settings.soundHint': 'Off by default. Four short sounds, nothing else. Switching it on plays one right away. The switch applies to this browser only.',
      'settings.soundOn': 'Sounds are on.',
      'settings.motionHeadline': 'Motion',
      'settings.motionLabel': 'Calm the moving parts',
      'settings.motionHint': 'Confetti, popping faces and the unfolding are dropped; everything appears at once. The switch applies to this browser only.',
      'settings.motionSystem': 'Your system already asks for reduced motion. The application follows that, regardless of this switch.',

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
    /* Deutsch ist die Standardsprache, ohne Ansehen der Browsereinstellung.
       Frueher entschied navigator.language, und Abholer von Suchmaschinen
       melden dort ueblicherweise en-US: Die Seite kippte fuer sie auf
       Englisch, waehrend Titel, Beschreibung und die Auszeichnung fuer die
       Vorschau deutsch blieben — widerspruechliche Angaben unter einer
       .de-Adresse. Englisch bleibt eine Wahl, keine Vermutung; der Schalter
       dafuer steht in der Kopfleiste jeder Seite. */
    return 'de';
  }

  function setLang(next) {
    lang = (next === 'en') ? 'en' : 'de';
    try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    applyStaticI18n();
    fillDatalist();
    /* Auf der Einstellungsseite gibt es nichts zu zeichnen. Ihr fehlen die
       Knoten der Listenansicht, initSettings setzt aber state.mode auf 'edit'
       oder 'circle' — ohne diese Zeile warf der Sprachwechsel dort in
       render() eine unbehandelte Ausnahme. Das galt schon vor dem
       Superliste und faellt hier nur auf, weil er denselben Weg nimmt. */
    /* Die beiden Schaltflaechen fuer Zeigen und Verbergen tragen ihre
       Beschriftung aus dem Woerterbuch. applyStaticI18n setzt sie gerade auf
       "Zeigen" zurueck, auch wenn der Link offen daliegt; dann stuende dort
       das Gegenteil dessen, was ein Druck bewirkt. */
    [['#btnRevealEdit', '#linkEdit'], ['#btnRevealCircle', '#circleLink']].forEach(function (paar) {
      var knopf = $(paar[0]), feld = $(paar[1]);
      if (knopf && feld) { knopf.textContent = t(feld.type === 'password' ? 'share.reveal' : 'share.hide'); }
    });
    if (isSettingsPage()) { return; }
    /* Die Zeilen der Uebersicht tragen uebersetzten Text und werden nur einmal
       gebaut; sie muessen also neu entstehen. Geholt wird dabei nichts:
       renderKreis zeichnet allein aus kreis.eintraege, der Sprachschalter ist
       kein Aktualisieren. render() bleibt unberuehrt — es kehrt fuer 'circle'
       ohnehin gleich zu Beginn zurueck. */
    if (state.mode === 'circle') { renderKreis(); return; }
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
    setAddPlaceholder();
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

  /**
   * Beispiele aus dem Katalog, bei jedem Seitenaufruf andere. Die Auswahl
   * wird EINMAL beim Start gezogen und dann festgehalten: Wuerde sie bei
   * jedem Zeichnen neu ausgewuerfelt, sprangen die Woerter unter dem Finger
   * weg, sobald jemand einen Gegenstand eintraegt.
   *
   * @param {number} n
   * @return {Array<number>} Stellen im Katalog, ohne Wiederholung
   */
  function zieheBeispiele(n) {
    var rest = [];
    for (var i = 0; i < CATALOG.length; i++) { rest.push(i); }
    var gezogen = [];
    var anzahl = Math.min(n, rest.length);
    for (var k = 0; k < anzahl; k++) {
      gezogen.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
    }
    return gezogen;
  }

  var BEISPIELE = null;   // drei fuer den leeren Kasten, eines fuer das Feld

  function beispiele() {
    if (!BEISPIELE) { BEISPIELE = zieheBeispiele(4); }
    return BEISPIELE;
  }

  function katalogWort(index) {
    var eintrag = CATALOG[index];
    return eintrag ? (eintrag[lang] || eintrag.de) : '';
  }

  /** Der Platzhalter nennt einen Gegenstand aus dem Katalog, nicht immer
      denselben. Er wird nach jedem Sprachwechsel neu gesetzt, weil
      applyStaticI18n() sonst die Vorlage mit dem Platzhalter darin schreibt. */
  function setAddPlaceholder() {
    var feld = $('#addName');
    if (!feld) { return; }
    feld.setAttribute('placeholder', t('add.namePlaceholder', { name: katalogWort(beispiele()[3]) }));
  }

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

  /**
   * Die Superliste steht ausdruecklich NEBEN state, nicht darin. save()
   * verschluesselt state.doc im Ganzen; laege dort der Inhalt fremder Listen,
   * schriebe der Kreis ihn in sein eigenes Chiffrat auf den Server — eine
   * Kopie, die niemand mehr entfernt. Auch state.circleData genuegte nicht:
   * Der Abzug in save() griffe sie mit.
   */
  var kreis = {
    updated: null,   // Zeitstempel des letzten Schreibvorgangs, vom Server
    id: null, key: null, keyStr: null, token: null, proof: null,
    rev: 0, doc: null,
    eintraege: [],    // ein Eintrag je Freund, mit doc oder fehler
    zeilen: [],       // die flache Gesamtliste, gebaut aus eintraege
    geprueftAm: 0
  };
  var kreisGen = 0;   // wie docGen: verwerfen statt abbrechen

  function emptyDoc() {
    return {
      v: SCHEMA_VERSION,
      title: '',
      contact: { name: '', email: '', phone: '' },
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
      doc.contact.phone = typeof raw.contact.phone === 'string' ? raw.contact.phone.slice(0, 40) : '';
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

  function emptyCircle() {
    return {
      v: SCHEMA_VERSION,
      kind: 'circle',
      title: '',
      friends: []
    };
  }

  /** Welche Art ein entschluesseltes Dokument behauptet zu sein. Fehlendes
      kind bedeutet 'list' — das laesst jedes heute vorhandene Dokument
      unveraendert gueltig. */
  function kindOf(raw) {
    return (raw && raw.kind === 'circle') ? 'circle' : 'list';
  }

  /**
   * Normalisiert eine Superliste. Kuerzt nie: Eine Schranke, die
   * Eintraege wegwirft, gehoert nicht hierher — der erste Schreibvorgang
   * schriebe die gekuerzte Fassung zurueck, und der Ansehen-Link des
   * verworfenen Freundes stand nur dort. MAX_FRIENDS greift beim Aufnehmen
   * und beim Holen, nicht beim Lesen.
   *
   * Was hier ausdruecklich NICHT steht: kein token (ein fremder
   * Schreibzugang hat in einer Superliste nichts zu suchen), keine
   * fertige url (sonst entschiede fremder Text, wohin diese Anwendung
   * verweist), kein zwischengespeicherter Titel, keine Gegenstaende, kein
   * Kontakt des Freundes. Die Reihenfolge des Feldes leistet, was ein
   * Zeitstempel leisten wuerde.
   *
   * @param {*} raw
   * @param {string|null} selbstId  ID des Kreises; ein Eintrag auf sich
   *                                selbst wird verworfen.
   */
  function normalizeCircle(raw, selbstId) {
    var doc = emptyCircle();
    if (!raw || typeof raw !== 'object') { return doc; }
    doc.title = typeof raw.title === 'string' ? raw.title.slice(0, 80) : '';
    if (!Array.isArray(raw.friends)) { return doc; }
    var gesehen = {};
    doc.friends = raw.friends.filter(function (f) {
      /* Reihenfolge: erst die Form pruefen, dann als Schluessel benutzen.
         Nur so kann keine erfundene id in gesehen etwas anrichten. */
      if (!f || typeof f !== 'object') { return false; }
      if (!ID_RE.test(f.id) || !KEY_RE.test(f.key)) { return false; }
      if (selbstId && f.id === selbstId) { return false; }
      if (gesehen[f.id]) { return false; }
      gesehen[f.id] = true;
      return true;
    }).map(function (f) {
      return {
        id: f.id,
        key: f.key,
        /* label ist die Beschriftung des Nutzers, nicht die Abschrift des
           fremden Dokuments. Deshalb darf sie stehenbleiben, ohne gegen
           "kein Zwischenspeicher entschluesselter Fremdinhalte" zu
           verstossen. */
        label: typeof f.label === 'string' ? f.label.slice(0, 60) : ''
      };
    });
    return doc;
  }

  /**
   * Der Aufrufer sagt, was er erwartet; das Dokument darf das nur bestaetigen
   * oder scheitern lassen. Entschiede das Dokument selbst, waere ein
   * manipuliertes Dokument die Entscheidung.
   */
  function normalizeAny(raw, erwartet, selbstId) {
    if (kindOf(raw) !== erwartet) { throw new AppError('kindmix'); }
    return erwartet === 'circle' ? normalizeCircle(raw, selbstId) : normalizeDoc(raw);
  }

  /* ===================================================================== *
   * 7 · Links & Navigation
   * ===================================================================== */

  function baseUrl() { return location.origin + location.pathname; }
  function viewHash(id, key) { return '#v=' + id + '.' + key; }
  function editHash(id, key, token) { return '#e=' + id + '.' + key + '.' + token; }
  function viewLink() { return baseUrl() + viewHash(state.id, state.keyStr); }
  function editLink() { return baseUrl() + editHash(state.id, state.keyStr, state.token); }
  /* Eine Superliste hat nur diese eine Form. Eine Zwei-Teile-Fassung ohne
     Token gaebe es nicht als Ersparnis, sondern als Falle: Sie reichte die
     Schluessel aller gesammelten Freunde weiter. */
  function circleHash(id, key, token) { return '#k=' + id + '.' + key + '.' + token; }
  function circleLink() { return baseUrl() + circleHash(kreis.id, kreis.keyStr, kreis.token); }

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
    var istKreis = state.mode === 'circle';
    if (istKreis) {
      if (!kreis.id || !kreis.token || !kreis.doc) { return; }
    } else if (state.mode !== 'edit' || !state.id || !state.token) { return; }
    var entry = {
      id: istKreis ? kreis.id : state.id,
      hash: istKreis ? circleHash(kreis.id, kreis.keyStr, kreis.token)
                     : editHash(state.id, state.keyStr, state.token),
      /* Eine Superliste ist dasselbe Versprechen wie eine Liste: ein Link,
         den nur dieses Geraet kennt und dessen Verlust nicht rueckgaengig zu
         machen ist. Nur die Marke sagt, welche Art es ist; ein Eintrag ohne
         kind stammt aus der Zeit davor und gilt als Liste. */
      kind: istKreis ? 'circle' : 'list',
      title: (istKreis ? kreis.doc.title : state.doc.title) || '',
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
  function parseHash() { return parseFragment(location.hash); }

  /**
   * Dieselbe Zerlegung, aber auf einer uebergebenen Zeichenkette: Das
   * Aufnehmen eines Freundes bekommt einen eingefuegten Link und darf nur das
   * Fragment auswerten. Was davor steht, wird verworfen — sonst entschiede
   * fremder Text darueber, wohin diese Anwendung verweist.
   */
  function parseFragment(text) {
    /* Eingefuegte Links tragen fast immer ein Leerzeichen oder einen
       Zeilenumbruch mit; die verankerte Regel scheiterte sonst an einer
       Kleinigkeit, die der Nutzer nicht sieht. */
    var s = String(text || '').replace(/\s+/g, '');
    var at = s.indexOf('#');
    var raw = (at === -1) ? s : s.slice(at + 1);
    if (!raw) { return null; }
    var m = /^([evk])=(.+)$/.exec(raw);
    if (!m) { return null; }
    var parts = m[2].split('.');
    var id = parts[0] || '';
    /* KEY_RE gilt jetzt auch fuer e und v. Das ist eine gewollte Aenderung:
       Ein gekuerzter Schluessel zeigt kuenftig "unvollstaendig oder
       beschaedigt" statt eines Entschluesselungsfehlers. Bestehende Links
       sind unberuehrt, 32 Byte ergeben ueber b64u.encode genau 43 Zeichen. */
    if (!ID_RE.test(id) || !KEY_RE.test(parts[1] || '')) { throw new AppError('badlink'); }
    /* 'v' ist die einzige Form ohne Token. 'e' und 'k' sind beides Zugaenge:
       Eine Superliste wird als Ganzes weitergegeben oder gar nicht, denn
       sein "Ansehen-Link" reichte die Schluessel aller Freunde weiter. */
    if (m[1] === 'v') { return { mode: 'view', id: id, key: parts[1], token: null }; }
    if (!parts[2]) { throw new AppError('badlink'); }
    return { mode: (m[1] === 'k') ? 'circle' : 'edit', id: id, key: parts[1], token: parts[2] };
  }

  /* ===================================================================== *
   * 8 · Rendering
   * ===================================================================== */

  var shownView = null;

  function showView(name) {
    /* Verlassen wir die Uebersicht, verschwinden die entschluesselten
       Fremddaten aus DOM und Speicher. hidden allein genuegt nicht: Der
       Knoten bliebe samt Inhalt im Dokument stehen. */
    if (shownView === 'viewCircle' && name !== 'viewCircle') { kreisRaeumen(); }
    ['viewStart', 'viewList', 'viewError', 'viewCircle'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) { node.hidden = (id !== name); }
    });
    /* Ein Wechsel der Ansicht ist ein Ortswechsel und beginnt deshalb oben.
       Der Browser behaelt den Rollstand sonst bei, weil das Dokument
       dasselbe bleibt: Wer die Schaltflaeche am Fuss der Startseite bedient,
       landete mitten in der neuen Liste, beim Teilen statt beim Anfang. */
    if (shownView !== null && shownView !== name) { window.scrollTo(0, 0); }
    shownView = name;
  }

  /** Raeumt beide Kopien: die im DOM und die im Speicher. Der Zaehler steigt
      mit, damit laufende Abrufe ins Leere fallen. Einen AbortController gibt
      es in dieser Anwendung nicht, und apiGet nimmt keinen; die Anfragen
      laufen also zu Ende, ihr Ergebnis landet nur nirgends mehr. */
  function kreisRaeumen() {
    /* Zuerst schreiben, dann raeumen: Danach fehlen Schluessel und Nachweis. */
    kreisFristEinloesen();
    kreisGen++;
    var liste = $('#circleItems');
    if (liste) { liste.textContent = ''; }
    /* Der Aufklapper traegt die Namen der gesammelten Personen und ihren
       Zustand. Er gehoert genauso geraeumt wie die Gegenstandsliste; ohne
       diese Zeile blieben entschluesselte Fremdnamen im Dokument stehen. */
    var freunde = $('#circleFriends');
    if (freunde) { freunde.textContent = ''; }
    kreis.doc = null;
    kreis.eintraege = [];
    kreis.zeilen = [];
    kreis.key = null;
    kreis.keyStr = null;
    kreis.token = null;
    kreis.proof = null;
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
  function toast(msg, action, gesicht) {
    var node = $('#toast');
    var act = $('#toastAct');
    var body = $('#toastText');
    body.textContent = '';
    if (gesicht) {
      var ico = icon(gesicht);
      ico.setAttribute('class', 'ico toast__face');
      body.appendChild(ico);
    }
    body.appendChild(document.createTextNode(msg));
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

  /** Nimmt die Meldung vorzeitig weg. Gebraucht, wo die angebotene
      Gegenhandlung nicht mehr moeglich ist. */
  function toastSchliessen() {
    clearTimeout(toastTimer);
    var node = $('#toast'), act = $('#toastAct');
    if (!node) { return; }
    node.hidden = true;
    if (act) { act.hidden = true; act.onclick = null; }
  }

  function setSaveState(kind) {
    var node = $('#saveState');
    if (!node) { return; }
    if (state.mode !== 'edit' || !kind) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.textContent = t('status.' + kind);
    /* chip--sm gehoert dazu: Der Zustand steht klein neben dem Titel, und
       diese Zeile schreibt die Klassenliste vollstaendig neu. */
    node.className = 'chip chip--sm' + (kind === 'saved' ? ' chip--ok' : (kind === 'error' ? ' chip--warn' : ''));
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
    /* Die Ueberschrift bleibt in beiden Modi im Dokument. Im Bearbeiten-Modus
       steht daneben das Feld mit demselben Text, deshalb wird sie dort nur
       unsichtbar — verborgen waere die Seite ohne Ebene 1, und wer per
       Ueberschriftensprung navigiert, erfuehre nie, welche Liste offen ist. */
    titleRead.hidden = false;
    titleRead.classList.toggle('sr-only', isEdit);
    titleRead.textContent = state.doc.title || t('list.untitled');
    if (isEdit && document.activeElement !== titleInput) { titleInput.value = state.doc.title; }
    /* Kein entschluesselter Titel hier. <title> steht im <head> und damit
       ausserhalb jedes translate="no"; ausserdem nimmt der Browser den
       Seitentitel in den Verlauf auf und traegt ihn bei eingeschalteter
       Synchronisierung an den Hersteller weiter. Beides waere eine
       Uebertragung von Listeninhalt, und die Datenschutzerklaerung sagt
       ausdruecklich zu, dass es sie nicht gibt. Die Art der Ansicht steht
       trotzdem im Reiter, damit sich zwei offene Reiter unterscheiden. */
    document.title = t(isEdit ? 'title.edit' : 'title.view');

    /* Bereiche, die nur im Bearbeitenmodus sichtbar sind */
    $('#shareBox').hidden = !isEdit;
    $('#addForm').hidden = !isEdit;
    $('#contactBox').hidden = !isEdit;
    $('#backupBox').hidden = !isEdit;
    $('#btnRefresh').hidden = isEdit;
    /* Nur in der Liste eines Freundes: Die eigene Liste in den eigenen Kreis
       zu legen ergibt nichts, sie steht schon im Kasten darunter. */
    $('#circleAddHereRow').hidden = isEdit;
    if (!isEdit) { $('#keyBox').hidden = true; }

    if (isEdit) {
      $('#linkView').value = viewLink();
      $('#linkEdit').value = editLink();
      if (document.activeElement !== $('#cfgName')) { $('#cfgName').value = state.doc.contact.name; }
      if (document.activeElement !== $('#cfgEmail')) { $('#cfgEmail').value = state.doc.contact.email; }
      if (document.activeElement !== $('#cfgPhone')) { $('#cfgPhone').value = state.doc.contact.phone; }
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
    updateNav();
    setSaveState(state.saving ? 'saving' : (state.dirty ? 'unsaved' : 'saved'));
  }

  /**
   * Die Zeile unter dem Titel und der Zeitstempel im Kopf des Inventars.
   *
   * Die Zeile gilt nur noch dem Ansehen-Modus: von wem die Liste ist und was
   * gerade frei ist — die einzige Zahl, die Freunde wirklich interessiert.
   * Wer selbst bearbeitet, weiss beides und bekommt dort nichts zu lesen.
   * Fuer ihn steht allein der Zeitpunkt des letzten Schreibens neben der
   * Ueberschrift des Inventars.
   */
  function renderMeta() {
    /* Der Satz ueber der Liste gilt nur noch dem Freund: Wessen Liste das
       ist und wie viel gerade frei ist. Wer selbst bearbeitet, weiss beides
       und braucht die Zeile nicht. */
    var parts = [];
    if (state.mode === 'view') {
      var frei = 0;
      state.doc.items.forEach(function (it) { if (it.status !== 'lent') { frei++; } });
      var owner = (state.doc.contact.name || '').trim();
      if (owner) { parts.push(t('list.by', { name: owner })); }
      parts.push(frei === 1 ? t('list.free_1') : t('list.free', { n: frei }));
    }
    $('#listMeta').textContent = parts.join(' · ');

    /* Im Bearbeiten-Modus steht ueber der Liste kein Satz mehr. Wann zuletzt
       geschrieben wurde, gehoert klein neben die Ueberschrift des Inventars:
       Es ist eine Angabe zur Liste, keine Ueberschrift der Seite. */
    var stamp = $('#listUpdated');
    if (stamp) {
      var zeigen = state.mode === 'edit' && !!state.updated;
      stamp.hidden = !zeigen;
      var wann = zeigen ? formatDate(state.updated) : '';
      stamp.textContent = wann;
      /* Sichtbar steht dort nur Datum und Uhrzeit. Vorgelesen waere das eine
         Zahl ohne Zusammenhang, zumal die gleich aussehende Angabe daneben
         etwas anderes bedeutet — deshalb traegt der Knoten die Beschriftung,
         die der Text nicht zeigt. */
      if (wann) { stamp.setAttribute('aria-label', t('items.updatedLabel', { date: wann })); }
      else { stamp.removeAttribute('aria-label'); }
    }
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
    renderEmptyHints(items.length === 0 && state.mode === 'edit');
    renderMeta();
    renderChecked();
    updateLevelChip();
  }

  /**
   * Drei anklickbare Vorschlaege im leeren Kasten. Sie tragen nichts ein,
   * sondern schreiben das Wort ins Feld und setzen den Schreibzeiger dahinter
   * — ein Fehlgriff richtet damit nichts an. Sie beschleunigen genau die
   * Phase, die am laengsten dauert, und verschwinden danach fuer immer.
   */
  function renderEmptyHints(zeigen) {
    var box = $('#itemsEmptyEg');
    var liste = $('#itemsEmptyList');
    if (!box || !liste) { return; }
    box.hidden = !zeigen;
    if (!zeigen) { return; }
    liste.textContent = '';
    beispiele().slice(0, 3).forEach(function (idx, i) {
      var wort = katalogWort(idx);
      if (!wort) { return; }
      if (i > 0) { liste.appendChild(document.createTextNode(' · ')); }
      var b = el('button', null, wort);
      b.type = 'button';
      b.addEventListener('click', function () {
        var feld = $('#addName');
        feld.value = wort;
        feld.focus();
        try { feld.setSelectionRange(wort.length, wort.length); } catch (e) { /* egal */ }
      });
      liste.appendChild(b);
    });
  }

  /**
   * Die gemerkten Listen auf der Startseite. Sie stehen dort, wo jemand sie
   * sucht, der den Reiter geschlossen hat — und nur dann, wenn es sie gibt.
   */
  /* Das Fragment, das die Startseite zum Kasten mit den Listen fuehrt. Es
     ist absichtlich kein Zugangslink: parseHash() erkennt es nicht und
     liefert null, die Startseite erscheint also ganz normal. */
  var MINE_HASH = '#meine';

  /**
   * Wohin ein Weg fuehrt, oder null, wenn dieses Geraet keine Liste dieser Art
   * kennt. Die Regel ist fuer beide Arten dieselbe:
   *
   * - eine Liste: unmittelbar in diese Liste. Ein Zwischenhalt, auf dem genau
   *   ein Eintrag steht, waere ein Klick ohne Gegenwert.
   * - mehrere: auf die Startseite und dort zum Kasten. Der sitzt unter dem
   *   Aufruf, und ohne den Sprung landete man wieder oben — der Knopf sah
   *   deshalb bisher wirkungslos aus.
   *
   * Der Kasten zeigt beide Arten zusammen. Das ist kein Widerspruch: Getrennt
   * sind die Wege, damit ihr Wort haelt, was es verspricht — nicht der Ort,
   * an dem man ankommt.
   */
  function navZiel(kreisArt) {
    var passend = readMine().filter(function (e) { return (e.kind === 'circle') === kreisArt; });
    if (!passend.length) { return null; }
    return './' + (passend.length === 1 ? passend[0].hash : MINE_HASH);
  }

  function navSetzen(knoten, ziel) {
    if (!knoten) { return; }
    knoten.hidden = !ziel;
    if (ziel) { knoten.setAttribute('href', ziel); }
  }

  /**
   * Die Wege zu den eigenen Listen, an beiden Orten zugleich: breit in der
   * Kopfleiste, schmal in der schwebenden Schaltflaeche. Beide stehen im
   * Dokument, welcher zu sehen ist, entscheidet allein das Erscheinungsbild —
   * so bleibt hier eine Schaltung statt zweier, die auseinanderlaufen koennen.
   *
   * Jeder Weg erscheint erst, wenn es eine Liste seiner Art gibt. Seit es
   * zwei Arten gibt, ist das keine Feinheit mehr: "Superliste" ueber einem
   * Geraet, das keine kennt, versprach einen Ort, den es nicht gibt.
   */
  function updateNav() {
    var listen = navZiel(false);
    var kreise = navZiel(true);
    navSetzen($('#lnkMine'), listen);
    navSetzen($('#fabMine'), listen);
    navSetzen($('#lnkCircle'), kreise);
    navSetzen($('#fabCircle'), kreise);
    /* Die beiden Huellen tragen kein eigenes Ziel und verschwinden, wenn
       beide Wege verschwinden: sonst bliebe in der Kopfleiste eine Luecke und
       am Fuss eine Schaltflaeche, hinter der nichts steht. */
    var etwas = !!(listen || kreise);
    sichtbar($('#barMine'), etwas);
    sichtbar($('#fab'), etwas);
    if (!etwas) { fabZu(false); }
  }

  function sichtbar(knoten, ja) { if (knoten) { knoten.hidden = !ja; } }

  /**
   * Die Schaltung der Wege. Sie steht fuer sich und nicht in bindEvents(),
   * weil die Einstellungsseite dieselbe Kopfleiste und dieselbe schwebende
   * Schaltflaeche traegt, aber einen eigenen Einstieg hat — initSettings()
   * kehrt vor bindEvents() um. Ohne diesen eigenen Aufruf blieb die Wahl
   * dort offen stehen: Escape und der Tipper daneben fehlten.
   */
  function bindNav() {
    /* Steht das Fragment schon, loest ein weiterer Klick kein hashchange aus.
       Dann springt dieser Weg. Alle vier Verweise teilen ihn: Es sind dieselben
       zwei Wege, nur an zwei Orten. */
    ['#lnkMine', '#lnkCircle', '#fabMine', '#fabCircle'].forEach(function (wahl) {
      var knoten = $(wahl);
      if (!knoten) { return; }
      knoten.addEventListener('click', function (ev) {
        fabZu(false);
        if (this.getAttribute('href') !== './' + MINE_HASH) { return; }
        if (location.hash !== MINE_HASH) { return; }
        ev.preventDefault();
        zeigeMeine();
      });
    });

    if (!$('#fab')) { return; }
    /* Ein <details> geht von sich aus nur ueber seine eigene Flaeche wieder
       zu. Beides hier nachgereicht, damit sich die Wahl wie ein Menue anfuehlt:
       Escape nimmt sie zurueck und gibt die Fuehrung an die Flaeche, ein
       Tipper daneben nimmt sie stumm zurueck. Der Tipper auf die Flaeche
       selbst liegt innerhalb und faellt deshalb nicht darunter — das <details>
       hat da schon umgeschaltet. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') { return; }
      var fab = $('#fab');
      if (!fab || !fab.open) { return; }
      /* Ohne das schloesse Escape zugleich ein offenes Fenster darunter. */
      ev.preventDefault();
      fabZu(true);
    });
    document.addEventListener('click', function (ev) {
      var fab = $('#fab');
      if (fab && fab.open && !fab.contains(ev.target)) { fabZu(false); }
    });
  }

  /** Klappt die schwebende Schaltflaeche zu; mit true kehrt die Fuehrung auf sie zurueck. */
  function fabZu(fokus) {
    var fab = $('#fab');
    if (!fab || !fab.open) { return; }
    fab.open = false;
    var flaeche = $('.fab__btn', fab);
    if (fokus && flaeche) { flaeche.focus(); }
  }

  /** Holt den Kasten ins Bild und uebergibt ihm die Tastaturfuehrung. */
  function zeigeMeine() {
    var box = $('#mineBox');
    if (!box || box.hidden) { return; }
    box.scrollIntoView({ block: 'start', behavior: ruhig() ? 'auto' : 'smooth' });
    var erste = $('#mineList a');
    if (erste) { erste.focus({ preventScroll: true }); }
  }

  function renderMine() {
    var box = $('#mineBox');
    var list = $('#mineList');
    if (!box || !list) { return; }
    var mine = readMine();
    list.textContent = '';
    box.hidden = mine.length === 0;
    updateNav();
    if (!mine.length) { return; }

    mine.forEach(function (entry) {
      var istKreis = entry.kind === 'circle';
      var li = el('li');
      var a = el('a');
      a.href = entry.hash;
      /* Zeichen und Marke sagen dasselbe, und das mit Absicht: Das Zeichen
         traegt den Blick, die Marke traegt die Vorlesestimme und die
         Uebersetzung. Das Zeichen bleibt deshalb aria-hidden. */
      var marke = el('span', 'kind' + (istKreis ? ' kind--kreis' : ''));
      marke.appendChild(icon(istKreis ? 'kreis' : 'leihliste'));
      a.appendChild(marke);
      a.appendChild(el('span', 'name', entry.title || t(istKreis ? 'circle.untitled' : 'list.untitled')));
      a.appendChild(el('span', 'chip chip--sm', t(istKreis ? 'circle.badge' : 'list.badge')));
      if (entry.ts) { a.appendChild(el('span', 'when', formatDay(new Date(entry.ts).toISOString().slice(0, 10)))); }
      a.appendChild(icon('chev'));
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function statusLabel(item) { return t(item.status === 'lent' ? 'item.lent' : 'item.available'); }

  /**
   * Die runde Marke links in der Zeile. Sie traegt die einzige Aussage, die
   * sich auf einen Blick lesen lassen muss: frei oder nicht. Die Farbe sagt
   * es weiterhin, das Gesicht traegt den Ton — und ab dreissig Tagen wird aus
   * dem Hinterherschauen ein geduldiges Warten. Das ist als einziges Stueck
   * des Verspielten eine echte Auskunft: Es wird bei fuenfzig Gegenstaenden
   * nicht lauter, sondern nuetzlicher.
   */
  function statusBadge(item) {
    var lent = item.status === 'lent';
    var badge = el('span', 'item-badge');
    var tage = lent ? tageSeit(item.since) : null;
    badge.appendChild(icon(!lent ? 'face-frei'
      : (tage !== null && tage >= LANG_AUS ? 'face-lang' : 'face-weg')));
    return badge;
  }

  /**
   * Wer hat es, und seit wann. Ohne Namen bleibt es bei der Tatsache.
   *
   * Ob der Name gezeigt wird, entscheidet das Dokument, AUS DEM der
   * Gegenstand stammt. In der Superliste ist das nicht die geoeffnete
   * Sammlung, und beide naheliegenden Kurzschluesse waeren falsch:
   * state.mode === 'edit' zeigte Namen, die ein Freund verborgen hat;
   * state.doc.showBorrower der Sammlung ist das false aus emptyCircle() und
   * verschwiege Namen, die ein Freund ausdruecklich zeigt. Die Flagge gehoert
   * an die Herkunft, also an den Aufrufer.
   */
  function lentLine(item, zeigeName) {
    var show = zeigeName === true;
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
    if (lent) { text.appendChild(el('span', 'item-state', lentLine(item, state.mode === 'edit' || state.doc.showBorrower))); }
    else if (item.note) { text.appendChild(el('span', 'item-note', item.note)); }

    if (state.mode === 'view') {
      var row = el('div', 'itemrow' + (lent ? ' items-read-lent' : ''));
      row.appendChild(statusBadge(item));
      row.appendChild(text);
      /* Frei oder verliehen traegt im Ansehen-Modus sonst allein die Farbe.
         Vorgelesen klaenge eine Liste aus zehn Sachen wie zehnmal dasselbe. */
      row.appendChild(el('span', 'sr-only', statusLabel(item)));
      if (!lent) {
        var ask = el('button', 'btn btn--primary btn--sm item-ask');
        ask.type = 'button';
        ask.setAttribute('data-act', 'ask');
        ask.textContent = t('item.ask');
        /* Sonst heissen alle Schaltflaechen der Liste gleich. Der sichtbare
           Text bleibt Anfragen, der Name bekommt den Gegenstand dazu. */
        ask.appendChild(el('span', 'sr-only', ' ' + item.name));
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
    /* Das Formular traegt nur den Namen ein; alles Weitere steht hinter der
       Zeile. Ohne Beschriftung ist dem Pfeil nicht anzusehen, dass sich
       dahinter Notiz, Verleihen und Loeschen verbergen. */
    btn.appendChild(el('span', 'item-more', t('item.more')));
    var chev = el('span', 'item-chev');
    chev.appendChild(icon('chev'));
    btn.appendChild(chev);
    li.appendChild(btn);
    return li;
  }

  /* ------------------------------------------------------------------ *
   * Superliste · Zusammenfuehren, Zeichnen, Suchen
   *
   * Geholt wird hier nichts. Alles, was diese Funktionen brauchen, steht in
   * kreis.eintraege; deshalb kosten ein Sprachwechsel und jeder Tastendruck
   * in der Suche keine einzige Anfrage.
   * ------------------------------------------------------------------ */

  /* Der Name der Person, zur Laufzeit aufgeloest. Die Reihenfolge ist
     absichtlich Kontaktname vor Titel: renderMeta baut daraus schon "Liste
     von {name}", der Titel dagegen ist der Name einer Liste und nicht der
     einer Person. Der Rueckfall ist ein eigener Text und NICHT
     t('list.untitled') — das waere "Leih-Katalog" und liesse die Suche nach
     "katalog" schlagartig alle unbenannten Freunde treffen. */
  function freundName(e) {
    if (e.freund.label) { return e.freund.label; }
    if (e.doc) {
      var k = (e.doc.contact.name || '').trim();
      if (k) { return k; }
      var tl = (e.doc.title || '').trim();
      if (tl) { return tl; }
    }
    return t('circle.unnamed');
  }

  /* Verglichen wird auf beiden Seiten gleich gefaltet, sonst findet die
     Eingabe nur, was zufaellig genauso geschrieben ist. Zwei Faltungen, weil
     Deutsch zwei Schreibweisen desselben Wortes kennt: Wer "Rasenmaeher"
     sucht, tippt je nach Tastatur "rasenmäher" oder "rasenmaeher". Der
     Katalog fuehrt genau diesen Doppelfall schon als zwei Eintraege.
     Kein String.prototype.normalize: CONTRIBUTING.md nennt Promise, fetch und
     crypto.subtle als abgeschlossene Ausnahmen von ES5. */
  function falteA(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .replace(/á|à|â/g, 'a').replace(/é|è|ê/g, 'e').replace(/í|ì|î/g, 'i')
      .replace(/ó|ò|ô/g, 'o').replace(/ú|ù|û/g, 'u').replace(/ß/g, 'ss');
  }
  function falteAe(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/á|à|â/g, 'a').replace(/é|è|ê/g, 'e').replace(/í|ì|î/g, 'i')
      .replace(/ó|ò|ô/g, 'o').replace(/ú|ù|û/g, 'u').replace(/ß/g, 'ss');
  }

  /** Baut die flache Gesamtliste aus den geholten Eintraegen. */
  function kreisZeilen() {
    var zeilen = [];
    kreis.eintraege.forEach(function (e) {
      if (!e || !e.doc) { return; }
      var person = freundName(e);
      /* Ob der Name des Ausleihenden gezeigt wird, entscheidet die Liste, aus
         der der Gegenstand stammt — nicht die geoeffnete. */
      var zeigeName = e.doc.showBorrower === true;
      e.doc.items.forEach(function (it) {
        /* Mit Trenner verbunden, damit ein Suchteil nicht ueber eine
           Feldgrenze hinweg trifft. Gesucht wird in Gegenstand, Person und
           Notiz — ausdruecklich nicht im Namen des Ausleihenden: Der ist je
           nach showBorrower unsichtbarer Text, und eine Suche, die
           unsichtbaren Text trifft, liefert Zeilen ohne erkennbaren Grund. */
        var roh = it.name + ' · ' + person + (it.note ? ' · ' + it.note : '');
        zeilen.push({
          fid: e.freund.id, fkey: e.freund.key, iid: it.id,
          name: it.name, note: it.note, status: it.status,
          borrower: it.borrower, since: it.since,
          person: person, zeigeName: zeigeName,
          such: { a: falteA(roh), ae: falteAe(roh) },
          node: null
        });
      });
    });

    /* Flach nach Gegenstandsname, bei Gleichstand nach Person. Nicht nach
       Person gruppiert — das laese sich als "Liste der Listen", und gesucht
       wird eine Bohrmaschine, kein Freund. Nicht "frei zuerst" — sonst
       springt die Liste, sobald ein Freund etwas verleiht. numeric: damit
       "Steckschluessel 2" vor "Steckschluessel 10" steht. Ein einmal gebauter
       Collator statt neuer Optionen je Vergleich; das try/catch folgt
       formatDate. */
    var koll = null;
    try { koll = new Intl.Collator(lang, { numeric: true }); } catch (e) { koll = null; }
    function vgl(a, b) { return koll ? koll.compare(a, b) : a.localeCompare(b, lang); }
    zeilen.sort(function (x, y) {
      var n = vgl(x.name, y.name);
      return n !== 0 ? n : vgl(x.person, y.person);
    });
    return zeilen;
  }

  /* Die Eingabe wird an Leerzeichen zerlegt und alle Teile muessen zutreffen,
     jeder darf in einem anderen Feld sitzen: "anna bohr" findet dasselbe wie
     "bohr anna". indexOf und nicht Wortanfang, weil "schluessel" in
     "Steckschluesselsatz" bei deutschen Zusammensetzungen der Normalfall ist.
     Kein String.includes — ES5. */
  function sucheTeile(eingabe) {
    var roh = String(eingabe || '').replace(/^\s+|\s+$/g, '');
    if (!roh) { return null; }
    var teile = roh.split(/\s+/);
    var out = [];
    for (var i = 0; i < teile.length; i++) {
      out.push({ a: falteA(teile[i]), ae: falteAe(teile[i]) });
    }
    return out;
  }

  function passt(z, teile) {
    if (!teile) { return true; }
    for (var i = 0; i < teile.length; i++) {
      if (z.such.a.indexOf(teile[i].a) < 0 && z.such.ae.indexOf(teile[i].ae) < 0) { return false; }
    }
    return true;
  }

  function renderKreisRow(z) {
    var li = el('li', 'item item--' + z.status + (z.status === 'lent' ? ' items-read-lent' : ''));
    /* data-fid/data-iid statt data-id: markRow sucht global nach
       .item[data-id], und Gegenstands-IDs sind ueber mehrere Freundeslisten
       hinweg nicht eindeutig — normalizeDoc uebernimmt jede vorhandene
       Zeichenkette. Eine Zeile wird hier ueber das Paar angesprochen. */
    li.setAttribute('data-fid', z.fid);
    li.setAttribute('data-iid', z.iid);

    var a = el('a', 'itemrow');
    a.href = viewHash(z.fid, z.fkey);
    a.appendChild(statusBadge(z));

    var text = el('span', 'item-text');
    text.appendChild(el('span', 'item-name', z.name));
    if (z.status === 'lent') { text.appendChild(el('span', 'item-state', lentLine(z, z.zeigeName))); }
    /* Anders als im Inventar steht die Notiz auch an einer verliehenen Sache:
       Die Uebersicht ist eine Suchflaeche, und eine Zeile muss zeigen
       koennen, warum sie ein Treffer ist. */
    if (z.note) { text.appendChild(el('span', 'item-note', z.note)); }
    a.appendChild(text);

    a.appendChild(el('span', 'item-who', z.person));
    a.appendChild(el('span', 'sr-only', statusLabel(z)));
    var chev = el('span', 'item-chev');
    chev.appendChild(icon('chev'));
    a.appendChild(chev);
    li.appendChild(a);
    return li;
  }

  /** Baut die Zeilen einmal. Ein Tastendruck legt danach nur hidden um. */
  function renderKreisListe() {
    var liste = $('#circleItems');
    if (!liste) { return; }
    liste.textContent = '';
    kreis.zeilen = kreisZeilen();
    kreis.zeilen.forEach(function (z) {
      z.node = renderKreisRow(z);
      liste.appendChild(z.node);
    });
    filterKreis();
    renderKreisFreunde();
    renderKreisMeta();
    /* Hier und nicht in renderKreis: Aufnehmen und Entfernen gehen nicht ueber
       das vollstaendige Zeichnen, und gerade sie legen den Schalter um. */
    renderKreisManage();
  }

  /* Die Zeile unter dem Titel sagt, worueber die Uebersicht ueberhaupt geht.
     Sie steht hier und nicht in renderKreis, weil sie sich mit jedem
     Aufnehmen und Entfernen aendert und nicht erst beim naechsten
     vollstaendigen Zeichnen. */
  function renderKreisMeta() {
    var node = $('#circleMeta');
    if (!node) { return; }
    var n = kreis.doc ? kreis.doc.friends.length : 0;
    node.textContent = n === 0 ? '' : (n === 1 ? t('circle.meta_1') : t('circle.meta', { n: n }));
  }

  /**
   * Eine Zeile je gesammelter Liste im Aufklapper: Name, Zustand und, nur mit
   * Zugang, die Knoepfe. Sie ist der einzige Ort, an dem eine Liste benannt
   * wird, die sich nicht holen liess — in der Uebersicht selbst fehlten ihre
   * Gegenstaende sonst wortlos.
   */
  function renderKreisFreunde() {
    var liste = $('#circleFriends');
    if (!liste || !kreis.doc) { return; }
    liste.textContent = '';
    var istZugang = !!kreis.token;
    var vorschau = !!(Store && Store.kind === 'local');

    kreis.doc.friends.forEach(function (f, idx) {
      var e = null;
      for (var i = 0; i < kreis.eintraege.length; i++) {
        if (kreis.eintraege[i] && kreis.eintraege[i].freund.id === f.id) { e = kreis.eintraege[i]; break; }
      }
      var li = el('li', 'item');
      var row = el('div', 'itemrow');
      var text = el('span', 'item-text');
      text.appendChild(el('span', 'item-name', e ? freundName(e) : (f.label || t('circle.unnamed'))));

      var zustand;
      /* Ueber der Grenze wird nicht geholt, aber auch nichts verworfen: Der
         Normalisierer kuerzt nie, sonst waere der Ansehen-Link beim ersten
         Schreibvorgang weg. Also steht hier, was mit dem Eintrag ist. */
      if (idx >= MAX_FRIENDS) { zustand = t('circle.fOverflow', { n: MAX_FRIENDS }); }
      else if (!e) { zustand = t('circle.fPending'); }
      else if (e.fehler) {
        /* Im Vorschaumodus ist 'notfound' der Normalfall und kein Befund: Die
           Liste des Freundes liegt in dessen Browser, nicht in diesem
           localStorage. Dann steht dort der Grund und nicht der Fehler. */
        zustand = (vorschau && e.fehler === 'notfound')
          ? t('circle.fPreview') : t('error.' + e.fehler);
      }
      else if (!e.doc) { zustand = t(e.langsam ? 'circle.fSlow' : 'circle.fPending'); }
      else { zustand = e.doc.items.length === 1 ? t('circle.fCount_1') : t('circle.fCount', { n: e.doc.items.length }); }
      text.appendChild(el('span', 'item-note', zustand));
      row.appendChild(text);

      if (istZugang) {
        /* Erneut versuchen nur, wo es helfen kann: kreisWiederholbar
           entscheidet ueber den HTTP-Status, nicht ueber den uebersetzten
           Code. Im Vorschaumodus hilft es nie. */
        if (e && e.fehler && !vorschau && kreisWiederholbar(e)) {
          var wieder = el('button', 'btn btn--sm');
          wieder.type = 'button';
          wieder.setAttribute('data-kreis-act', 'retry');
          wieder.setAttribute('data-kreis-id', f.id);
          wieder.textContent = t('circle.retry');
          row.appendChild(wieder);
        }
        /* Entfernen bleibt auch im Vorschaumodus stehen, anders als im
           Bauplan vorgesehen: Dort scheitert jede fremde Liste, und ohne
           diesen Knopf waere das Aufnehmen dort unumkehrbar. Der Zustand
           daneben sagt schon, dass nichts kaputt ist. */
        var weg = el('button', 'btn btn--sm');
        weg.type = 'button';
        weg.setAttribute('data-kreis-act', 'remove');
        weg.setAttribute('data-kreis-id', f.id);
        weg.textContent = t('circle.remove');
        row.appendChild(weg);
      }
      li.appendChild(row);
      liste.appendChild(li);
    });
  }

  /* Keine Entprellung. Teuer ist nicht das Vergleichen, sondern das DOM: Die
     Zeilen entstehen einmal, ein Tastendruck legt danach nur hidden um.
     [hidden] { display: none !important } steht im Erscheinungsbild, und auf
     .item liegt keine eigene display-Regel — die Zeilen fallen also
     zuverlaessig aus dem Raster von .items heraus. Eine Verzoegerung kurierte
     das Falsche: Sie verzoegert die Antwort, statt die Arbeit zu
     verkleinern. */
  function filterKreis() {
    if (!kreis.doc) { return; }
    var teile = sucheTeile($('#circleQ').value);
    var treffer = 0;
    for (var i = 0; i < kreis.zeilen.length; i++) {
      var ja = passt(kreis.zeilen[i], teile);
      kreis.zeilen[i].node.hidden = !ja;
      if (ja) { treffer++; }
    }
    var fehlt = 0, freunde = 0;
    for (var j = 0; j < kreis.eintraege.length; j++) {
      var e = kreis.eintraege[j];
      if (!e) { continue; }
      freunde++;
      if (e.fehler) { fehlt++; }
    }
    /* Listen jenseits von MAX_FRIENDS stehen im Dokument, werden aber nicht
       geholt. Sie sind kein Fehler und gehoeren deshalb nicht zu fehlt, aber
       ohne sie behauptete die Zahl eine Vollstaendigkeit, die es nicht gibt. */
    var drueber = Math.max(0, kreis.doc.friends.length - kreis.eintraege.length);
    $('#circleEmptyAll').hidden  = !(freunde > 0 && kreis.zeilen.length === 0 && fehlt === 0);
    $('#circleEmptyHit').hidden  = !(teile && treffer === 0 && kreis.zeilen.length > 0);
    renderKreisZahl(treffer, kreis.zeilen.length, !!teile, fehlt, drueber);
  }

  function renderKreisZahl(treffer, gesamt, gefragt, fehlt, drueber) {
    var node = $('#circleCount');
    if (!node) { return; }
    var txt;
    if (!gefragt) { txt = gesamt === 1 ? t('circle.total_1') : t('circle.total', { n: gesamt }); }
    else if (treffer === 0) { txt = t('circle.none'); }
    else { txt = treffer === 1 ? t('circle.hits_1', { g: gesamt }) : t('circle.hits', { n: treffer, g: gesamt }); }
    /* Die Zahl gilt nur fuer das, was wirklich angekommen ist. Ohne diesen
       Zusatz behauptete sie eine Vollstaendigkeit, die es nicht gibt. */
    if (fehlt) { txt += ' · ' + (fehlt === 1 ? t('circle.missing_1') : t('circle.missing', { n: fehlt })); }
    if (drueber) { txt += ' · ' + (drueber === 1 ? t('circle.beyond_1') : t('circle.beyond', { n: drueber })); }
    node.textContent = txt;
  }

  /** "zuletzt geprueft vor …", mit eigener Zeitmarke und eigenem Knoten:
      renderChecked steigt bei state.mode !== 'view' aus und schreibt in
      #checkedAt, einen Knoten aus #viewList. */
  function renderKreisChecked() {
    var node = $('#circleChecked');
    if (!node) { return; }
    if (!kreis.geprueftAm) { node.textContent = ''; return; }
    var min = Math.round((Date.now() - kreis.geprueftAm) / 60000);
    node.textContent = min < 1 ? t('items.checkedNow') : t('items.checked', { n: min });
  }

  /**
   * Der Aufklapper zum Aufnehmen kennt zwei Lagen, und welche gilt, entscheidet
   * allein die Zahl der gesammelten Leihlisten.
   *
   * Steht noch keine drin, gibt es nichts zu durchsuchen: "Was es gibt" tritt
   * ganz ab, der Aufklapper rueckt damit an den Kopf der Ansicht, steht offen
   * und heisst nach dem, was jetzt ansteht — die Leihlisten der Freunde
   * ergaenzen. Steht schon eine drin, ist die Uebersicht der Zweck und das
   * Aufnehmen der Anlass: Dann heisst der Aufklapper nach seiner Handlung und
   * bleibt zu.
   *
   * Die Ueberschrift wird nicht nur geschrieben, sondern auch umgeschluesselt:
   * Ohne das gesetzte data-i18n schriebe der naechste Sprachwechsel die alte
   * Zeile zurueck, denn applyStaticI18n() liest das Attribut, nicht den Zustand.
   */
  function renderKreisManage() {
    var istZugang = !!kreis.token;
    var box = $('#circleBox');
    var titel = $('#circleManageTitle');
    var lead = $('#circleManageLead');
    if (!box || !titel || !lead) { return; }
    var leer = istZugang && !!(kreis.doc && kreis.doc.friends.length === 0);
    box.hidden = leer;
    var schluessel = leer ? 'circle.emptyNoneHead' : 'circle.manageHeadline';
    titel.setAttribute('data-i18n', schluessel);
    titel.textContent = t(schluessel);
    lead.hidden = !leer;
    /* Die Ehrlichkeitszeile spricht von den Personen, deren Leihlisten hier
       stehen. Steht noch keine drin, spricht sie von niemandem. */
    sichtbar($('#circleTruth'), !leer);
    /* Nur aufklappen, nie zuklappen: Zugeklappt zeigte die leere Superliste
       ueberhaupt nichts mehr. Wer schon etwas gesammelt hat, behaelt dagegen
       seinen Stand, auch ueber ein erneutes Zeichnen hinweg. */
    if (leer) { $('#circleManage').open = true; }
  }

  /** Zeichnet die Uebersicht vollstaendig. Holt nichts. */
  function renderKreis() {
    showView('viewCircle');
    var istZugang = !!kreis.token;
    $('#circleTitleWrap').hidden = !istZugang;
    $('#circleTitleRead').hidden = false;
    $('#circleTitleRead').classList.toggle('sr-only', istZugang);
    $('#circleTitleRead').textContent = (kreis.doc && kreis.doc.title) || t('circle.untitled');
    if (istZugang && document.activeElement !== $('#circleTitleInput')) {
      $('#circleTitleInput').value = (kreis.doc && kreis.doc.title) || '';
    }
    /* Der Seitentitel bleibt fest: <title> steht im <head> und damit
       ausserhalb jedes translate="no". Ein Kreisname dort waere eine Aussage
       ueber Dritte an einer Stelle, die die Anwendung nicht abschirmen kann. */
    $('#circleManage').hidden = !istZugang;
    $('#circleShareBox').hidden = !istZugang;
    $('#circlePreview').hidden = !(Store && Store.kind === 'local');
    if (istZugang) { $('#circleLink').value = circleLink(); }
    /* #circleKeyBox wird hier ausdruecklich NICHT verborgen: Er bleibt
       stehen, bis #chkCircleKeyDone bestaetigt ist. Unbedingtes Verbergen
       raeumte ihn beim naechstbesten Zeichnen weg — etwa beim Sprachwechsel
       oder sobald der erste Freund aufgenommen wird. */
    renderKreisListe();
    renderKreisChecked();
    /* Ohne diese beiden Zeilen zeigten der Einstellungen-Verweis und die Wege
       zu den eigenen Listen weiter auf die zuvor geoeffnete Liste. */
    updateSettingsLink();
    updateNav();
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
    foot.className = 'modal__foot';

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
    /* Die Klassenliste wird vollstaendig neu geschrieben, weil derselbe Knoten
       auch den Bearbeiten-Fuss traegt und dort in einer Reihe stehen soll. */
    foot.className = 'modal__foot modal__foot--stack';
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
    var hatteClose = !!dialog.close;
    if (hatteClose) { dialog.close(); } else { dialog.removeAttribute('open'); }
    modalItemId = null;
    /* Ohne dialog.close() feuert kein close-Ereignis; dann holt dieser Weg
       die aufgeschobene Feier nach. Zweimal schadet nicht, die Warteschlange
       leert sich beim ersten Mal. */
    if (!hatteClose) { feierNachholen(); }
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
    var phone = (state.doc.contact.phone || '').trim();

    /* Hat die Besitzerin eine Adresse hinterlegt, ist das ihr Weg, und der
       traegt deshalb die Flaeche. Danach kommt das Telefon, zuletzt die
       Weitergabe des Geraets. Genau einer fuehrt. */
    if (email) {
      var mail = el('a', 'btn btn--primary');
      /* Das @ bleibt stehen. encodeURIComponent macht daraus %40, und nach
         RFC 6068 wird die Adresse vor dem Zerlegen nicht entschluesselt: Ein
         addr-spec ohne @ ist keiner. Die meisten Programme kommen damit
         zurecht, manche nicht, und der Preis dafuer waere eine Anfrage, die
         nirgends ankommt. Alles Uebrige bleibt maskiert. */
      mail.href = 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      mail.rel = 'noopener';
      mail.appendChild(icon('mail'));
      mail.appendChild(el('span', null, t('request.mail')));
      nodes.push(mail);
    }

    if (phone) {
      /* tel: nimmt keine Leerzeichen und keine Klammern. Was die Besitzerin
         schreibt, bleibt sichtbar; gewaehlt wird die bereinigte Fassung.
         Der geklammerte Teil faellt ganz weg und nicht nur die Klammern:
         "+49 (0) 221 …" ist die uebliche deutsche Schreibweise, und die Null
         darin gilt genau dann nicht, wenn die Landesvorwahl davorsteht.
         Bliebe sie stehen, waehlte das Telefon eine Nummer, die es nicht
         gibt. */
      var call = el('a', email ? 'btn' : 'btn btn--primary');
      call.href = 'tel:' + phone.replace(/\([^)]*\)/g, '').replace(/[^\d+]/g, '');
      call.rel = 'noopener';
      call.appendChild(icon('phone'));
      call.appendChild(el('span', null, t('request.call')));
      nodes.push(call);
    }

    if (canShare()) {
      var share = el('button', (email || phone) ? 'btn' : 'btn btn--primary');
      share.type = 'button';
      share.appendChild(icon('share'));
      share.appendChild(el('span', null, t('request.share')));
      share.addEventListener('click', function () {
        /* Das Ergebnis wurde bisher weggeworfen. Nach einer Weitergabe hat
           das Fenster seinen Zweck erfuellt: Es geht zu, und die Meldung
           bestaetigt. Sie kaeme hinter dem offenen Fenster sonst gar nicht
           zum Vorschein, denn ein <dialog> liegt in der obersten Ebene.
           Ein Abbruch bleibt still und laesst alles stehen. */
        nativeShare({ text: body }).then(function (ok) {
          if (!ok) { return; }
          closeItemModal();
          toast(t('request.shared'));
        });
      });
      nodes.push(share);
    } else if (!email && !phone) {
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

  /** Faerbt ein Pflichtfeld, meldet den Grund und setzt den Schreibzeiger
      hinein. Die Markierung faellt beim naechsten Tippen von selbst weg. */
  function bemaengeln(feld, text) {
    if (!feld) { return; }
    feld.setAttribute('aria-invalid', 'true');
    feld.classList.add('is-leer');
    feld.focus();
    toast(text, null, 'face-schreck');
    var frei = function () {
      feld.removeAttribute('aria-invalid');
      feld.classList.remove('is-leer');
      feld.removeEventListener('input', frei);
    };
    feld.addEventListener('input', frei);
  }

  function addItem(name, note) {
    name = (name || '').trim();
    if (!name) { bemaengeln($('#addName'), t('add.emptyWarn')); return; }
    var neu = {
      id: randomHex(6),
      name: name.slice(0, 120),
      note: (note || '').trim().slice(0, 200),
      status: 'available',
      borrower: '',
      since: ''
    };
    state.doc.items.unshift(neu);
    touch();
    render();
    feierAdd(neu.id, neu.name);
  }

  function findItem(id) {
    for (var i = 0; i < state.doc.items.length; i++) {
      if (state.doc.items[i].id === id) { return state.doc.items[i]; }
    }
    return null;
  }

  /**
   * Der Zustandswechsel, und damit die halbe und die ganze Runde.
   *
   * Gezaehlt wird die Runde beim Zurueckkommen, nie beim Hinausgehen. Wer
   * binnen einer halben Minute wieder zurueckschaltet, hat sich verklickt:
   * Dann wird nichts gezaehlt, nichts gefeiert und die halbe Runde
   * zurueckgenommen.
   */
  function toggleItem(id) {
    var item = findItem(id);
    if (!item) { return; }
    var g = spielRead();
    var name = item.name;

    if (item.status === 'available') {
      item.status = 'lent';
      item.since = heuteIso();
      rausTs[id] = Date.now();
      touch();
      render();
      feierRaus(id, name);
      return;
    }

    /* Name und Dauer eine Zeile retten, bevor beides fort ist. Danach steht
       nichts mehr davon im Dokument, und das ist richtig so. */
    var wer = (item.borrower || '').trim();
    var dauer = tageSeit(item.since);
    var fehlklick = rausTs[id] && (Date.now() - rausTs[id]) < FEHLKLICK;
    delete rausTs[id];

    item.status = 'available';
    item.borrower = '';
    item.since = '';
    touch();
    render();

    if (fehlklick) {
      if (g.raus > 0) { g.raus -= 1; spielSave(); }
      return;
    }
    feierHeim(id, name, wer, dauer);
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

    /* Die neun Sekunden gehoeren dem Rueckweg und niemandem sonst: Solange
       die Meldung steht, schweigt jede Feier. */
    undoOffen = true;
    setTimeout(function () { undoOffen = false; }, UNDO_MS + 200);

    toast(t('item.deleted', { name: removed.name }), {
      label: t('item.undo'),
      run: function () {
        /* Nach einem Ortswechsel gibt es nichts mehr zurueckzunehmen:
           route() setzt state.doc auf null, bevor es die Startseite zeigt,
           und der Zugriff auf items warf dann unbehandelt. */
        if (state.mode !== 'edit' || !state.doc) { return; }
        /* Die Liste kann sich zwischenzeitlich geaendert haben; der Eintrag
           kehrt an seine alte Stelle zurueck, hoechstens ans Ende. */
        var at = Math.min(index, state.doc.items.length);
        state.doc.items.splice(at, 0, removed);
        touch();
        render();
        undoOffen = false;
        markRow(removed.id, 'lid-heim');
      }
    }, 'face-schreck');
  }


  /* ===================================================================== *
   * 9a · Das Spielerische
   *
   * Zwei Festlegungen tragen alles Weitere.
   *
   * Erstens wird nicht jede Handlung gefeiert, sondern jede Premiere:
   * `laut(n)` uebersetzt einen Zaehler in vier Lautstaerkestufen, von
   * Konfetti beim ersten Mal bis zur Marke, die beim fuenfzigsten nur noch
   * kippt. Die Dramaturgie steht damit an einer Stelle und nicht verteilt
   * ueber zwanzig Aufrufe.
   *
   * Zweitens wird nicht Besitz gezaehlt, sondern die vollendete Runde: Sie
   * wird beim Zurueckbekommen gebucht, nie beim Verleihen. Wer drei Dinge
   * hat, die staendig unterwegs sind, steht damit hoeher als jemand mit
   * vierzig Dingen im Schrank.
   *
   * Alles liegt im localStorage dieses Browsers. Nichts davon erreicht den
   * Server, das verschluesselte Dokument oder die Freunde — auf deren
   * Geraeten wird ueberhaupt nichts gezaehlt.
   * ===================================================================== */

  var LS_SPIEL = 'lid.spiel';
  var LS_TON   = 'lid.ton';
  var LS_RUHIG = 'lid.ruhig';

  var LANG_AUS   = 30;     // ab so vielen Tagen traegt die Marke das geduldige Gesicht
  var LANG_NOTIZ = 60;     // ab hier sagt die Anwendung einmal je Sitzung etwas
  var FEHLKLICK  = 30000;  // hin und binnen dieser Frist zurueck: zaehlt nicht
  var STUFEN     = [1, 3, 8, 16, 30, 55];
  var JUBILAEEN  = [10, 25, 50, 100];

  var spiel = null;        // zwischengehaltener Stand
  var spielOk = true;      // ob der letzte Schreibversuch getragen hat
  var rausTs = {};         // Gegenstand -> Zeitpunkt des Hinausgehens
  var undoOffen = false;   // laeuft gerade eine Meldung mit Rueckweg?
  var langGesagt = false;  // der Hinweis auf lange Ausgeliehenes, einmal je Sitzung

  function heuteIso() { return new Date().toISOString().slice(0, 10); }

  function spielLeer() {
    return { v: 1, dinge: 0, raus: 0, heim: 0, weiter: 0, listen: 0, tage: 0, stufe: 0, rot: {}, abz: {} };
  }

  function spielRead() {
    if (spiel) { return spiel; }
    var raw = null;
    try { raw = localStorage.getItem(LS_SPIEL); } catch (e) { spielOk = false; }
    var got = null;
    if (raw) { try { got = JSON.parse(raw); } catch (e) { got = null; } }
    spiel = spielLeer();
    if (got && typeof got === 'object') {
      ['dinge', 'raus', 'heim', 'weiter', 'listen', 'tage', 'stufe'].forEach(function (k) {
        if (typeof got[k] === 'number' && got[k] >= 0) { spiel[k] = got[k]; }
      });
      if (got.rot && typeof got.rot === 'object') { spiel.rot = got.rot; }
      if (got.abz && typeof got.abz === 'object') { spiel.abz = got.abz; }
    }
    return spiel;
  }

  /**
   * Schreibt den Stand zurueck. Im Vorschaumodus teilt sich das Gedaechtnis
   * den Speicher mit den Listen selbst; der Platz kann also spaeter ausgehen,
   * nicht nur beim Start. Deshalb wird bei jedem Schreiben neu geurteilt und
   * das Ergebnis nicht ein fuer alle Mal gemerkt.
   */
  function spielSave() {
    try {
      localStorage.setItem(LS_SPIEL, JSON.stringify(spielRead()));
      spielOk = true;
    } catch (e) {
      spielOk = false;
    }
    return spielOk;
  }

  /** Ohne tragfaehigen Speicher wird weiter reagiert, aber kein Gedaechtnis
      versprochen: kein Chip, kein Rundenbuch, keine Stufen. */
  function spielWorks() { return spielOk; }

  /** Reihum durch einen Satzvorrat, damit sich keiner wiederholt, bevor alle
      an der Reihe waren. */
  function reihum(key, n) {
    var g = spielRead();
    var i = (g.rot[key] || 0) % n;
    g.rot[key] = (i + 1) % n;
    spielSave();
    return i + 1;
  }

  /** Tage seit einem Datum. Null, wenn keines gesetzt ist; nie negativ, denn
      das Feld laesst sich von Hand auch in die Zukunft setzen. */
  function tageSeit(iso) {
    if (!iso) { return null; }
    var t0 = Date.parse(iso + 'T00:00:00');
    if (isNaN(t0)) { return null; }
    var d = Math.floor((Date.now() - t0) / 86400000);
    return d < 0 ? 0 : d;
  }

  function ruhig() {
    /* Die Systemvorgabe zuerst. Wer sie nicht gesetzt hat, aber trotzdem auf
       Bewegung reagiert, braucht einen Schalter in der Anwendung selbst — fuer
       die Toene, die weit weniger stoeren, gibt es laengst einen. */
    try { if (localStorage.getItem(LS_RUHIG) === '1') { return true; } }
    catch (e) { /* privater Modus: dann eben nur die Systemvorgabe */ }
    return typeof window.matchMedia === 'function' &&
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* -- Der Lautstaerkeregler ---------------------------------------------- */

  /**
   * Vier Stufen aus einem Zaehler.
   *   4 · Konfetti, Klappe, Meldung, Ton
   *   3 · Klappe und Meldung
   *   2 · Meldung mit Gesicht und die Bewegung an der Zeile
   *   1 · nur die Bewegung, kein Wort
   */
  function laut(n) {
    if (n <= 0) { return 0; }
    if (n === 1) { return 4; }
    if (JUBILAEEN.indexOf(n) !== -1) { return 4; }
    if (n > 100 && n % 100 === 0) { return 4; }
    if (n <= 3) { return 3; }
    if (n <= 9) { return 2; }
    return 1;
  }

  /* -- Die drei Kanaele --------------------------------------------------- */

  var klappeTimer = null;

  /** Der Bildkanal. Er zeigt und spricht nicht: toast() haelt genau eine
      Meldung, und ein zweiter sprechender Bereich waere einer zu viel. */
  function klappe(gesicht, text) {
    var box = $('#klappe');
    if (!box) { return; }
    var use = $('#klappeUse');
    if (use) { use.setAttribute('href', '#i-face-' + gesicht); }
    $('#klappeText').textContent = text;
    box.classList.toggle('klappe--jubel', gesicht === 'jubel' || gesicht === 'heim');
    box.hidden = false;
    /* Neustart der Einfahrt erzwingen, ohne eingebettete Stile zu setzen —
       die verwirft die Richtlinie dieser Seite stillschweigend. */
    box.classList.remove('is-an');
    void box.offsetWidth;
    box.classList.add('is-an');
    clearTimeout(klappeTimer);
    klappeTimer = setTimeout(function () {
      box.hidden = true;
      box.classList.remove('is-an');
    }, 1600);
  }

  /**
   * Achtzehn Schnipsel, als vorbereitete Regeln im Stilblatt. Der Grundzustand
   * ist unsichtbar; wer Bewegung abbestellt hat, sieht deshalb nichts, ohne
   * dass hier eine Abfrage noetig waere. Die Ebene wird nach der Feier wieder
   * entfernt und liegt nicht dauerhaft ueber der Seite.
   */
  function konfetti() {
    if (ruhig()) { return; }
    var alt = document.getElementById('konfetti');
    if (alt && alt.parentNode) { alt.parentNode.removeChild(alt); }
    var box = el('div', 'konfetti');
    box.id = 'konfetti';
    box.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 18; i++) { box.appendChild(document.createElement('i')); }
    document.body.appendChild(box);
    setTimeout(function () {
      if (box.parentNode) { box.parentNode.removeChild(box); }
    }, 1900);
  }

  /** Bewegung an einer einzelnen Zeile. Sie wird nach dem Zeichnen gesetzt,
      denn renderItems() baut die Liste jedes Mal neu auf. */
  function markRow(id, art) {
    if (ruhig()) { return; }
    var row = document.querySelector('.item[data-id="' + id + '"]');
    if (!row) { return; }
    row.classList.add(art);
    setTimeout(function () { row.classList.remove(art); }, 700);
  }

  /* -- Die Toene ---------------------------------------------------------- */

  var audioCtx = null;

  var TOENE = {
    plopp: [{ f: 660, bis: 880, ms: 90,  ab: 0 }],
    weg:   [{ f: 392, ms: 120, ab: 0 }],
    heim:  [{ f: 587, ms: 90,  ab: 0 }, { f: 880, ms: 90, ab: 110 }],
    tada:  [{ f: 523, ms: 80,  ab: 0 }, { f: 659, ms: 80, ab: 80 }, { f: 784, ms: 110, ab: 160 }]
  };

  function tonAn() {
    try { return localStorage.getItem(LS_TON) === '1'; } catch (e) { return false; }
  }

  /**
   * Klang ohne eine einzige Datei. Der Richtlinie dieser Seite fehlt
   * media-src, es greift default-src 'self', und data: ist allein fuer Bilder
   * freigegeben — eine Tondatei waere also entweder neuer Ballast im
   * Verzeichnis oder schlicht blockiert. Ein Oszillator an einem Verstaerker
   * faellt gar nicht erst unter die Richtlinie.
   *
   * Die Huellkurve ist der ganze Unterschied zwischen weich und knackend:
   * ohne den kurzen Anstieg klickt jeder Ton hoerbar, ohne den exponentiellen
   * Abfall bricht er ab, statt zu verklingen.
   */
  function ton(name) {
    if (!tonAn()) { return; }
    var seq = TOENE[name];
    if (!seq) { return; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return; }
      if (!audioCtx) { audioCtx = new AC(); }
      if (audioCtx.state === 'suspended' && audioCtx.resume) { audioCtx.resume(); }
      var t0 = audioCtx.currentTime;
      seq.forEach(function (s) {
        var start = t0 + s.ab / 1000;
        var dauer = s.ms / 1000;
        var osc = audioCtx.createOscillator();
        var amp = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(s.f, start);
        if (s.bis) { osc.frequency.linearRampToValueAtTime(s.bis, start + dauer); }
        amp.gain.setValueAtTime(0, start);
        amp.gain.linearRampToValueAtTime(0.07, start + 0.008);
        amp.gain.exponentialRampToValueAtTime(0.0001, start + dauer);
        osc.connect(amp);
        amp.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + dauer + 0.02);
      });
    } catch (e) { /* kein Ton ist kein Fehler */ }
  }

  /* -- Die Feier ---------------------------------------------------------- */

  var feierWartet = null;

  /**
   * Die einzige Tuer. Alles Laute geht hier hindurch, damit es genau eine
   * Stelle gibt, an der die Sperren sitzen:
   *
   * - Nur im Bearbeiten-Modus. Auf dem Geraet eines Freundes wird nicht
   *   gefeiert und nichts gezaehlt; er hat nichts geleistet, er ist
   *   eingeladen.
   * - Nie ueber einer offenen Meldung mit Rueckweg. Die neun Sekunden nach
   *   einem Loeschen gehoeren dem Rueckgaengig und niemandem sonst.
   */
  function feier(o) {
    if (state.mode !== 'edit') { return; }
    if (undoOffen) { return; }
    var stufe = o.stufe || 0;
    if (stufe <= 0) { return; }
    if (stufe >= 4) { konfetti(); }
    if (stufe >= 3 && o.klappe) { klappe(o.gesicht || 'jubel', o.klappe); }
    if (stufe >= 2 && o.toast) { toast(o.toast); }
    if (stufe >= 4 || (stufe >= 2 && o.tonImmer)) { ton(o.ton || 'tada'); }
  }

  /**
   * Das Umschalten frei/verliehen ist ausschliesslich aus dem geoeffneten
   * Fenster erreichbar, und ein mit showModal() geoeffnetes Fenster liegt
   * ueber allem — Klappe, Meldung und Konfetti waeren dahinter unsichtbar.
   * Die Feier wartet deshalb, bis das Fenster zu ist.
   */
  function feierSpaeter(o) {
    var dialog = $('#itemModal');
    if (!dialog || !dialog.open) { feier(o); if (o.zeile) { markRow(o.zeile.id, o.zeile.art); } return; }
    feierWartet = o;
  }

  function feierNachholen() {
    var o = feierWartet;
    feierWartet = null;
    if (!o) { return; }
    setTimeout(function () {
      if (o.zeile) { markRow(o.zeile.id, o.zeile.art); }
      feier(o);
    }, 140);
  }

  /* -- Stufen und Abzeichen ----------------------------------------------- */

  function stufeFuer(heim) {
    var n = 0;
    for (var i = 0; i < STUFEN.length; i++) { if (heim >= STUFEN[i]) { n = i + 1; } }
    return n;
  }

  /**
   * Die zehn Abzeichen, in der Reihenfolge ihrer Bedeutung. Geprueft wird auf
   * Erreichen, nicht auf Gleichheit: Die Spracheingabe traegt mehrere
   * Gegenstaende in einem Rutsch ein, ein Zaehler springt dann von 0 auf 12,
   * und ein Abzeichen an der Schwelle 10 fiele bei einer Gleichheitspruefung
   * nie.
   *
   * Es wird hoechstens eines je Handlung verliehen. Was noch offen ist,
   * kommt beim naechsten Mal — das ist zugleich die bessere Dramaturgie, denn
   * zwei Feiern uebereinander sind keine zwei Feiern.
   */
  var ABZEICHEN = [
    { k: 'heimkehr',   z: 'handover',  p: function (g, c) { return g.heim >= 1; } },
    { k: 'bumerang',   z: 'face-heim', p: function (g, c) { return g.heim >= 10; } },
    { k: 'langeratem', z: 'clock',     p: function (g, c) { return c.dauer !== null && c.dauer !== undefined && c.dauer >= 30; } },
    { k: 'tagesflug',  z: 'refresh',   p: function (g, c) { return c.dauer === 0; } },
    { k: 'allesda',    z: 'check',     p: function (g, c) { return c.zurueck && g.heim >= 3 && !offeneLeihen(); } },
    { k: 'kleinfein',  z: 'face-frei', p: function (g, c) { return g.heim >= 3 && state.doc && state.doc.items.length > 0 && state.doc.items.length <= 5; } },
    { k: 'aushaus',    z: 'out',       p: function (g, c) { return g.raus >= 1; } },
    { k: 'tueroeffner', z: 'share',    p: function (g, c) { return g.weiter >= 1; } },
    { k: 'schluessel', z: 'key',       p: function (g, c) { return g.listen >= 1; } },
    { k: 'erster',     z: 'plus',      p: function (g, c) { return g.dinge >= 1; } },
    { k: 'sortiment',  z: 'list',      p: function (g, c) { return g.dinge >= 10; } }
  ];

  function offeneLeihen() {
    if (!state.doc) { return false; }
    return state.doc.items.some(function (it) { return it.status === 'lent'; });
  }

  /**
   * Verleiht hoechstens ein Abzeichen und meldet, ob es eines war. Die
   * Aufrufstellen fragen das ab: Traegt ein Abzeichen bereits die Feier,
   * bleibt die gewoehnliche aus.
   *
   * @param {{dauer: (number|null), zurueck: boolean, stumm: boolean}=} ctx
   * @return {boolean}
   */
  function pruefeAbzeichen(ctx) {
    if (state.mode !== 'edit') { return false; }
    var c = ctx || {};
    var g = spielRead();
    for (var i = 0; i < ABZEICHEN.length; i++) {
      var a = ABZEICHEN[i];
      if (g.abz[a.k]) { continue; }
      if (!a.p(g, c)) { continue; }
      g.abz[a.k] = heuteIso();
      spielSave();
      feierSpaeter({
        stufe: 4,
        gesicht: 'jubel',
        klappe: t('spiel.badge', { name: t('abz.' + a.k) }),
        /* Hat der Augenblick einen eigenen Satz — den Namen des Gegenstands,
           den der Zurueckbringerin —, gehoert der in die Meldung. Der Text
           des Abzeichens spricht nur, wenn sonst niemand spricht. */
        toast: c.stumm ? '' : (c.toast || t('abz.' + a.k + '.text')),
        ton: 'tada',
        zeile: c.zeile
      });
      return true;
    }
    return false;
  }

  /**
   * Der Aufstieg. `g.stufe` haelt fest, bis wohin gefeiert wurde, nicht
   * welche Stufe gilt — die rechnet sich jederzeit aus den Runden. So geht
   * kein Aufstieg verloren, wenn im selben Augenblick ein Abzeichen faellt.
   */
  function pruefeStufe(ctx) {
    if (state.mode !== 'edit') { return false; }
    var g = spielRead();
    var s = stufeFuer(g.heim);
    if (s <= g.stufe) { return false; }
    g.stufe = s;
    spielSave();
    feierSpaeter({
      stufe: 4,
      gesicht: 'heim',
      klappe: t('spiel.level', { n: s, name: t('stufe.' + s) }),
      toast: (ctx && ctx.toast) || t('spiel.levelText', { n: g.heim }),
      ton: 'tada',
      zeile: ctx && ctx.zeile
    });
    return true;
  }

  /* -- Der Stufenchip und das Rundenbuch ---------------------------------- */

  function updateLevelChip() {
    var chip = $('#levelChip');
    if (!chip) { return; }
    var g = spielRead();
    var s = stufeFuer(g.heim);
    var zeigen = state.mode === 'edit' && spielWorks() && s > 0;
    chip.hidden = !zeigen;
    if (!zeigen) { return; }
    chip.textContent = '';
    chip.appendChild(icon('face-heim'));
    chip.appendChild(el('span', null, t('stufe.' + s)));
    chip.setAttribute('aria-label', t('buch.open', { name: t('stufe.' + s) }));
  }

  /**
   * Das Rundenbuch nutzt dasselbe Fenster wie ein Gegenstand. Dessen
   * Beschriftung fuer die Vorlesestimme traegt sonst noch den Namen des
   * zuletzt geoeffneten Dings; sie wird deshalb ausdruecklich gesetzt.
   */
  function openRundenbuch() {
    var g = spielRead();
    var s = stufeFuer(g.heim);
    modalItemId = null;

    var dialog = $('#itemModal');
    var head = $('#modalTitle');
    head.textContent = '';
    head.appendChild(el('span', 'buch-stufe', s > 0 ? t('stufe.' + s) : t('buch.none')));
    dialog.setAttribute('aria-label', t('buch.title'));

    var body = $('#modalBody');
    body.textContent = '';

    var zahlen = el('div', 'buch-zahlen');
    [['dinge', state.doc ? state.doc.items.length : 0],
     ['unterwegs', Math.max(0, g.raus - g.heim)],
     ['runden', g.heim],
     ['weiter', g.weiter]].forEach(function (paar) {
      var z = el('div', 'buch-zahl');
      z.appendChild(el('b', null, String(paar[1])));
      z.appendChild(el('span', null, t('buch.' + paar[0])));
      zahlen.appendChild(z);
    });
    body.appendChild(zahlen);

    var liste = el('div', 'buch-liste');
    var verliehen = 0;
    ABZEICHEN.forEach(function (a) {
      if (!g.abz[a.k]) { return; }
      verliehen++;
      var row = el('div', 'buch-abz');
      var badge = el('span', 'item-badge');
      badge.appendChild(icon(a.z));
      row.appendChild(badge);
      var txt = el('div');
      txt.appendChild(el('b', null, t('abz.' + a.k)));
      txt.appendChild(el('span', null, t('abz.' + a.k + '.text')));
      txt.appendChild(el('span', null, formatDay(g.abz[a.k])));
      row.appendChild(txt);
      liste.appendChild(row);
    });
    body.appendChild(liste);

    var offen = ABZEICHEN.length - verliehen;
    body.appendChild(el('p', 'hint spaced-lg',
      verliehen === 0 ? t('buch.first') : t('buch.rest', { n: offen })));
    body.appendChild(el('p', 'hint', t('buch.local')));

    var foot = $('#modalFoot');
    foot.textContent = '';
    /* Wie in den beiden anderen Fuessen die Klassenliste vollstaendig neu:
       Der Knoten ist derselbe, und ohne diese Zeile erbte das Rundenbuch das
       gestapelte Aussehen der Anfrage. */
    foot.className = 'modal__foot';
    foot.appendChild(el('span', 'spacer'));
    var close = el('button', 'btn btn--primary');
    close.type = 'button';
    close.textContent = t('modal.done');
    close.addEventListener('click', closeItemModal);
    foot.appendChild(close);

    openDialog();
  }

  /* -- Die Saetze --------------------------------------------------------- */

  /**
   * Sondersaetze nach Stichwort. Geprueft wird streng auf das erste Wort und
   * auf Wortgrenzen: „Zeltheringe" darf nicht den Wochenend-Satz bekommen.
   * Beide Sprachen stehen nebeneinander, weil der Katalog zweisprachig ist
   * und jemand mit englischer Oberflaeche englische Namen eintraegt.
   */
  var SONDER = [
    { k: 'bohr',   w: ['bohrmaschine', 'cordless drill', 'drill', 'akkuschrauber', 'power screwdriver'] },
    { k: 'waffel', w: ['waffeleisen', 'waffle iron'] },
    { k: 'zelt',   w: ['zelt', 'tent'] },
    { k: 'leiter', w: ['leiter', 'ladder'] },
    { k: 'brett',  w: ['brettspiel', 'board game'] },
    { k: 'beamer', w: ['beamer', 'projektor', 'projector'] },
    { k: 'rasen',  w: ['rasenmäher', 'rasenmaeher', 'lawn mower'] }
  ];

  function sonderSatz(name) {
    var n = String(name || '').toLowerCase().trim();
    if (!n) { return null; }
    for (var i = 0; i < SONDER.length; i++) {
      for (var j = 0; j < SONDER[i].w.length; j++) {
        var w = SONDER[i].w[j];
        if (n === w || n.indexOf(w + ' ') === 0) { return t('sonder.' + SONDER[i].k); }
      }
    }
    return null;
  }

  /* -- Die vier Momente --------------------------------------------------- */

  /** Gegenstand eingetragen. Der haeufigste Weg der ganzen Anwendung, und
      deshalb der, an dem die Abnutzungskurve am steilsten faellt. */
  function feierAdd(id, name) {
    var g = spielRead();
    g.dinge += 1;
    spielSave();
    markRow(id, 'lid-fall');
    var n = g.dinge;
    var stufe = laut(n);

    /* Der Satz zum Gegenstand steht fest, bevor ueber das Abzeichen
       entschieden wird: Faellt eines, nimmt es die Klappe und laesst dem
       Satz die Meldung. */
    var sText = sonderSatz(name);
    if (!sText) {
      if (n === 25) { sText = t('add.s25', { name: name }); }
      else { sText = t('add.s' + reihum('add', 6), { name: name }); }
    }
    if (pruefeAbzeichen({ toast: sText })) { return; }
    if (stufe <= 1) { markRow(id, 'lid-kipp'); return; }
    var kText = '';
    if (n <= 3) { kText = t('add.k' + n); }
    else if (n === 25) { kText = t('add.k25'); }
    feier({ stufe: stufe, gesicht: 'frei', klappe: kText, toast: sText, ton: 'plopp', tonImmer: true });
  }

  /** Hinaus. Bewusst leiser als die Heimkehr: Verleihen ist ein Vorgang,
      kein Sieg — und wer hier das Konfetti verschiesst, hat fuer den
      eigentlichen Hoehepunkt nichts mehr uebrig. */
  function feierRaus(id, name) {
    var g = spielRead();
    g.raus += 1;
    spielSave();
    var zeile = { id: id, art: 'lid-raus' };
    var n = g.raus;
    var stufe = laut(n);
    var sText = n === 1 ? t('raus.s1', { name: name })
                        : t('raus.s' + reihum('raus', 4), { name: name });
    if (pruefeAbzeichen({ zeile: zeile, toast: sText })) { return; }
    if (stufe <= 1) { feierSpaeter({ stufe: 0, zeile: zeile }); return; }
    feierSpaeter({
      stufe: stufe,
      gesicht: 'weg',
      klappe: n === 1 ? t('raus.k1') : t('raus.k2'),
      toast: sText,
      ton: 'weg',
      tonImmer: true,
      zeile: zeile
    });
  }

  /**
   * Die Heimkehr. Der Zweck der ganzen Anwendung, bisher die stummste Stelle
   * darin — und der einzige Augenblick, in dem ein zweiter Mensch vorkommt.
   * Sein Name wird genau dann genannt, wenn der Code ihn loescht: Die
   * Anwendung fuehrt keine Akte ueber Freunde, sie sagt einmal, wer es war,
   * und vergisst es dann.
   */
  function feierHeim(id, name, wer, dauer) {
    var g = spielRead();
    g.heim += 1;
    if (typeof dauer === 'number') { g.tage += dauer; }
    spielSave();
    var zeile = { id: id, art: 'lid-heim' };

    /* Die Rueckkehr faellt als einzige Handlung nie unter Stufe 2. */
    var stufe = Math.max(2, laut(g.heim));
    var satz;
    if (stufe <= 2 && g.heim > 9) {
      satz = t('heim.sKurz', { name: name });
    } else if (wer && dauer === 0) {
      satz = t('heim.sHeute', { who: wer, name: name });
    } else if (wer && typeof dauer === 'number') {
      satz = t('heim.sWer', { who: wer, name: name, n: dauer });
    } else if (typeof dauer === 'number') {
      satz = t('heim.sTage', { name: name, n: dauer });
    } else {
      satz = t('heim.sPlain', { name: name });
    }

    var ctx = { dauer: dauer, zurueck: true, zeile: zeile, toast: satz };
    if (pruefeAbzeichen(ctx)) { return; }
    if (pruefeStufe(ctx)) { return; }

    feierSpaeter({
      stufe: stufe,
      gesicht: 'heim',
      klappe: t('heim.k'),
      toast: satz,
      ton: 'heim',
      tonImmer: true,
      zeile: zeile
    });
  }

  /** Der Link geht hinaus. Gefeiert wird nur, was wirklich weitergegeben
      wurde — ein abgebrochenes Teilen bleibt stumm, und der Bearbeiten-Link
      zaehlt nie mit: Er ist der geheime. */
  function feierWeiter() {
    if (state.mode !== 'edit') { return; }
    var g = spielRead();
    g.weiter += 1;
    spielSave();
    if (pruefeAbzeichen({})) { return; }
    var n = g.weiter;
    var stufe = laut(n);
    if (stufe <= 1) { return; }
    feier({
      stufe: stufe,
      gesicht: 'zwink',
      klappe: n <= 3 ? t('weiter.k2') : '',
      toast: n <= 3 ? t('weiter.s2') : t('weiter.s3'),
      ton: 'tada'
    });
  }

  /** Der Zugang ist gesichert: der Abschluss des Anlegens und die Stelle,
      an der die Liste wirklich in die Hand uebergeht. */
  function feierZugang() {
    var g = spielRead();
    g.listen += 1;
    spielSave();
    if (pruefeAbzeichen({})) { return; }
    feier({ stufe: 4, gesicht: 'jubel', klappe: t('key.klappe'), toast: t('key.feier'), ton: 'tada' });
  }

  /** Einmal je Sitzung: Was sehr lange draussen ist, darf erwaehnt werden.
      Keine Mahnung, eine Auskunft. */
  function hinweisLangeDraussen() {
    if (langGesagt || state.mode !== 'edit' || !state.doc) { return; }
    var treffer = null;
    state.doc.items.forEach(function (it) {
      if (it.status !== 'lent') { return; }
      var d = tageSeit(it.since);
      if (d !== null && d >= LANG_NOTIZ && (!treffer || d > treffer.d)) { treffer = { name: it.name, d: d }; }
    });
    if (!treffer) { return; }
    langGesagt = true;
    setTimeout(function () {
      if (undoOffen) { return; }
      toast(t('item.longOut', { name: treffer.name, n: treffer.d }));
    }, 1200);
  }

  /* ===================================================================== *
   * 10 · Laden, Anlegen, Aktualisieren
   * ===================================================================== */

  /** Setzt beide Aufrufe der Startseite gemeinsam. */
  function createButtons(disabled, text) {
    $$('[data-create]').forEach(function (btn) {
      btn.disabled = disabled;
      btn.textContent = text;
    });
  }

  function createList() {
    var doc = emptyDoc();
    doc.title = t('list.newTitle');
    createListFrom(doc, t('start.creating'), null);
  }

  /**
   * Legt eine Liste aus einem fertigen Dokument an. Zwei Aufrufer: das leere
   * Anlegen von der Startseite und das Wiederherstellen aus einer Sicherung.
   * Beide bekommen neue Kennung, neuen Schluessel und neues Token — eine
   * Sicherung enthaelt keinen Zugang, sie enthaelt die Liste. Der Rueckgabewert
   * ist die Kette; sie ist auch im Fehlerfall erfuellt, weil das catch am
   * Ende die Meldung schon gezeigt hat.
   */
  function createListFrom(doc, warten, danach) {
    createButtons(true, warten);

    var id = randomHex(16);
    var token = randomToken(24);
    var keyRef = null;

    return Crypt.generateKey().then(function (key) {
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
        $('#chkKeyDone').checked = false;
        $('#keyBox').hidden = false;
        $('#keyRemember').hidden = !mineWorks();
        if (danach) { danach(); }
      });
    }).catch(function (err) {
      createButtons(false, t('start.create'));
      toast(t('error.' + (err && err.code ? err.code : 'network')));
    });
  }

  /* ------------------------------------------------------------------ *
   * Sichern und Wiederherstellen
   *
   * Die Datei ist Klartext und enthaelt keinen Link: Gegenstaende, Kontakt,
   * Stand. Sie ersetzt nicht den Zugang, sondern die Liste — wer beides
   * verliert, legt daraus auf der Startseite eine neue an, mit neuen Links.
   * Kein Schluessel und kein Token in der Datei, aus zwei Gruenden: Sie liegt
   * dort, wo der Browser sie ablegt, oft im Ordner fuer Downloads und oft in
   * einer Cloud-Synchronisation; und ein Zugang, der an zwei Orten liegt, ist
   * keiner mehr. Der Bearbeiten-Link hat seinen eigenen Kasten.
   *
   * Nur die Leihliste. Eine Superliste ist ein Buendel fremder Schluessel;
   * die im Klartext in eine Datei zu schreiben, entschiede ueber Dritte.
   * ------------------------------------------------------------------ */

  function sicherungsName(titel) {
    var slug = String(titel || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return 'leihliste-' + (slug || 'ohne-namen') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  }

  function sichereListe() {
    if (!state.doc || state.mode !== 'edit') { return; }
    var kopie = JSON.parse(JSON.stringify(state.doc));
    var datei = {
      leihichdir: 1,
      kind: 'list',
      exported: new Date().toISOString(),
      v: SCHEMA_VERSION,
      title: kopie.title,
      contact: kopie.contact,
      showBorrower: kopie.showBorrower,
      items: kopie.items
    };
    var blob = new Blob([JSON.stringify(datei, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url;
    a.download = sicherungsName(kopie.title);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Nicht sofort freigeben: Manche Browser lesen den Blob erst nach dem Klick. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stelleWiederHer(file) {
    var knopf = $('#btnRestore');
    var reader = new FileReader();
    reader.onload = function () {
      var raw = null;
      try { raw = JSON.parse(String(reader.result)); } catch (e) { raw = null; }
      /* Eine Sicherung ist ein Listendokument mit items. kindOf() haelt ein
         Superlisten-Dokument fern, das jemand von Hand hineingelegt hat. */
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || kindOf(raw) !== 'list') {
        toast(t('backup.badFile'));
        return;
      }
      if (knopf) { knopf.disabled = true; }
      createListFrom(normalizeAny(raw, 'list', null), t('backup.restoring'), function () {
        toast(t('backup.restored'));
      }).then(function () { if (knopf) { knopf.disabled = false; } });
    };
    reader.onerror = function () { toast(t('backup.badFile')); };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * Das Lebenszeichen
   *
   * purge.php loescht, was ein Jahr lang nicht *geschrieben* wurde. Lesen
   * zaehlt nicht, und der Server kann nicht zaehlen, was er nicht sieht. Eine
   * Liste, die taeglich angesehen, aber nie geaendert wird, verschwaende also
   * nach einem Jahr — und die Superliste, deren ganzer Gebrauch das Lesen
   * ist, erst recht. Deshalb schreibt der Browser beim Oeffnen mit Zugang das
   * Dokument unveraendert noch einmal, sobald der letzte Schreibvorgang
   * laenger als LEBENSZEICHEN_TAGE zurueckliegt.
   *
   * Nicht bei jedem Oeffnen: Das waere ein Schreibvorgang je Aufruf, und
   * "zuletzt gespeichert" hiesse nichts mehr. Nur mit Token: Wer nur ansieht,
   * kann nicht schreiben und soll es nicht — sonst hielte jeder Leser eine
   * fremde Liste am Leben, und die Frist waere keine.
   * ------------------------------------------------------------------ */

  function lebenszeichenFaellig(updated) {
    if (!updated) { return false; }
    return (Date.now() / 1000 - updated) > LEBENSZEICHEN_TAGE * 86400;
  }

  function lebenszeichen() {
    if (state.mode !== 'edit' || !state.token || !lebenszeichenFaellig(state.updated)) { return; }
    /* save() schreibt nur, was als geaendert gilt. Der Inhalt bleibt derselbe;
       geaendert ist die Aussage des Servers, wann zuletzt geschrieben wurde. */
    state.dirty = true;
    save();
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
      /* normalizeAny und nicht normalizeDoc: Ein #e= oder #v= auf ein
         Kreis-Dokument oeffnete sonst den Kreis als leere Liste, und der
         erste Tastendruck im Titelfeld schriebe diese leere Fassung
         darueber. Die Art entscheidet der Aufrufer, nicht das Dokument. */
      state.doc = normalizeAny(raw, 'list', null);
      state.dirty = false;
      state.checkedAt = Date.now();
      if (state.mode === 'edit') { rememberList(); }
      render();
      if (state.mode === 'view') { startRefresh(); } else { stopRefresh(); }
      hinweisLangeDraussen();
      lebenszeichen();
    }).catch(function (err) {
      showError(err && err.code ? err.code : 'network');
    });
  }

  /* ===================================================================== *
   * 10a · Die Superliste
   *
   * Eine eigene Art Dokument hinter einem eigenen Fragmentpraefix. Der Server
   * unterscheidet sie nicht von einer Liste, und genau das ist die Zusage:
   * api.php bleibt unveraendert, es gibt keine neue Aktion und keine
   * Verknuepfung zwischen zwei Kennungen.
   *
   * ZUM NAMEN IM QUELLTEXT. Die Oberflaeche sagt "Superliste", der Quelltext
   * sagt an drei Stellen weiter "kreis" beziehungsweise "circle": das Objekt
   * mit dem Zustand, der Namensraum der Woerterbuecher und beide Formen, die
   * nach aussen gehen. Die letzten beiden sind nicht frei waehlbar:
   *   - das Fragmentpraefix #k=, das in jedem schon verschickten Link steht,
   *   - das Feld kind: 'circle' in jedem schon gespeicherten Dokument.
   * Beide zu aendern hiesse, bestehende Links und bestehende Dokumente
   * ungueltig zu machen; es gibt keinen Weg, das nachtraeglich zu reparieren,
   * denn der Server kann die Dokumente nicht lesen. Der Zustand und der
   * Namensraum heissen deshalb aus einem Stueck weiter so wie die Form, an
   * die sie gebunden sind, und nicht halb so und halb anders.
   * ===================================================================== */

  /**
   * Liest das Kreis-Dokument und legt es in kreis ab. Zeichnet nicht, holt
   * keine Freundesliste und fasst state nicht an: So kann auch der Knopf in
   * einer fremden Liste schreiben, ohne die Ansicht darunter wegzuziehen.
   * Der Aufrufer prueft gen selbst, bevor er etwas anzeigt.
   */
  function kreisHolen(parsed, gen) {
    return Crypt.importKey(parsed.key).then(function (key) {
      if (gen !== kreisGen) { return null; }
      kreis.key = key;
      kreis.keyStr = parsed.key;
      kreis.id = parsed.id;
      kreis.token = parsed.token;
      return Crypt.proof(parsed.token);
    }).then(function (proof) {
      if (gen !== kreisGen) { return null; }
      kreis.proof = proof;
      return Store.read(kreis.id, 0);
    }).then(function (res) {
      if (gen !== kreisGen) { return null; }
      if (res.status === 404) { throw new AppError('notfound'); }
      if (res.status !== 200) { throw new AppError(mapError(res)); }
      kreis.rev = res.body.rev;
      kreis.updated = res.body.updated;
      return Crypt.decrypt(kreis.key, res.body.payload, kreis.id);
    }).then(function (raw) {
      if (gen !== kreisGen) { return null; }
      kreis.doc = normalizeAny(raw, 'circle', kreis.id);
      return kreis.doc;
    });
  }

  function oeffneKreis(parsed) {
    var gen = ++kreisGen;
    stopRefresh();   /* Die Uebersicht haelt sich nicht selbst aktuell. */
    state.mode = 'circle';
    state.doc = null;     /* Kein Fremddokument in state, nie. */
    /* Erst die offene Frist einloesen, dann lesen — und darauf warten. Der
       Aktualisieren-Knopf geht nicht ueber showView, kreisRaeumen laeuft also
       nicht: Ohne diese Zeile stuende ein eben entfernter Freund im frisch
       geholten Dokument wieder da, und der spaete Schreibvorgang traefe auf
       eine Revision, die er nicht kennt. */
    return kreisFristEinloesen().then(function () {
      return kreisHolen(parsed, gen);
    }).then(function (doc) {
      if (gen !== kreisGen || !doc) { return; }
      rememberList();
      /* Die Eintraege stehen vollstaendig, bevor der erste Abruf laeuft.
         ladeKreis fuellt genau diese Objekte, deshalb gibt es am Ende nichts
         zuzuweisen — und ein waehrend des Ladens aufgenommener Freund geht
         nicht mehr verloren, wie es die frühere Zuweisung verursachte. */
      kreis.eintraege = kreisEintraege(doc.friends.slice(0, MAX_FRIENDS));
      renderKreis();
      return ladeKreis(kreis.eintraege, function () {
        if (gen !== kreisGen) { return; }
        renderKreisListe();
      }).then(function () {
        if (gen !== kreisGen) { return; }
        kreis.geprueftAm = Date.now();
        renderKreis();
        /* Erst hier und nicht vor dem Holen: So liegt zwischen Lebenszeichen
           und dem ersten moeglichen Aufnehmen nicht noch die ganze Ladezeit,
           in der beide Schreibvorgaenge sich um dieselbe Revision straeuben
           koennten. Ganz ausschliessen laesst sich das nicht — einmal in
           dreissig Tagen, im Fenster eines Schreibvorgangs; kreisSave meldet
           den Konflikt, und das Aufnehmen laesst sich wiederholen. */
        kreisLebenszeichen();
      });
    }).catch(function (err) {
      if (gen !== kreisGen) { return; }
      showError(err && err.code ? err.code : 'network');
    });
  }

  /**
   * Holt die Listen der Freunde: vier gleichzeitig, nachrueckend.
   *
   * Nicht seriell, weil apiGet kein Zeitlimit und kein Abbruchsignal kennt —
   * ein haengender Abruf hielte alle uebrigen unbegrenzt auf. Nicht alle auf
   * einmal, weil jeder Lesevorgang drueben einen eigenen PHP-Prozess belegt
   * und Lesen ungedrosselt ist: throttle() steht in api.php nur bei create
   * und ai, der Server kann sich also nicht wehren, die Schranke muss hier
   * stehen. Vier ist kein gemessener Wert, sondern die Groessenordnung, die
   * ein einzelner Reiter einem geteilten Host zumuten darf.
   */
  /** Die leeren Eintraege, bevor irgendetwas geholt ist. Sie entstehen
      getrennt vom Holen, damit der Aufrufer sie sofort in kreis.eintraege
      legen kann: Dann steht die Reihenfolge fest, ein waehrenddessen
      aufgenommener Freund kann keinen Platz ueberschreiben, und der
      Aufklapper zeigt von Anfang an, worauf gewartet wird. */
  function kreisEintraege(freunde) {
    return freunde.map(function (f) {
      return { freund: f, doc: null, fehler: null, status: 0, langsam: false };
    });
  }

  function ladeKreis(eintraege, fortschritt) {
    var naechster = 0;

    function holen(pos) {
      var e = eintraege[pos];
      var uhr = setTimeout(function () {
        e.langsam = true;
        if (fortschritt) { fortschritt(e, pos); }
      }, KREIS_LANGSAM);

      /* Promise.resolve().then davor: Alles ab hier liegt hinter einem
         Promise, auch ein synchroner Wurf. Sonst traegt das catch unten
         nicht — und ein einziger Wurf risse die ganze Schleuse mit. */
      return Promise.resolve().then(function () {
        return Crypt.importKey(e.freund.key);
      }).then(function (key) {
        return Store.read(e.freund.id, 0).then(function (res) {
          e.status = res.status;
          if (res.status === 404) { throw new AppError('notfound'); }
          if (res.status !== 200) { throw new AppError(mapError(res)); }
          return Crypt.decrypt(key, res.body.payload, e.freund.id);
        });
      }).then(function (raw) {
        e.doc = normalizeAny(raw, 'list', null);
      }).catch(function (err) {
        e.fehler = (err && err.code) ? err.code : 'network';
      }).then(function () {
        clearTimeout(uhr);
        if (fortschritt) { fortschritt(e, pos); }
      });
    }

    function schleuse() {
      if (naechster >= eintraege.length) { return Promise.resolve(); }
      var pos = naechster++;
      return holen(pos).then(schleuse);
    }

    /* Weil das catch VOR dem abschliessenden then steht, kann holen() nie
       ablehnen, also schleuse() nie, also Promise.all nie. Diese Zusage haelt
       nur zusammen mit dem try/catch in Crypt.importKey. */
    var laeufer = [];
    var n = Math.min(KREIS_PAR, eintraege.length);
    for (var i = 0; i < n; i++) { laeufer.push(schleuse()); }
    return Promise.all(laeufer).then(function () { return eintraege; });
  }

  /* mapError wirft corrupt, busy, malformed und conflict alle auf 'network'.
     Fuer die Frage "nochmal versuchen?" ist das zu grob: Ein 500 corrupt
     aendert sich durch eine zweite Anfrage nicht. Deshalb entscheidet hier
     der Status, nicht der uebersetzte Code. */
  function kreisWiederholbar(e) {
    if (e.fehler !== 'network') { return false; }
    return !e.status || e.status === 0 || e.status >= 502;
  }

  /**
   * Schreibt den Kreis. Kein Aufschub wie SAVE_DEBOUNCE: Die Aenderungen hier
   * sind einzelne Ereignisse — aufnehmen, entfernen, den Titel verlassen.
   * Damit braucht der Kreis weder touch() noch scheduleSave() noch einen
   * Eintrag im beforeunload-Zuhoerer, und save() bleibt unberuehrt.
   */
  /** Das Lebenszeichen der Superliste; Begruendung bei lebenszeichen(). */
  function kreisLebenszeichen() {
    if (!kreis.doc || !kreis.token || !lebenszeichenFaellig(kreis.updated)) { return; }
    kreisSave();
  }

  function kreisSave() {
    if (!kreis.token || !kreis.doc) { return Promise.resolve(); }
    /* Alles, was der Schreibvorgang braucht, wird hier festgehalten und nicht
       spaeter aus kreis gelesen. Zwischen dem Verschluesseln und dem
       Schreiben liegt ein Promise, und in dieser Zeit kann kreisRaeumen die
       Felder geleert haben: Der Schreibvorgang ginge dann mit proof === null
       hinaus und brachte ein 403 zurueck. */
    var id = kreis.id, key = kreis.key, proof = kreis.proof, rev = kreis.rev;
    var snapshot = JSON.parse(JSON.stringify(kreis.doc));
    snapshot.v = SCHEMA_VERSION;
    snapshot.kind = 'circle';
    return Crypt.encrypt(key, snapshot, id).then(function (payload) {
      return Store.write(id, proof, rev, payload).then(function (res) {
        /* Bei Konflikt NICHT blind ueberschreiben wie save() es tut: Dort
           geht eine Aenderung an derselben Liste verloren, hier ginge der
           Ansehen-Link eines Freundes verloren, den es nur hier gab. Also
           lesen, ueber die IDs zusammenfuehren, dann schreiben. */
        if (res.status === 409 && res.body && typeof res.body.rev === 'number') {
          return kreisZusammenfuehren(res.body.rev);
        }
        return res;
      });
    }).then(function (res) {
      /* Die Revision nur zurueckschreiben, wenn noch derselbe Kreis offen
         ist. Sonst traegt ein spaet eintreffendes Ergebnis seine Zahl in ein
         fremdes Dokument. */
      if (res && res.status === 200) {
        if (kreis.id === id) { kreis.rev = res.body.rev; kreis.updated = res.body.updated; }
        return;
      }
      toast(t('error.' + mapError(res)));
    }).catch(function (err) {
      toast(t('error.' + (err && err.code ? err.code : 'network')));
    });
  }

  function kreisZusammenfuehren(serverRev) {
    return Store.read(kreis.id, 0).then(function (res) {
      if (res.status !== 200) { throw new AppError(mapError(res)); }
      return Crypt.decrypt(kreis.key, res.body.payload, kreis.id);
    }).then(function (raw) {
      var fremd = normalizeAny(raw, 'circle', kreis.id);
      var haben = {};
      kreis.doc.friends.forEach(function (f) { haben[f.id] = true; });
      fremd.friends.forEach(function (f) {
        if (!haben[f.id]) { kreis.doc.friends.push(f); }
      });
      kreis.rev = serverRev;
      var snap = JSON.parse(JSON.stringify(kreis.doc));
      snap.v = SCHEMA_VERSION;
      snap.kind = 'circle';
      return Crypt.encrypt(kreis.key, snap, kreis.id).then(function (p) {
        return Store.write(kreis.id, kreis.proof, kreis.rev, p);
      });
    });
  }

  /**
   * Nimmt, was der Nutzer eingefuegt hat, und behaelt davon nur id und key.
   * Ein versehentlich eingefuegter Bearbeiten-Link wird angenommen und dabei
   * abgewertet: Der dritte Teil faellt weg. Ein fremder Schreibzugang hat in
   * einer Superliste nichts zu suchen — und ihn abzulehnen hiesse, den
   * Nutzer den Link von Hand kuerzen zu lassen.
   * Ein Kreis-Link faellt schon am Praefix auf, vor jedem Netzzugriff. Eine
   * Ebene, klar benannt: Die Aufloesung waere unbegrenzt in Tiefe und
   * Anfragen und endlos bei einem Zyklus.
   */
  function parseFreundLink(text) {
    var p = null;
    try { p = parseFragment(text); } catch (e) { return { fehler: 'badlink' }; }
    if (!p) { return { fehler: 'badlink' }; }
    if (p.mode === 'circle') { return { fehler: 'nest' }; }
    return { id: p.id, key: p.key };
  }

  function circleAdd() {
    if (!kreis.doc || !kreis.token) { return; }
    var feld = $('#circleAddLink');
    var r = parseFreundLink(feld.value);
    if (r.fehler === 'nest') { toast(t('circle.nestAdd')); return; }
    if (r.fehler) { bemaengeln(feld, t('error.badlink')); return; }
    if (r.id === kreis.id) { toast(t('circle.selfAdd')); return; }
    var doppelt = kreis.doc.friends.some(function (f) { return f.id === r.id; });
    if (doppelt) { toast(t('circle.dupAdd')); return; }
    if (kreis.doc.friends.length >= MAX_FRIENDS) { toast(t('circle.full', { n: MAX_FRIENDS })); return; }

    var neuer = { id: r.id, key: r.key, label: $('#circleAddName').value.slice(0, 60) };
    kreis.doc.friends.push(neuer);
    feld.value = '';
    $('#circleAddName').value = '';
    kreisSave();
    /* Der Eintrag steht sofort in der Liste und traegt bis zur Antwort seinen
       Zustand. ladeKreis fuellt dasselbe Objekt, deshalb gibt es danach
       nichts einzusortieren. */
    var neu = kreisEintraege([neuer]);
    kreis.eintraege.push(neu[0]);
    renderKreisListe();
    var gen = kreisGen;
    /* Nur den neuen Eintrag holen, nicht alle: Der Rest steht schon. */
    ladeKreis(neu, null).then(function () {
      if (gen !== kreisGen) { return; }
      renderKreisListe();
    });
  }

  /**
   * Entfernen: Ruecknahme statt Rueckfrage, wie beim Gegenstand. Erst nach
   * Ablauf der Frist wird geschrieben — nicht speichern und dann
   * wiederherstellen, das waeren zwei Schreibvorgaenge je Zug und bei jedem
   * die Gefahr eines 409.
   */
  /* Die offene Frist des Entfernens. Sie steht hier und nicht in einer
     Abschlussvariablen, weil kreisRaeumen sie einloesen muss: Wer die
     Uebersicht innerhalb der neun Sekunden verlaesst, hat entfernt, und ohne
     diesen Weg bliebe der Schreibvorgang aus — kreisSave kehrt dann wegen des
     geleerten Tokens wirkungslos zurueck, und der Freund staende beim
     naechsten Oeffnen wieder da. */
  var kreisFrist = null;

  function kreisFristEinloesen() {
    if (!kreisFrist) { return Promise.resolve(); }
    clearTimeout(kreisFrist);
    kreisFrist = null;
    /* Die Ruecknahme ist damit vorbei. Eine Meldung, deren Knopf nichts mehr
       tut, ist schlimmer als keine. Zuerst wegnehmen, dann schreiben: Der
       Knopf soll nicht noch waehrend des Schreibens gedrueckt werden koennen. */
    toastSchliessen();
    return kreisSave();
  }

  function circleRemove(id) {
    if (!kreis.doc || !kreis.token) { return; }
    /* Steht noch eine Frist offen, wird sie zuerst eingeloest: Zwei
       Entfernungen kurz nacheinander duerfen sich nicht gegenseitig die
       Ruecknahme wegnehmen. */
    kreisFristEinloesen();
    var pos = -1, i;
    for (i = 0; i < kreis.doc.friends.length; i++) {
      if (kreis.doc.friends[i].id === id) { pos = i; break; }
    }
    if (pos < 0) { return; }
    var kreisId = kreis.id;
    var weg = kreis.doc.friends.splice(pos, 1)[0];
    var wegE = null;
    for (i = 0; i < kreis.eintraege.length; i++) {
      if (kreis.eintraege[i] && kreis.eintraege[i].freund.id === id) { wegE = kreis.eintraege.splice(i, 1)[0]; break; }
    }
    renderKreisListe();
    kreisFrist = setTimeout(function () {
      kreisFrist = null;
      kreisSave();
    }, UNDO_MS);
    toast(t('circle.removed'), {
      label: t('circle.undo'),
      run: function () {
        clearTimeout(kreisFrist);
        kreisFrist = null;
        /* Nach einem Ortswechsel gibt es nichts mehr zurueckzunehmen: Die
           Frist ist dann schon eingeloest und kreis.doc geraeumt. */
        if (!kreis.doc || kreis.id !== kreisId) { return; }
        kreis.doc.friends.splice(pos, 0, weg);
        if (wegE) { kreis.eintraege.push(wegE); }
        renderKreisListe();
      }
    });
  }

  /** Wie mineWorks(), nur fuer den Kreis: Im privaten Fenster schlaegt das
      Merken fehl, dann darf es auch niemand versprechen. */
  function kreisGemerkt() {
    return readMine().some(function (it) { return it.id === kreis.id; });
  }

  /**
   * Legt eine Superliste an. Kein feierZugang(): Das zaehlt g.listen hoch
   * und feiert mit einer Stufe; eine Superliste ist keine angelegte Liste.
   * Die Knoepfe tragen auch kein data-create — createButtons() schriebe sonst
   * beim Anlegen einer gewoehnlichen Liste "Liste wird angelegt …" darauf.
   */
  function createCircle(danach) {
    var id = randomHex(16);
    var token = randomToken(24);
    var doc = emptyCircle();
    doc.title = t('circle.newTitle');
    var keyRef = null;
    return Crypt.generateKey().then(function (key) {
      keyRef = key;
      return Promise.all([Crypt.exportKey(key), Crypt.proof(token), Crypt.encrypt(key, doc, id)]);
    }).then(function (parts) {
      return Store.create(id, parts[1], parts[2]).then(function (res) {
        if (res.status !== 200) { throw new AppError(mapError(res)); }
        kreisGen++;
        kreis.id = id; kreis.key = keyRef; kreis.keyStr = parts[0];
        kreis.token = token; kreis.proof = parts[1];
        kreis.rev = res.body.rev; kreis.doc = doc;
        kreis.eintraege = []; kreis.zeilen = []; kreis.geprueftAm = 0;
        state.mode = 'circle';
        state.doc = null;
        stopRefresh();
        /* replaceState loest kein hashchange aus; route() laeuft also nicht,
           und das Zeichnen steht hier ausdruecklich daneben. */
        history.replaceState(null, '', circleHash(id, parts[0], token));
        rememberList();
        if (danach) { danach(); }
        renderKreis();
        $('#circleKeyLink').value = circleLink();
        $('#chkCircleKeyDone').checked = false;
        $('#circleKeyBox').hidden = false;
        $('#circleKeyRemember').hidden = !kreisGemerkt();
      });
    }).catch(function (err) {
      toast(t('error.' + (err && err.code ? err.code : 'network')));
    });
  }

  /**
   * Der Knopf unter dem Inventar einer Freundesliste. Drei Faelle, und keiner
   * davon fragt zurueck: Es gibt genau einen gemerkten Kreis, keinen, oder
   * mehrere. Bei mehreren gilt der zuletzt angefasste — readMine() haelt die
   * Reihenfolge.
   */
  function circleAddHere() {
    if (state.mode !== 'view' || !state.id || !state.keyStr) { return; }
    /* Ohne Beschriftung. Der Kontaktname der fremden Liste gehoert nicht in
       das Chiffrat des Kreises: Er ist entschluesselter Fremdinhalt, er
       veraltete dort, und freundName() loest ihn beim Zeichnen ohnehin aus
       dem frisch geholten Dokument auf. Angezeigt steht also dasselbe. */
    var mich = { id: state.id, key: state.keyStr, label: '' };
    var kreise = readMine().filter(function (it) { return it.kind === 'circle'; });

    /* Kein gemerkter Kreis: Es entsteht einer, und die Ansicht wechselt
       hinein — anders bekaeme der Nutzer den Zugangskasten nie zu sehen, und
       dieser Link ist das Einzige, was den neuen Kreis wiederfindet. */
    if (!kreise.length) {
      createCircle(function () {
        kreis.doc.friends.push(mich);
        kreisSave();
      }).then(function () {
        /* Der Kreis haelt keine Kopie fremder Inhalte, auch nicht die der
           gerade offenen Liste. Die Gegenstaende muessen also geholt werden,
           sonst bliebe die frische Uebersicht bis zum naechsten
           Aktualisieren leer. */
        if (!kreis.doc) { return; }
        var gen = kreisGen;
        var neu = kreisEintraege([mich]);
        kreis.eintraege.push(neu[0]);
        renderKreisListe();
        return ladeKreis(neu, null).then(function () {
          if (gen !== kreisGen) { return; }
          renderKreisListe();
        });
      });
      return;
    }

    /* Es gibt schon einen: Bei mehreren gilt der zuletzt angefasste,
       readMine() haelt die Reihenfolge. Die Ansicht bleibt stehen, wo sie
       ist; eine Meldung bestaetigt es. */
    var ziel = kreise[0];
    var parsed = null;
    try { parsed = parseFragment(ziel.hash); } catch (e) { parsed = null; }
    if (!parsed || parsed.mode !== 'circle') { toast(t('error.badlink')); return; }

    var gen = ++kreisGen;
    kreisHolen(parsed, gen).then(function (doc) {
      if (gen !== kreisGen || !doc) { return; }
      if (doc.friends.some(function (f) { return f.id === mich.id; })) {
        toast(t('circle.dupAdd'));
        return kreisRaeumen();
      }
      if (doc.friends.length >= MAX_FRIENDS) {
        toast(t('circle.full', { n: MAX_FRIENDS }));
        return kreisRaeumen();
      }
      doc.friends.push(mich);
      return kreisSave().then(function () {
        toast(t('circle.added', { kreis: doc.title || t('circle.untitled') }));
        /* Aufraeumen, obwohl die Uebersicht gar nicht offen war: Sonst bliebe
           ein Kreis-Dokument ohne geholte Freunde stehen, und der Kurzweg in
           route() zeigte beim naechsten Oeffnen eine leere Uebersicht. */
        kreisRaeumen();
      });
    }).catch(function (err) {
      toast(t('error.' + (err && err.code ? err.code : 'network')));
      kreisRaeumen();
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
        state.doc = normalizeAny(raw, 'list', null);
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
    if (state.mode !== 'edit' && state.mode !== 'circle') { return; }
    /* Der Rest arbeitet unveraendert: Er braucht nur state.id und
       state.proof, und initSettings setzt beide auch fuer einen Kreis. */
    if (!window.confirm(t(state.mode === 'circle' ? 'circle.deleteConfirm' : 'settings.deleteConfirm'))) { return; }
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

    /* Die Zeile spricht nur, wenn wirklich etwas das Geraet verlaesst.
       Bleibt die Zerlegung im Browser, gibt es nichts zu sagen — und ein
       leerer Kasten unter dem Feld waere schlechter als keiner. */
    var node = $('#voiceHint');
    if (!node) { return; }
    var text = '';
    if (getAiKey()) { text = t('voice.hintAi'); }
    else if (aiProxyAvailable()) { text = t('voice.hintProxy'); }
    node.textContent = text;
    node.hidden = !text;
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
    if (!input) { bemaengeln($('#voiceText'), t('voice.emptyWarn')); return Promise.resolve(); }
    setVoiceState(t('voice.processing'), false);

    return structureText(input).then(function (entries) {
      /* Zwischen dem Absenden und der Antwort liegen mehrere Sekunden. Wer in
         dieser Zeit die Liste verlaesst, hat kein state.doc mehr, und der
         Zugriff auf items warf bisher unbehandelt. */
      if (state.mode !== 'edit' || !state.doc) { return; }
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

      /* In einem Rutsch mitzaehlen — und stumm feiern, damit die Meldung
         ueber die eingetragene Menge nicht ueberschrieben wird. Geprueft
         wird auf Erreichen, nicht auf Gleichheit: Der Zaehler springt hier
         von null auf zwoelf. */
      var g = spielRead();
      g.dinge += entries.length;
      spielSave();
      pruefeAbzeichen({ stumm: true });
    }).catch(function (err) {
      /* Die Kette hing bisher ohne Auffangnetz. Ein Netzfehler, ein
         abgelehnter Schluessel oder eine unerwartete Antwort verschwanden
         damit stumm, und die Zeile blieb auf "wird verarbeitet" stehen. */
      setVoiceState(t('error.' + (err && err.code ? err.code : 'network')), true);
    });
  }

  /* ===================================================================== *
   * 13 · Ereignisse
   * ===================================================================== */

  /**
   * Die Horcher, nach Ansichten geordnet. bindEvents() selbst ist nur noch das
   * Inhaltsverzeichnis: Wer eine Schaltflaeche sucht, liest hier, in welcher
   * Ansicht sie sitzt, und geht dann genau dorthin.
   *
   * Zuvor standen alle siebenunddreissig in einer einzigen Funktion von 222
   * Zeilen. Das war kein Schoenheitsfehler: Die naechstgroesste Funktion im
   * Quelltext hat 113, und eine Liste, die doppelt so lang ist wie alles
   * andere, liest niemand mehr von oben nach unten — man sucht darin.
   *
   * Aufgerufen wird nur von init(), und nur einmal je Ladevorgang. Die
   * Einstellungsseite hat ihren eigenen Einstieg und holt sich mit bindNav()
   * genau das, was sie mit dieser Seite teilt.
   */
  function bindEvents() {
    bindKopf();
    bindListe();
    bindEintragen();
    bindTeilen();
    bindFenster();
    bindKreis();
    bindSeite();
  }

  /**
   * Die Kopfleiste: Sprache, die beiden Wege zu den eigenen Listen und die
   * Marke mit der Feierstufe. Licht und Einstellungen haengen nicht hier — das
   * eine schaltet theme.js noch vor dem Koerper, das andere ist ein
   * gewoehnlicher Verweis und braucht kein JavaScript.
   */
  function bindKopf() {
    $('#btnLang').addEventListener('click', function () {
      setLang(lang === 'de' ? 'en' : 'de');
    });
    bindNav();
    $('#levelChip').addEventListener('click', openRundenbuch);
  }

  /**
   * Die Leihliste: anlegen, aktualisieren, eintragen, benennen, oeffnen, und
   * der Zugangskasten am Ende des Anlegens. Dazu der Kontaktkasten — ein
   * eigener Aufklapper, aber er schreibt in dasselbe state.doc und steht und
   * faellt mit ihm.
   */
  function bindListe() {
    $$('[data-create]').forEach(function (btn) {
      btn.addEventListener('click', createList);
    });
    $('#btnRefresh').addEventListener('click', function () { refresh(true); });
    $('#addForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      addItem($('#addName').value, '');
      $('#addName').value = '';
      $('#addName').focus();
    });
    $('#listTitleInput').addEventListener('input', function () {
      state.doc.title = this.value;
      touch();
    });
    /* Delegation für die Inventarliste */
    $('#itemList').addEventListener('click', function (ev) {
      var hit = ev.target.closest('[data-act]');
      if (!hit) { return; }
      var id = hit.closest('.item').getAttribute('data-id');
      if (hit.getAttribute('data-act') === 'ask') { openAskModal(id); return; }
      openItemModal(id);
    });
    /* Der Zugang wird weggeräumt, wenn er ausdrücklich gesichert wurde. Das
       ist der Abschluss des Anlegens und nicht das Anlegen selbst: Wer den
       Bearbeiten-Link nicht bestaetigt hat, hat die Liste noch nicht in der
       Hand — und ueber einer Warnung wird ohnehin nicht gefeiert. */
    $('#chkKeyDone').addEventListener('change', function () {
      if (!this.checked) { return; }
      $('#keyBox').hidden = true;
      feierZugang();
    });

    /* Ein Ankreuzfeld hoert auf die Leertaste, nicht auf die Eingabetaste.
       Die Schaltflaeche davor konnte beides; das bleibt so. */
    $('#chkKeyDone').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || this.checked) { return; }
      ev.preventDefault();
      this.checked = true;
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });
    /* Sichern und Wiederherstellen. Das Dateifeld bleibt verborgen; der
       Verweis auf der Startseite oeffnet es. Zuruecksetzen nach dem Lesen,
       sonst loest dieselbe Datei beim zweiten Mal kein change mehr aus. */
    $('#btnBackup').addEventListener('click', sichereListe);
    $('#btnRestore').addEventListener('click', function () { $('#backupFile').click(); });
    $('#backupFile').addEventListener('change', function () {
      if (this.files && this.files[0]) { stelleWiederHer(this.files[0]); }
      this.value = '';
    });
    /* Der Kontaktkasten. Vier Felder, ein Muster: schreiben und touch(). */
    $('#cfgName').addEventListener('input', function () { state.doc.contact.name = this.value; touch(); });
    $('#cfgEmail').addEventListener('input', function () { state.doc.contact.email = this.value.trim(); touch(); });
    $('#cfgPhone').addEventListener('input', function () { state.doc.contact.phone = this.value.trim(); touch(); });
    $('#cfgShowBorrower').addEventListener('change', function () { state.doc.showBorrower = this.checked; touch(); });
  }

  /**
   * Sprechen und Sammeleingabe. Beide fuehren in dieselbe Box: Wer kein
   * Mikrofon hat oder keines geben moechte, tippt dort mehrere Sachen am Stueck.
   */
  function bindEintragen() {
    $('#btnMic').addEventListener('click', toggleMic);
    /* Der Verweis oeffnet dieselbe Box zum Eintippen, auch ohne Mikrofon. */
    $('#btnBulk').addEventListener('click', function () {
      setVoiceOpen(!voiceOpen);
      if (voiceOpen) { $('#voiceText').focus(); }
    });
    $('#btnVoiceApply').addEventListener('click', function () {
      processVoiceText($('#voiceText').value);
    });
  }

  /**
   * Der Kasten zum Weitergeben: die beiden Reiter, das Kopieren, das Aufdecken
   * des geheimen Links und die Weitergabe ueber das Geraet.
   *
   * [data-copy] steht auch an den Feldern der Superliste. Das ist kein
   * Versehen: Es ist ein Muster und keine Ansicht, und der Handgriff
   * unterscheidet die Faelle an der Kennung des Ziels.
   */
  function bindTeilen() {
    /* Reiter im Abschnitt Link teilen */
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-tab')); });
    });
    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ziel = btn.getAttribute('data-copy');
        var input = document.getElementById(ziel);
        copyText(input.value).then(function (ok) {
          if (!ok) { toast(t('share.copyfail')); return; }
          /* Der Bearbeiten-Link ist der geheime. Er wird nie gezaehlt und nie
             gefeiert — ihn weiterzugeben waere das Gegenteil dessen, was
             gefeiert gehoert. */
          /* Der Kreis hat nur einen Link, und er ist geheim; "Bearbeiten-Link
             kopiert" waere dort das falsche Wort. */
          if (ziel === 'circleKeyLink' || ziel === 'circleLink') { toast(t('circle.copied')); return; }
          if (ziel !== 'linkView') { toast(t('share.copiedEdit')); return; }
          if (state.mode !== 'edit') { toast(t('share.copied')); return; }
          var vorher = spielRead().weiter;
          feierWeiter();
          if (laut(vorher + 1) <= 1) { toast(t('share.copied')); }
        });
      });
    });
    $('#btnRevealEdit').addEventListener('click', function () {
      var input = $('#linkEdit');
      var hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      this.textContent = t(hidden ? 'share.hide' : 'share.reveal');
    });
    $('#btnShareView').addEventListener('click', function () {
      nativeShare({
        title: state.doc.title || t('list.untitled'),
        text: t('share.message', { title: state.doc.title || t('list.untitled') }),
        url: viewLink()
      }).then(function (ok) {
        /* Ein Abbruch ist kein Fehler und keine Weitergabe: nativeShare()
           unterscheidet beides bereits, es wurde bisher nur weggeworfen. */
        if (ok) { feierWeiter(); }
      });
    });
  }

  /**
   * Das Fenster zu einem Gegenstand. Schliessen kann es auch der Browser, ueber
   * Escape und den Hintergrund; deshalb haengt das Aufraeumen am close-Ereignis
   * und nicht am Knopf.
   */
  function bindFenster() {
    $('#modalClose').addEventListener('click', closeItemModal);
    $('#itemModal').addEventListener('close', function () {
      modalItemId = null;
      feierNachholen();
    });
  }

  /**
   * Die Superliste. Sie steht neben state und nicht darin, und ihre
   * Bedienelemente stehen hier aus demselben Grund beisammen.
   */
  function bindKreis() {
    $('#btnRevealCircle').addEventListener('click', function () {
      var input = $('#circleLink');
      var hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      this.textContent = t(hidden ? 'share.hide' : 'share.reveal');
    });

    /* Spiegelbildlich zu #chkKeyDone, aber ohne feierZugang(): Ein
       Superliste ist keine angelegte Liste. */
    $('#chkCircleKeyDone').addEventListener('change', function () {
      if (!this.checked) { return; }
      $('#circleKeyBox').hidden = true;
    });
    $('#chkCircleKeyDone').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || this.checked) { return; }
      ev.preventDefault();
      this.checked = true;
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });

    /* Der eigene Knopf, weil #btnRefresh in #viewList liegt und refresh()
       bei state.mode !== 'view' ohnehin sofort zurueckkehrt. */
    $('#btnCircleRefresh').addEventListener('click', function () {
      if (!kreis.id || !kreis.keyStr) { return; }
      oeffneKreis({ mode: 'circle', id: kreis.id, key: kreis.keyStr, token: kreis.token });
    });

    $('#circleQ').addEventListener('input', filterKreis);
    $('#btnCircleReset').addEventListener('click', function () {
      $('#circleQ').value = '';
      filterKreis();
      $('#circleQ').focus();
    });

    /* Kein touch()/scheduleSave(): Der Kreis kennt keinen Aufschub. Der
       Titel wird beim Verlassen des Feldes geschrieben, nicht bei jedem
       Zeichen — sonst waere jeder Tastendruck ein Schreibvorgang. */
    $('#circleTitleInput').addEventListener('input', function () {
      if (kreis.doc) { kreis.doc.title = this.value; }
    });
    $('#circleTitleInput').addEventListener('change', function () {
      if (!kreis.doc) { return; }
      kreis.doc.title = this.value;
      $('#circleTitleRead').textContent = kreis.doc.title || t('circle.untitled');
      rememberList();
      kreisSave();
    });

    $('#btnCircleAdd').addEventListener('click', circleAdd);
    $('#btnCircleAddHere').addEventListener('click', circleAddHere);
    $('#btnStartCircle').addEventListener('click', function () { createCircle(null); });

    /* Delegation fuer den Aufklapper: Entfernen und erneut versuchen. */
    $('#circleFriends').addEventListener('click', function (ev) {
      var hit = ev.target.closest('[data-kreis-act]');
      if (!hit) { return; }
      var id = hit.getAttribute('data-kreis-id');
      if (hit.getAttribute('data-kreis-act') === 'remove') { circleRemove(id); return; }
      var f = null;
      kreis.doc.friends.forEach(function (x) { if (x.id === id) { f = x; } });
      if (!f) { return; }
      var gen = kreisGen;
      /* Der bestehende Eintrag wird an Ort und Stelle ersetzt: ladeKreis
         fuellt das uebergebene Objekt, die Reihenfolge bleibt also stehen. */
      var neu = kreisEintraege([f]);
      for (var i = 0; i < kreis.eintraege.length; i++) {
        if (kreis.eintraege[i] && kreis.eintraege[i].freund.id === id) { kreis.eintraege[i] = neu[0]; break; }
      }
      renderKreisListe();
      ladeKreis(neu, null).then(function () {
        if (gen !== kreisGen) { return; }
        renderKreisListe();
      });
    });
  }

  /**
   * Was nicht an einer Ansicht haengt, sondern am Fenster: der letzte
   * Schreibvorgang vor dem Verlassen, das Nachladen beim Zurueckkehren und der
   * Weg, auf dem jede Ansicht ueberhaupt erst aufgerufen wird.
   */
  function bindSeite() {
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
    var hash = '';
    if (state.mode === 'circle' && kreis.id && kreis.token) { hash = circleHash(kreis.id, kreis.keyStr, kreis.token); }
    else if (state.mode === 'edit' && state.id && state.token) { hash = editHash(state.id, state.keyStr, state.token); }
    link.setAttribute('href', 'einstellungen.html' + hash);
  }

  function route() {
    var parsed;
    try { parsed = parseHash(); }
    catch (err) { showError(err.code || 'badlink'); return; }

    if (!parsed) {
      /* Ein Fragment, das kein Zugangslink ist, ist ein Seitenanker und kein
         Ortswechsel. Der Sprunglink (Ziel #main) hat keinen eigenen Zuhoerer;
         ohne diese Zeile raeumte er die offene Ansicht weg — bei einer Liste
         kostete das einen Abruf, bei der Superliste alle. MINE_HASH bleibt
         ausgenommen, es lebt davon, dass parseHash hier null liefert. */
      if (location.hash && location.hash !== MINE_HASH && (state.doc || kreis.doc)) { return; }
      stopRefresh();
      /* Was offen ist, wird geschrieben, bevor das Dokument verschwindet:
         save() nimmt seinen Abzug beim Eintritt, der Rest der Kette braucht
         nur state.id, state.key und state.proof, und die bleiben stehen.
         Danach die Meldung wegnehmen, denn ihre Ruecknahme ist vorbei. */
      if (state.mode === 'edit' && state.dirty) { save(); }
      if (state.doc) { toastSchliessen(); }
      state.mode = 'start';
      state.doc = null;
      renderMine();
      showView('viewStart');
      /* Nach dem Zeichnen, denn showView() setzt den Rollstand zurueck. */
      if (location.hash === MINE_HASH) { setTimeout(zeigeMeine, 0); }
      return;
    }

    if (parsed.mode === 'circle') {
      /* Kurzweg wie unten, aber gegen kreis.doc: state.doc bleibt im Kreis
         null, der Vergleich darunter griffe also nie und jeder hashchange
         schickte den Kreis erneut durchs Netz. */
      if (kreis.id === parsed.id && kreis.doc) {
        /* Den Modus mitsetzen: renderKreis allein liesse state.mode auf dem
           Wert der zuvor geoeffneten Liste stehen, und daran haengen
           rememberList, updateSettingsLink und setLang. */
        state.mode = 'circle';
        state.doc = null;
        renderKreis();
        return;
      }
      oeffneKreis(parsed);
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

    /* Der Tonschalter. Browser lassen Klang erst nach einer Beruehrung zu —
       dieser Haken ist eine, also erklingt die Probe zuverlaessig. */
    var sound = $('#cfgSound');
    if (sound) {
      sound.checked = tonAn();
      sound.addEventListener('change', function () {
        try {
          if (this.checked) { localStorage.setItem(LS_TON, '1'); }
          else { localStorage.removeItem(LS_TON); }
        } catch (e) { /* privater Modus: dann eben nicht */ }
        if (this.checked) { ton('heim'); toast(t('settings.soundOn')); }
      });
    }

    var ruhe = $('#cfgRuhig');
    if (ruhe) {
      var vorgabe = typeof window.matchMedia === 'function' &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var gesetzt = false;
      try { gesetzt = localStorage.getItem(LS_RUHIG) === '1'; } catch (e) { /* egal */ }
      ruhe.checked = gesetzt || vorgabe;
      /* Verlangt das System schon Ruhe, ist der Haken gesetzt und unveraenderlich:
         Die Anwendung wuerde die Vorgabe ohnehin nicht uebergehen. */
      ruhe.disabled = vorgabe;
      if (vorgabe) { $('#ruhigVorgabe').hidden = false; }
      ruhe.addEventListener('change', function () {
        try {
          if (this.checked) { localStorage.setItem(LS_RUHIG, '1'); }
          else { localStorage.removeItem(LS_RUHIG); }
        } catch (e) { /* privater Modus: dann eben nicht */ }
      });
    }

    /* Wurde die Seite aus einer offenen Liste heraus aufgerufen, trägt das
       Fragment deren Bearbeiten-Link. Nur dann führt der Weg zurück, und nur
       dann gibt es hier etwas zu löschen. */
    var parsed = null;
    try { parsed = parseHash(); } catch (err) { parsed = null; }
    var zugang = !!parsed && (parsed.mode === 'edit' || parsed.mode === 'circle');
    var back = './';
    if (zugang) {
      back = './' + (parsed.mode === 'circle'
        ? circleHash(parsed.id, parsed.key, parsed.token)
        : editHash(parsed.id, parsed.key, parsed.token));
    }
    $('#lnkBack').setAttribute('href', back);
    if (!zugang) {
      /* Das Merkmal wird getauscht, nicht der Text: sonst überschreibt der
         nächste Sprachwechsel die Beschriftung wieder. */
      $('#lnkBack').setAttribute('data-i18n', 'settings.backStart');
      $('#lnkBack').textContent = t('settings.backStart');
    }

    /* Auch von hier fuehren die Wege dorthin, wo etwas zu sehen ist — und die
       schwebende Schaltflaeche braucht ihre eigene Schaltung, weil diese Seite
       bindEvents() nie erreicht. */
    bindNav();
    updateNav();

    detectStore().then(function (store) {
      Store = store;
      applyStaticI18n();
      updateVoiceHint();
      if (!zugang) { return; }

      /* Die Einstellungsseite entschluesselt nichts. Welche Art dort liegt,
         weiss sie allein aus dem Praefix — das genuegt fuer den Loeschtext
         und fuer den Rueckweg. */
      state.mode = parsed.mode;
      /* Der Loeschkasten ist auf die Liste gemuenzt: Er spricht von "beiden
         Links", und eine Superliste hat genau einen. Das Merkmal wird
         getauscht, nicht der Text, sonst ueberschriebe der naechste
         Sprachwechsel die Beschriftung wieder. Beide Richtungen ausdruecklich,
         damit der Kasten nicht davon abhaengt, was vorher dastand. */
      var kreisig = parsed.mode === 'circle';
      [['#dangerBox .card__title', 'dangerHeadline'],
       ['#dangerBox .hint', 'dangerHint'],
       ['#btnDeleteList span[data-i18n]', 'delete']].forEach(function (paar) {
        var node = $(paar[0]);
        if (!node) { return; }
        var key = (kreisig ? 'circle.' : 'settings.') + paar[1];
        node.setAttribute('data-i18n', key);
        node.textContent = t(key);
      });
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
