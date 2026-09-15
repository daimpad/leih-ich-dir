#!/usr/bin/env node
/*
 * fallback-check · Prueft, ob die deutschen Ersatztexte im HTML noch mit dem
 * Woerterbuch uebereinstimmen.
 *
 * Warum ueberhaupt: Jeder Knoten mit data-i18n traegt zweimal denselben Satz,
 * einmal im HTML und einmal in I18N.de. Sichtbar ist der aus dem HTML nur
 * kurz — bis applyStaticI18n() ihn ueberschreibt — und dauerhaft dann, wenn
 * JavaScript ausfaellt. Genau deshalb faellt es niemandem auf, wenn beide
 * auseinanderlaufen: Wer den Satz im Woerterbuch aendert, sieht die
 * Aenderung sofort und hat keinen Anlass, ins HTML zu sehen. Gefunden wurden
 * so sieben abgelaufene Ersatztexte, einer davon aus einer Umbenennung, die
 * ein Jahr zurueckliegt.
 *
 * Das Woerterbuch ist die Vorlage, nicht das HTML: Was hier gemeldet wird,
 * wird im HTML nachgezogen.
 *
 * Geprueft wird dreierlei:
 *   - der Text eines Knotens mit data-i18n,
 *   - das Attribut zu data-i18n-placeholder, -title und -label, aber nur,
 *     wenn es im HTML ueberhaupt steht; fehlt es, gibt es nichts zu
 *     vergleichen, denn applyStaticI18n() setzt es ohnehin,
 *   - ob ein Knoten mit data-i18n Auszeichnung enthaelt. Das waere keine
 *     Abweichung, sondern ein Fehler: applyStaticI18n() schreibt in
 *     textContent und raeumt jedes Kindelement weg.
 *
 * Unterschiede im Zeilenumbruch zaehlen nicht. Ein langer Satz steht im HTML
 * ueber mehrere Zeilen und im Woerterbuch in einer; verglichen wird deshalb
 * mit zusammengezogenem Leerraum.
 *
 * Warum textlich und nicht ladend: wie bei i18n-check.js steckt das
 * Woerterbuch in der IIFE von app.js und laesst sich ohne Browser nicht
 * auswerten. Die Annahmen ueber seinen Aufbau stehen dort und gelten hier
 * mit; dazu kommt eine vierte: Ein Wert steht als einfach angefuehrte
 * Zeichenkette in derselben Zeile wie sein Schluessel.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var WURZEL = path.join(__dirname, '..');
var MINDESTENS = 200;   // so viele deutsche Schluessel hat das Woerterbuch mindestens

/* Alle ausgelieferten Seiten, gesucht statt aufgezaehlt. Dieselbe Lehre wie
   in der GitHub-Action: Eine Liste von Dateien veraltet, sobald eine
   dazukommt, und dann prueft die Waechterin still an ihr vorbei. Nur die
   Wurzel, denn tools/og-vorlage.html ist eine Vorlage fuer Bilder und traegt
   keinen Ersatztext. */
var SEITEN = fs.readdirSync(WURZEL).filter(function (n) {
  return /\.html$/.test(n);
}).sort();

/* Attribut je Merkmal. data-i18n selbst steht nicht drin: Es meint den Text
   und nicht ein Attribut, und wird getrennt behandelt. */
var ATTRIBUTE = {
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-title': 'title',
  'data-i18n-label': 'aria-label'
};

function fehler(text) {
  console.error('fallback-check: ' + text);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Das Woerterbuch
 * ------------------------------------------------------------------ */

function liesWoerterbuch() {
  var quelle = fs.readFileSync(path.join(WURZEL, 'app.js'), 'utf8');

  var anfang = quelle.indexOf('\n  var I18N = {\n');
  if (anfang === -1) { fehler('der Block "var I18N = {" steht nicht dort, wo er erwartet wird'); }
  var deAb = quelle.indexOf('\n    de: {\n', anfang);
  var enAb = quelle.indexOf('\n    en: {\n', anfang);
  if (deAb === -1) { fehler('"de: {" nicht gefunden'); }
  if (enAb === -1) { fehler('"en: {" nicht gefunden'); }
  if (enAb < deAb) { fehler('"en" steht vor "de"; dieses Skript erwartet die umgekehrte Reihenfolge'); }

  var block = quelle.slice(deAb, enAb);
  var woerter = Object.create(null);
  var re = /^ {6}'([^']+)'\s*:\s*'((?:\\.|[^'\\])*)'\s*,?\s*$/gm;
  var m;
  while ((m = re.exec(block)) !== null) { woerter[m[1]] = entschaerfen(m[2]); }

  var zahl = Object.keys(woerter).length;
  if (zahl < MINDESTENS) {
    fehler('nur ' + zahl + ' deutsche Werte gelesen, erwartet werden mindestens ' +
           MINDESTENS + '; vermutlich passt eine der Annahmen oben nicht mehr');
  }
  return woerter;
}

/** Loest die Fluchtzeichen einer einfach angefuehrten JavaScript-Zeichenkette auf. */
function entschaerfen(roh) {
  return roh.replace(/\\u([0-9a-fA-F]{4})/g, function (_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  }).replace(/\\(.)/g, function (_, z) {
    return z === 'n' ? '\n' : (z === 't' ? '\t' : z);
  });
}

/* ------------------------------------------------------------------ *
 * Das HTML
 * ------------------------------------------------------------------ */

/** Zusammengezogener Leerraum: Der Umbruch im HTML ist keine Abweichung. */
function glatt(text) { return text.replace(/\s+/g, ' ').trim(); }

/**
 * Werte mit einer Leerstelle wie {name} sind Vorlagen und keine Saetze.
 * t() fuellt sie beim Aufruf; im HTML stuende sonst "z. B. {name}" mit
 * geschweiften Klammern zu lesen, sobald JavaScript ausfaellt. Der Ersatztext
 * ist dort deshalb ein eigener, in sich geschlossener Satz — und darf
 * abweichen.
 */
function vorlage(wert) { return /\{[a-z]+\}/.test(wert); }

/** Die benannten Verweise, die in diesen Ersatztexten vorkommen. */
function entziffern(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp|shy|mdash|ndash);/g, function (_, name) {
    return { amp: '&', lt: '<', gt: '>', quot: '"', '#39': '\'', nbsp: '\u00a0',
             shy: '\u00ad', mdash: '\u2014', ndash: '\u2013' }[name];
  });
}

/** Liest ein Attribut aus dem Kopf eines Elements, oder null. */
function attribut(kopf, name) {
  var m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(kopf);
  return m ? entziffern(m[1]) : null;
}

var woerter = liesWoerterbuch();
var probleme = [];
var geprueft = 0;

if (!SEITEN.length) { fehler('keine HTML-Datei in der Wurzel gefunden'); }

SEITEN.forEach(function (datei) {
  var html = fs.readFileSync(path.join(WURZEL, datei), 'utf8');

  /* Ein Element, das irgendein data-i18n-Merkmal traegt, samt allem bis zum
     naechsten spitzen Klammernzeichen. Was danach kommt, entscheidet, ob der
     Knoten Text traegt oder Auszeichnung. */
  var re = /<([a-z0-9]+)((?:[^<>"]|"[^"]*")*?\sdata-i18n(?:-[a-z]+)?="(?:[^"]*)"(?:[^<>"]|"[^"]*")*)>([^<]*)(<?)/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var kopf = m[2];
    var text = m[3];
    var danach = m[4];
    var zeile = html.slice(0, m.index).split('\n').length;
    var ort = datei + ':' + zeile;

    Object.keys(ATTRIBUTE).forEach(function (merkmal) {
      var schluessel = attribut(kopf, merkmal);
      if (schluessel === null) { return; }
      geprueft++;
      if (!(schluessel in woerter)) {
        probleme.push(ort + ' · ' + merkmal + '="' + schluessel + '" steht nicht im Woerterbuch');
        return;
      }
      if (vorlage(woerter[schluessel])) { return; }
      var da = attribut(kopf, ATTRIBUTE[merkmal]);
      /* Fehlt das Attribut, gibt es nichts zu vergleichen: applyStaticI18n()
         setzt es beim Start ohnehin. */
      if (da === null) { return; }
      if (glatt(da) !== glatt(woerter[schluessel])) {
        probleme.push(ort + ' · ' + schluessel + ' (' + ATTRIBUTE[merkmal] + ')\n' +
                      '    HTML: ' + glatt(da) + '\n' +
                      '    DE:   ' + glatt(woerter[schluessel]));
      }
    });

    var textSchluessel = attribut(kopf, 'data-i18n');
    if (textSchluessel === null) { continue; }
    geprueft++;
    if (!(textSchluessel in woerter)) {
      probleme.push(ort + ' · data-i18n="' + textSchluessel + '" steht nicht im Woerterbuch');
      continue;
    }
    /* Ein leerer Knoten ist Absicht: Dort steht der Satz nur im Woerterbuch. */
    if (glatt(text) === '') { continue; }
    if (vorlage(woerter[textSchluessel])) { continue; }
    if (danach === '<' && html.charAt(m.index + m[0].length) !== '/') {
      probleme.push(ort + ' · ' + textSchluessel +
                    ' traegt Auszeichnung; applyStaticI18n() schreibt in textContent ' +
                    'und raeumt sie beim Start weg');
      continue;
    }
    if (glatt(entziffern(text)) !== glatt(woerter[textSchluessel])) {
      probleme.push(ort + ' · ' + textSchluessel + '\n' +
                    '    HTML: ' + glatt(entziffern(text)) + '\n' +
                    '    DE:   ' + glatt(woerter[textSchluessel]));
    }
  }
});

if (geprueft < 100) {
  fehler('nur ' + geprueft + ' Ersatztexte gefunden; vermutlich passt der ' +
         'Ausdruck fuer die Elemente nicht mehr');
}

if (probleme.length) {
  probleme.forEach(function (z) { console.error('fallback-check: ' + z); });
  console.error('\nfallback-check: ' + probleme.length + ' von ' + geprueft +
                ' Ersatztexten weichen ab. Das Woerterbuch gilt, das HTML wird nachgezogen.');
  process.exit(1);
}

console.log('fallback-check: ' + geprueft + ' Ersatztexte, alle wie im Woerterbuch.');
