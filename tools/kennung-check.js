#!/usr/bin/env node
/*
 * kennung-check · Prueft, ob jeder Verweis auf ein Skript oder Stylesheet
 * eine Kennung traegt, die zu seinem Inhalt passt: app.js?v=<8 Zeichen>.
 *
 * Warum: Im Betrieb kommt nur "/" ueber Apache und damit mit no-cache aus
 * .htaccess. Alles mit Endung, app.js, style.css, theme.js und auch die
 * HTML-Seiten selbst, liefert der vorgelagerte nginx von Plesk aus, ohne
 * Cache-Control (README, "Vorgelagerter nginx"; gemessen im November 2026).
 * Der Browser haelt solche Dateien dann nach Last-Modified fuer frisch. Nach
 * einem Update konnte so die neue Startseite mit der alten app.js oder
 * style.css zusammentreffen. Eine Kennung, die sich mit dem Inhalt aendert,
 * ist eine neue Adresse, und eine neue Adresse liegt in keinem Cache.
 *
 * Kein Bauschritt: Nichts wird beim Ausliefern erzeugt. Die Kennung steht im
 * HTML und wird hier nur geprueft; aus dem Inhalt abgeleitet, laesst sie sich
 * ohne Geschichte pruefen. Wer app.js aendert und die Kennung vergisst, sieht
 * es in tools/pruefe.sh und in der CI, mit dem richtigen Wert.
 *
 *   node tools/kennung-check.js            pruefen, Exit 1 bei einem Fund
 *   node tools/kennung-check.js --setzen   die richtigen Kennungen eintragen
 *
 * Die eine erwartete Form ist href="app.js?v=..." oder src="...": klein,
 * doppelte Anfuehrungszeichen, ohne Pfad davor, ohne weitere Abfrage. Jede
 * andere Schreibweise in einem Tag, die auf eine der Dateien zeigt, ist ein
 * Fund; was in einem HTML-Kommentar oder als Text steht, zaehlt nicht.
 * Gehasht wird der Inhalt mit \n als Zeilenende, damit ein Checkout mit
 * \r\n dieselbe Kennung ergibt.
 *
 * Geprueft werden alle *.html im Wurzelverzeichnis, keine Namensliste: Eine
 * Liste veraltet, sobald eine Seite dazukommt (wie in ci.yml). Die Schriften
 * (*.woff2) bleiben draussen; ihr preload muss Zeichen fuer Zeichen der
 * url() in fonts.css gleichen, und sie aendern sich kaum. fonts.css selbst
 * ist dabei.
 *
 * ES5 wie jede .js-Datei hier; die Pruefung in pruefe.sh und ci.yml liest
 * auch tools/.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var WURZEL = path.join(__dirname, '..');
var DATEIEN = ['style.css', 'app.js', 'theme.js', 'check.js', 'assets/fonts/fonts.css'];
var setzen = process.argv.indexOf('--setzen') >= 0;

/* Der Inhalt mit \n als Zeilenende: Ein Checkout unter Windows mit
   core.autocrlf haette sonst andere Bytes und meldete jede Kennung als
   falsch, obwohl sich nichts geaendert hat. */
function kennung(datei) {
  var inhalt = fs.readFileSync(path.join(WURZEL, datei), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(inhalt, 'utf8').digest('hex').slice(0, 8);
}

var soll = {};
DATEIEN.forEach(function (d) { soll[d] = kennung(d); });

/* Gelesen wird wie ein HTML-Parser liest, nur grob: Kommentare, Tags und
   die Attribute eines Tags der Reihe nach, damit ein Wert nicht als
   Attribut gilt und ein Attribut nicht im Wert verschwindet. Der Inhalt von
   script, style, textarea und title ist Text, kein Markup; ein <!-- dort
   oeffnet keinen Kommentar. Kommentare enden wie im Browser auch mit <!-->,
   <!---> und --!>. */
var MARKUP = /<!--(?:-?>|[\s\S]*?--!?>)|<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
var ATTRIBUT = /([^\s"'>\/=]+)(?:(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
var KANONISCH = /^([^?#&]+)(\?v=([0-9a-zA-Z]*))?$/;
var ROHTEXT = /^(script|style|textarea|title)$/i;

/* Worauf zeigt ein Wert? Weit gefasst, wie der Browser ihn aufloest:
   Zeichenreferenzen aufgeloest, Leerraum am Rand weg, Abfrage weg, und dann
   jede Adresse, die auf /app.js endet, also auch ./app.js, ../app.js,
   .//app.js oder https://leihichdir.de/app.js. Was auf eine der Dateien
   zeigt, aber nicht die eine erwartete Form hat, ist ein Fund: Ein Verweis,
   den diese Pruefung uebersaehe, truege keine Kennung. */
function zielVon(wert) {
  var klar = wert.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, function (g, n) {
    return String.fromCharCode(n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10));
  }).replace(/^\s+|\s+$/g, '').replace(/[?#].*$/, '');
  for (var i = 0; i < DATEIEN.length; i++) {
    var d = DATEIEN[i];
    if (klar === d || klar.slice(-(d.length + 1)) === '/' + d) { return d; }
  }
  return null;
}

var funde = [];
var formen = [];
var verweise = 0;
var seiten = fs.readdirSync(WURZEL).filter(function (n) { return /\.html$/.test(n); }).sort();

function pruefeSeite(name, text) {
  var aus = '', pos = 0, m;
  MARKUP.lastIndex = 0;
  while ((m = MARKUP.exec(text))) {
    if (!m[1]) { continue; }
    var tagname = m[1];
    var beginn = m.index + 1 + tagname.length;
    var attribute = m[2].replace(ATTRIBUT, function (ganz, attr, gleich, dq, sq, ohne, stelle) {
      var wert = dq !== undefined ? dq : (sq !== undefined ? sq : (ohne !== undefined ? ohne : ''));
      if (!/^(href|src)$/i.test(attr) || gleich === undefined) { return ganz; }
      var ziel = zielVon(wert);
      if (!ziel) { return ganz; }
      verweise++;
      var zeile = text.slice(0, beginn + stelle).split('\n').length;
      var form = KANONISCH.exec(wert);
      if (attr !== attr.toLowerCase() || gleich !== '=' || dq === undefined || !form || form[1] !== ziel) {
        formen.push(name + ':' + zeile + '  ' + ganz + '  nicht in der Form ' + attr.toLowerCase() + '="' + ziel + '?v=' + soll[ziel] + '"');
        return ganz;
      }
      if (form[3] !== soll[ziel]) {
        funde.push(name + ':' + zeile + '  ' + wert + '  erwartet ' + ziel + '?v=' + soll[ziel]);
      }
      return attr + '="' + ziel + '?v=' + soll[ziel] + '"';
    });
    aus += text.slice(pos, beginn) + attribute;
    pos = beginn + m[2].length;
    /* Rohtext bis zum schliessenden Tag ueberspringen. */
    if (ROHTEXT.test(tagname)) {
      var ende = text.toLowerCase().indexOf('</' + tagname.toLowerCase(), MARKUP.lastIndex);
      MARKUP.lastIndex = ende < 0 ? text.length : ende;
    }
  }
  return aus + text.slice(pos);
}

seiten.forEach(function (name) {
  var datei = path.join(WURZEL, name);
  var text = fs.readFileSync(datei, 'utf8');
  var neu = pruefeSeite(name, text);
  if (setzen && neu !== text) { fs.writeFileSync(datei, neu); }
});

if (!verweise) {
  console.log('Kein Verweis auf ' + DATEIEN.join(', ') + ' gefunden. Stimmt das Muster noch?');
  process.exit(1);
}
/* Eine abweichende Form schreibt auch --setzen nicht um: Ob ./app.js oder
   app.js?v=1&x=2 Absicht war, weiss nur, wer es geschrieben hat. */
if (formen.length) {
  console.log('Verweis in unerwarteter Form, bitte von Hand angleichen:');
  formen.forEach(function (f) { console.log('  ' + f); });
}
if (setzen) {
  console.log(funde.length ? funde.length + ' Kennung(en) eingetragen.' : 'Alle Kennungen stimmten schon.');
  process.exit(formen.length ? 1 : 0);
}
if (funde.length) {
  console.log('Kennung fehlt oder passt nicht zum Inhalt:');
  funde.forEach(function (f) { console.log('  ' + f); });
  console.log('Eintragen mit: node tools/kennung-check.js --setzen');
}
process.exit(funde.length || formen.length ? 1 : 0);
