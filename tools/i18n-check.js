#!/usr/bin/env node
/*
 * i18n-check · Prueft, ob beide Woerterbuecher denselben Schluesselsatz
 * tragen.
 *
 * Warum ueberhaupt: t() faellt bei einem fehlenden englischen Schluessel
 * still auf Deutsch zurueck. Ein Fehlschlag, den niemand sieht, ist genau
 * der, der lange stehenbleibt.
 *
 * Warum textlich und nicht ladend: Die Woerterbuecher stecken in der IIFE von
 * app.js und lassen sich nicht ohne Browser auswerten. Dieses Skript liest
 * deshalb den Quelltext. Es trifft dabei drei Annahmen, die hier stehen,
 * damit sie beim Umformatieren auffallen:
 *   1. Der Block beginnt mit einer Zeile "  var I18N = {".
 *   2. Die beiden Sprachen beginnen mit "    de: {" und "    en: {", jeweils
 *      allein auf einer Zeile.
 *   3. Ein Schluessel steht am Zeilenanfang in einfachen Anfuehrungszeichen,
 *      mit sechs Leerzeichen Einrueckung, gefolgt von einem Doppelpunkt.
 *
 * Und es prueft nach jedem Suchen, ob das Suchen getroffen hat: Bei -1
 * lieferte slice() stillschweigend Unsinn, und die Pruefung ginge durch. Eine
 * Waechterin, die still versagt, ist genau das, wogegen sie antritt.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var DATEI = path.join(__dirname, '..', 'app.js');
var MINDESTENS = 200;   // so viele Schluessel hat jede Sprache mindestens

function fehler(text) {
  console.error('i18n-check: ' + text);
  process.exit(1);
}

var quelle = fs.readFileSync(DATEI, 'utf8');

var anfang = quelle.indexOf('\n  var I18N = {\n');
if (anfang === -1) { fehler('der Block "var I18N = {" steht nicht dort, wo er erwartet wird'); }

var deAb = quelle.indexOf('\n    de: {\n', anfang);
var enAb = quelle.indexOf('\n    en: {\n', anfang);
if (deAb === -1) { fehler('"de: {" nicht gefunden'); }
if (enAb === -1) { fehler('"en: {" nicht gefunden'); }
if (enAb < deAb) { fehler('"en" steht vor "de"; dieses Skript erwartet die umgekehrte Reihenfolge'); }

var enEnde = quelle.indexOf('\n  };\n', enAb);
if (enEnde === -1) { fehler('das Ende des Blocks "};" nicht gefunden'); }

function schluessel(text) {
  var out = [];
  var re = /^ {6}'([^']+)'\s*:/gm;
  var m;
  while ((m = re.exec(text)) !== null) { out.push(m[1]); }
  return out;
}

var de = schluessel(quelle.slice(deAb, enAb));
var en = schluessel(quelle.slice(enAb, enEnde));

if (de.length < MINDESTENS) { fehler('nur ' + de.length + ' deutsche Schluessel gelesen, erwartet werden mindestens ' + MINDESTENS + '; vermutlich passt eine der Annahmen oben nicht mehr'); }
if (en.length < MINDESTENS) { fehler('nur ' + en.length + ' englische Schluessel gelesen, erwartet werden mindestens ' + MINDESTENS); }

function doppelte(liste) {
  var gesehen = {}, out = [];
  liste.forEach(function (k) {
    if (gesehen[k]) { out.push(k); }
    gesehen[k] = true;
  });
  return out;
}

function fehlend(a, b) {
  var hat = {};
  b.forEach(function (k) { hat[k] = true; });
  return a.filter(function (k) { return !hat[k]; });
}

var probleme = [];
var dd = doppelte(de), de2 = doppelte(en);
if (dd.length) { probleme.push('doppelt in de: ' + dd.join(', ')); }
if (de2.length) { probleme.push('doppelt in en: ' + de2.join(', ')); }

var nurDe = fehlend(de, en);
var nurEn = fehlend(en, de);
if (nurDe.length) { probleme.push('fehlt in en: ' + nurDe.join(', ')); }
if (nurEn.length) { probleme.push('fehlt in de: ' + nurEn.join(', ')); }

if (probleme.length) {
  probleme.forEach(function (z) { console.error('i18n-check: ' + z); });
  process.exit(1);
}

console.log('i18n-check: ' + de.length + ' Schluessel, beide Woerterbuecher vollstaendig.');
