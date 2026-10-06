/*!
 * Leih-Katalog · Erscheinungsbild
 * ---------------------------------------------------------------------------
 * Haelt die Wahl zwischen hell, dunkel und der Einstellung des Systems.
 *
 * Das Erscheinungsbild folgt von sich aus prefers-color-scheme. Ein Attribut
 * data-theme am Wurzelelement hat Vorrang, so ist das Stylesheet gebaut. Diese
 * Datei setzt dieses Attribut und merkt sich die Wahl im Browser. Dazu setzt
 * sie die Klasse ruhig, wenn in den Einstellungen "Bewegte Anteile
 * ruhigstellen" gewaehlt ist (lid.ruhig): Das Stylesheet haelt darunter jede
 * Animation an, wie unter prefers-reduced-motion.
 *
 * Sie laeuft bewusst nicht mit defer, sondern gleich beim Einlesen des Kopfes:
 * Sonst waere fuer einen Augenblick das falsche Erscheinungsbild zu sehen.
 * Die Schaltflaechen werden nachtraeglich verdrahtet, wenn das Dokument steht.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var STORE = 'lid.theme';
  var VALUES = { system: 1, light: 1, dark: 1 };

  var LABELS = {
    de: { toDark: 'Auf dunkles Erscheinungsbild umschalten', toLight: 'Auf helles Erscheinungsbild umschalten' },
    en: { toDark: 'Switch to the dark appearance', toLight: 'Switch to the light appearance' }
  };

  var lang = 'de';

  function read() {
    try {
      var value = localStorage.getItem(STORE);
      return VALUES[value] ? value : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function write(value) {
    try {
      if (value === 'system') { localStorage.removeItem(STORE); }
      else { localStorage.setItem(STORE, value); }
    } catch (e) { /* privater Modus: gilt dann nur fuer diese Sitzung */ }
  }

  /** Was tatsaechlich zu sehen ist, auch wenn die Wahl auf System steht. */
  function effective() {
    var choice = read();
    if (choice !== 'system') { return choice; }
    var query = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return (query && query.matches) ? 'dark' : 'light';
  }

  function apply() {
    var choice = read();
    var root = document.documentElement;
    if (choice === 'system') { root.removeAttribute('data-theme'); }
    else { root.setAttribute('data-theme', choice); }
  }

  /** Die Schaltflaeche zeigt das Ziel, nicht den Zustand, und traegt kein Wort. */
  function refresh() {
    var dark = effective() === 'dark';
    var labels = LABELS[lang] || LABELS.de;
    var label = dark ? labels.toLight : labels.toDark;

    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('title', label);
      buttons[i].setAttribute('aria-label', label);
      var use = buttons[i].querySelector('use');
      if (use) { use.setAttribute('href', dark ? '#i-sun' : '#i-moon'); }
    }

    var radios = document.querySelectorAll('input[name="cfgTheme"]');
    var choice = read();
    for (var r = 0; r < radios.length; r++) {
      radios[r].checked = (radios[r].value === choice);
    }
  }

  function set(value) {
    write(VALUES[value] ? value : 'system');
    apply();
    refresh();
  }

  /* Die Ruhe aus der Anwendung, ebenso frueh: Sonst wiegte sich die Knete
     auf der Startseite einen Augenblick, bevor app.js geladen ist. */
  function ruhe() {
    var still = false;
    try { still = localStorage.getItem('lid.ruhig') === '1'; } catch (e) { still = false; }
    document.documentElement.classList.toggle('ruhig', still);
  }

  /* Sofort anwenden, noch bevor der Koerper gezeichnet wird. */
  apply();
  ruhe();

  function wire() {
    refresh();

    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        /* Der Umschalter trifft immer eine ausdrueckliche Wahl. Wer zurueck
           zur Einstellung des Systems will, nimmt die Auswahl in den
           Einstellungen. */
        set(effective() === 'dark' ? 'light' : 'dark');
      });
    }

    var radios = document.querySelectorAll('input[name="cfgTheme"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener('change', function () {
        if (this.checked) { set(this.value); }
      });
    }

    /* Steht die Wahl auf System, folgt die Seite einer spaeteren Aenderung. */
    var query = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (query && query.addEventListener) {
      query.addEventListener('change', function () { if (read() === 'system') { refresh(); } });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.LeihTheme = {
    get: read,
    set: set,
    effective: effective,
    refresh: refresh,
    ruhe: ruhe,
    setLang: function (next) { lang = (next === 'en') ? 'en' : 'de'; refresh(); }
  };
})();
