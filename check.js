/*!
 * Leih-Katalog · Abnahme im Browser
 * ---------------------------------------------------------------------------
 * Prueft eine laufende Installation von der Seite aus, ohne Konsolenzugriff.
 * Alle Anfragen gehen an dieselbe Herkunft, deshalb sind auch die Kopfzeilen
 * der Antworten lesbar; bei einer fremden Herkunft waeren sie es nicht.
 *
 * Die Pruefung schreibt genau einmal: Sie legt eine leere Liste an und loescht
 * sie sofort wieder. Damit ist belegt, dass data/ beschreibbar ist.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var LEVEL_MUST = 'MUSS';
  var LEVEL_SHOULD = 'SOLL';
  var LEVEL_INFO = 'INFO';

  var rows = [];
  var groupNode = null;

  function $(sel) { return document.querySelector(sel); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  /* -- Darstellung --------------------------------------------------------- */

  function group(title) {
    var head = el('h3', 'check-group', title);
    $('#results').appendChild(head);
    groupNode = el('ul', 'items');
    $('#results').appendChild(groupNode);
  }

  function report(level, name, state, detail) {
    rows.push({ level: level, name: name, state: state, detail: detail || '' });

    var li = el('li', 'item');
    var badge = el('span', 'chip');
    var dot = el('span', 'dot' + (state === 'ok' ? '' : (state === 'offen' ? ' dot--muted' : ' dot--danger')));
    badge.appendChild(dot);
    badge.appendChild(el('span', null, level));
    li.appendChild(badge);

    var main = el('div', 'item-main');
    main.appendChild(el('span', 'item-name', name));
    if (detail) { main.appendChild(el('span', 'item-note', detail)); }
    li.appendChild(main);

    li.appendChild(el('span', 'tag check-state' + (state === 'ok' ? '' : ' savestate-error'), state));
    groupNode.appendChild(li);
  }

  function check(level, name, ok, detail) {
    report(level, name, ok ? 'ok' : 'fehlt', detail);
  }

  /* -- Hilfsmittel --------------------------------------------------------- */

  function head(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      return { status: res.status, type: (res.headers.get('content-type') || '').toLowerCase(), res: res };
    }, function () {
      return { status: 0, type: '', res: null };
    });
  }

  function postJson(body) {
    return fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        var parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) { /* egal */ }
        return { status: res.status, body: parsed };
      });
    }, function () { return { status: 0, body: null }; });
  }

  function b64u(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomHex(n) {
    var b = crypto.getRandomValues(new Uint8Array(n));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  /* -- Die einzelnen Abschnitte -------------------------------------------- */

  function checkConnection() {
    group('Verbindung');
    check(LEVEL_MUST, 'Seite laeuft ueber https',
      location.protocol === 'https:',
      'ist ' + location.protocol.replace(':', ''));
    check(LEVEL_MUST, 'Sicherer Kontext',
      window.isSecureContext === true,
      'ohne ihn steht die Web Crypto API nicht bereit');
    check(LEVEL_MUST, 'Web Crypto API vorhanden',
      !!(window.crypto && window.crypto.subtle),
      'die Anwendung kann ohne sie nicht verschluesseln');
    return Promise.resolve();
  }

  /* Merkposten fuer die Schlussfolgerung am Ende: Ob die Kopfzeilen fehlen,
     sagt fuer sich genommen wenig. Erst zusammen mit der Frage, ob die
     Sperren aus derselben .htaccess greifen, wird daraus eine Diagnose. */
  var kopfzeilenFehlen = false;
  var sperrenGreifen = false;

  /* Eine Richtlinie in ihre Direktiven zerlegen. Auf Teilzeichenketten zu
     pruefen waere keine Verbesserung: indexOf("script-src 'self'") findet das
     auch in "script-src 'self' 'unsafe-inline'", und
     indexOf("connect-src 'self' https://…") ebenso in "… *". Verglichen wird
     deshalb der vollstaendige Wert einer Direktive. */
  function direktive(csp, name) {
    var teile = String(csp || '').split(';');
    for (var i = 0; i < teile.length; i++) {
      var w = teile[i].replace(/^\s+|\s+$/g, '').split(/\s+/);
      if (w[0].toLowerCase() === name) { return w.slice(1).join(' '); }
    }
    return null;
  }

  var CSP_SOLL = [
    ['default-src', "'self'"],
    ['script-src',  "'self'"],
    ['style-src',   "'self'"],
    ['font-src',    "'self'"],
    ['img-src',     "'self' data:"],
    ['connect-src', "'self' https://generativelanguage.googleapis.com"],
    ['base-uri',    "'none'"],
    ['form-action', "'none'"]
  ];

  function pruefeCsp(stufe, csp, woher) {
    CSP_SOLL.forEach(function (soll) {
      var ist = direktive(csp, soll[0]);
      check(stufe, woher + ': ' + soll[0] + ' ' + soll[1], ist === soll[1],
        ist === null ? 'fehlt' : ist);
    });
  }

  function checkHeaders() {
    group('Kopfzeilen');
    return head('./').then(function (r) {
      if (!r.res) {
        check(LEVEL_MUST, 'Startseite erreichbar', false, 'keine Antwort');
        return;
      }
      var h = r.res.headers;
      var csp = h.get('content-security-policy');
      kopfzeilenFehlen = !csp;
      check(LEVEL_MUST, 'Content-Security-Policy als Kopfzeile', !!csp,
        csp ? 'gesetzt' : 'fehlt, die Ursache steht am Ende unter Befund');
      /* Nicht nur, dass sie dasteht, sondern was sie sagt. Eine zu weite
         connect-src oder ein 'unsafe-inline' faellt sonst nicht auf. */
      if (csp) { pruefeCsp(LEVEL_MUST, csp, 'Kopfzeile'); }
      check(LEVEL_SHOULD, 'X-Content-Type-Options nosniff',
        (h.get('x-content-type-options') || '') === 'nosniff');
      check(LEVEL_SHOULD, 'Referrer-Policy no-referrer',
        (h.get('referrer-policy') || '') === 'no-referrer');
      check(LEVEL_SHOULD, 'X-Frame-Options DENY',
        (h.get('x-frame-options') || '').toUpperCase() === 'DENY');
      check(LEVEL_SHOULD, 'Strict-Transport-Security',
        !!h.get('strict-transport-security'),
        'in .htaccess auskommentiert, erst bei dauerhaftem HTTPS einschalten');
    }).then(function () {
      /* Fehlt mod_headers, ist die Meta-Fassung in index.html die einzige
         verbliebene Sperre. Sie gehoert also ebenso geprueft, und zwar auf
         derselben Seite, auf der sie steht. */
      return fetch('./', { cache: 'no-store' }).then(function (res) {
        return res.text();
      }).then(function (html) {
        var m = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html);
        /* Das Trennzeichen ueber einen Rueckverweis festhalten, nicht ueber
           eine Zeichenklasse: In der Richtlinie stehen einfache
           Anfuehrungszeichen ('self', 'none'), an denen [^"']+ sofort
           abbraeche und einen Torso zurueckliesse. */
        var inhalt = m ? (/content\s*=\s*(["'])([\s\S]*?)\1/i.exec(m[0]) || [])[2] : null;
        check(LEVEL_SHOULD, 'Content-Security-Policy als <meta> in index.html', !!inhalt,
          inhalt ? 'gesetzt' : 'fehlt');
        if (inhalt) { pruefeCsp(LEVEL_SHOULD, inhalt, 'meta'); }
      }).catch(function () {
        check(LEVEL_SHOULD, 'Content-Security-Policy als <meta> in index.html', false,
          'index.html nicht lesbar');
      });
    });
  }

  function checkDelivery() {
    group('Auslieferung');
    var files = [
      ['style.css', 'text/css'],
      ['app.js', 'javascript'],
      ['theme.js', 'javascript'],
      ['einstellungen.html', 'text/html'],
      ['ueber.html', 'text/html'],
      ['impressum.html', 'text/html'],
      ['datenschutz.html', 'text/html'],
      ['assets/fonts/fonts.css', 'text/css'],
      ['assets/fonts/ranchers-400.woff2', 'font/woff2'],
      ['assets/fonts/inter-400.woff2', 'font/woff2'],
      ['assets/pics/pfote.svg', 'image/svg+xml'],
      ['assets/pics/og.png', 'image/png'],
      ['assets/pics/logo.svg', 'image/svg+xml'],
      ['assets/favicon/favicon.svg', 'image/svg+xml'],
      ['assets/favicon/favicon-96x96.png', 'image/png'],
      ['assets/favicon/apple-touch-icon.png', 'image/png'],
      ['assets/favicon/web-app-manifest-192x192.png', 'image/png'],
      ['assets/favicon/web-app-manifest-512x512.png', 'image/png'],
      ['favicon.ico', 'image'],
      ['site.webmanifest', 'json'],
      ['robots.txt', 'text/plain'],
      ['sitemap.xml', 'xml']
    ];
    return files.reduce(function (chain, entry) {
      return chain.then(function () {
        return head(entry[0]).then(function (r) {
          check(LEVEL_MUST, entry[0], r.status === 200, 'Status ' + r.status);
          if (r.status === 200) {
            check(LEVEL_SHOULD, '  Typ ' + entry[1],
              r.type.indexOf(entry[1]) !== -1, r.type || 'kein Typ');
          }
        });
      });
    }, Promise.resolve());
  }

  function checkSealed() {
    group('Abschottung');
    var paths = ['data/', 'data/lists/', '.git/config', 'tests/api-test.php',
                 'tools/purge.php', 'tools/og-vorlage.html'];
    return paths.reduce(function (chain, path) {
      return chain.then(function () {
        return head(path).then(function (r) {
          var detail = 'Status ' + r.status;
          if (path === '.git/config' && r.status === 200) {
            detail = 'Status 200, die gesamte Repository-Historie liegt offen';
          }
          if (r.status !== 200) { sperrenGreifen = true; }
          check(LEVEL_MUST, 'gesperrt: ' + path, r.status !== 200, detail);
        });
      });
    }, Promise.resolve());
  }

  function checkApi() {
    group('Schnittstelle');
    return head('api.php?a=ping').then(function (r) {
      if (!r.res) {
        check(LEVEL_MUST, 'api.php antwortet', false, 'keine Antwort');
        return null;
      }
      return r.res.json().catch(function () { return null; }).then(function (info) {
        var alive = !!info && info.service === 'leih-katalog';
        check(LEVEL_MUST, 'api.php antwortet als Dienst', alive,
          alive ? 'Fassung ' + (info.version || '?')
                : 'PHP wird nicht ausgefuehrt oder api.php ist blockiert');
        return alive ? info : null;
      });
    }).then(function (info) {
      if (!info) { return; }

      var id = randomHex(16);
      var proof = b64u(crypto.getRandomValues(new Uint8Array(32)));
      var payload = { iv: b64u(crypto.getRandomValues(new Uint8Array(12))), ct: b64u(new Uint8Array([1, 2, 3, 4])) };

      return postJson({ a: 'create', id: id, proof: proof, payload: payload }).then(function (res) {
        var wrote = res.status === 200;
        check(LEVEL_MUST, 'Liste anlegen, data/ ist beschreibbar', wrote,
          wrote ? 'Status 200'
                : 'Status ' + res.status + (res.status === 500 ? ', Schreibrechte auf data/ pruefen' : ''));
        if (!wrote) { return; }
        return head('api.php?a=read&id=' + id).then(function (r) {
          check(LEVEL_MUST, 'Liste wieder lesbar', r.status === 200, 'Status ' + r.status);
          return postJson({ a: 'delete', id: id, proof: proof });
        }).then(function (res2) {
          check(LEVEL_MUST, 'Testliste wieder entfernt', res2.status === 200, 'Status ' + res2.status);
        });
      }).then(function () {
        report(LEVEL_INFO, 'KI-Proxy', info.aiProxy ? 'bereit' : 'offen',
          info.aiProxy
            ? 'gesprochener Text laeuft ueber diesen Server zu Google'
            : 'Schluessel fehlt, der Browser zerlegt selbst');
      });
    });
  }

  /**
   * Die Schlussfolgerung aus zwei Beobachtungen.
   *
   * Fehlen die Kopfzeilen, greifen aber die Sperren, dann wird die .htaccess
   * gelesen — RedirectMatch und Require all denied stehen in derselben Datei
   * und brauchen dasselbe AllowOverride wie Header. Dann liegt es nicht an
   * AllowOverride, sondern daran, dass mod_headers fehlt: Der ganze Block
   * steht in <IfModule mod_headers.c> und wird ohne das Modul stillschweigend
   * uebersprungen. Genau diese Stille macht den Fehler so schwer zu finden.
   */
  function checkDiagnose() {
    if (!kopfzeilenFehlen) { return Promise.resolve(); }
    group('Befund');
    if (sperrenGreifen) {
      check(LEVEL_MUST, 'Ursache der fehlenden Kopfzeilen', false,
        'Die .htaccess wird gelesen, sonst waeren die Sperren oben nicht wirksam. '
        + 'Es fehlt das Apache-Modul mod_headers. In Plesk unter Tools & Einstellungen, '
        + 'Apache-Webserver, headers anhaken; danach diese Pruefung wiederholen.');
    } else {
      check(LEVEL_MUST, 'Ursache der fehlenden Kopfzeilen', false,
        'Weder Kopfzeilen noch Sperren greifen: Die .htaccess wird gar nicht '
        + 'ausgewertet. Im Virtual Host fehlt AllowOverride All.');
    }
    return Promise.resolve();
  }

  function checkFonts() {
    group('Schriften');
    return document.fonts.ready.then(function () {
      var h1 = document.querySelector('h1');
      var family = h1 ? getComputedStyle(h1).fontFamily : '';
      check(LEVEL_SHOULD, 'Ueberschrift nutzt Ranchers',
        family.indexOf('Ranchers') !== -1, family || 'unbekannt');
      var loaded = 0;
      document.fonts.forEach(function (f) { if (f.status === 'loaded') { loaded++; } });
      check(LEVEL_SHOULD, 'Schriftdateien geladen', loaded > 0, loaded + ' von ' + document.fonts.size);
    });
  }

  /* -- Ablauf --------------------------------------------------------------- */

  function summarise() {
    var must = 0;
    var should = 0;
    rows.forEach(function (r) {
      if (r.state === 'fehlt' && r.level === LEVEL_MUST) { must++; }
      if (r.state === 'fehlt' && r.level === LEVEL_SHOULD) { should++; }
    });
    var node = $('#summary');
    node.className = 'hint' + (must > 0 ? ' savestate-error' : '');
    if (must === 0 && should === 0) {
      node.textContent = 'Alles in Ordnung. ' + rows.length + ' Punkte geprueft.';
    } else if (must === 0) {
      node.textContent = 'Betriebsbereit. ' + should + ' Empfehlung(en) offen, ' + rows.length + ' Punkte geprueft.';
    } else {
      node.textContent = must + ' Muss-Punkt(e) verletzt, ' + should + ' Empfehlung(en) offen. So nicht in Betrieb nehmen.';
    }
  }

  function run() {
    var btn = $('#btnRun');
    btn.disabled = true;
    btn.textContent = 'Pruefung laeuft';
    rows = [];
    $('#results').textContent = '';
    $('#resultCard').hidden = false;

    checkConnection()
      .then(checkHeaders)
      .then(checkDelivery)
      .then(checkSealed)
      .then(checkApi)
      .then(checkFonts)
      .then(checkDiagnose)
      .then(function () {
        summarise();
        btn.disabled = false;
        btn.textContent = 'Erneut pruefen';
      });
  }

  function asText() {
    var out = ['Leih-Katalog Abnahme', location.origin, ''];
    rows.forEach(function (r) {
      out.push([r.level, r.state === 'ok' ? 'ok   ' : (r.state === 'offen' ? 'offen' : 'FEHLT'), r.name,
        r.detail ? '(' + r.detail + ')' : ''].join('  ').trim());
    });
    out.push('', $('#summary').textContent);
    return out.join('\n');
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('#btnRun').addEventListener('click', run);
    $('#btnCopy').addEventListener('click', function () {
      var text = asText();
      var done = function (ok) { $('#btnCopy').textContent = ok ? 'Kopiert' : 'Kopieren nicht moeglich'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });
  });
})();
