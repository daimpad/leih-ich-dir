/*!
 * Stilprobe · LeihIchDir aus Knete
 * ---------------------------------------------------------------------------
 * Das Verhalten zu stilprobe.html. Eine Probe, kein Teil der Anwendung: Sie
 * speichert nichts, sendet nichts und laedt nichts nach. Gelesen wird nur
 * lid.ruhig, die Einstellung "Bewegte Anteile ruhigstellen" der Anwendung.
 *
 * Bewegt wird auf drei Wegen, und keiner davon ist ein style-Attribut — die
 * Inhaltsrichtlinie (style-src 'self') wuerde es stumm verwerfen:
 *   - SVG-Attribute (transform) fuer die Dinge und die Buchstaben,
 *   - Klassen, an denen Keyframes in stilprobe.css haengen,
 *   - CSSOM (element.style.x = ...) fuer Hoehe, Breite und --weich; das
 *     erfasst style-src nicht, es ist kein eingebetteter Stil.
 *
 * Alles, was federt, haengt an einem einzigen Takt (requestAnimationFrame).
 * Er schlaeft, sobald nichts mehr schwingt, und haelt an, solange der Reiter
 * verborgen ist.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* == 0 · Hilfen und Ruhe =============================================== */

  var NS = 'http://www.w3.org/2000/svg';
  var wurzel = document.documentElement;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function begrenze(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function zufall(a, b) { return a + Math.random() * (b - a); }
  function seite() { return Math.random() < .5 ? -1 : 1; }

  /* Weniger Bewegung: ueber das System oder ueber die Einstellung der
     Anwendung. Beides kann sich zur Laufzeit aendern. */
  var ruhigAbfrage = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var ruhig = false;

  function ruheAnwenden() {
    var still = false;
    try { still = localStorage.getItem('lid.ruhig') === '1'; } catch (e) { still = false; }
    ruhig = still || !!(ruhigAbfrage && ruhigAbfrage.matches);
    wurzel.classList.toggle('ruhig', ruhig);
  }

  /** Spielt eine Keyframe-Klasse einmal ab, auch wenn sie gerade noch laeuft. */
  function einmal(el, klasse) {
    if (!el || ruhig) { return; }
    el.classList.remove(klasse);
    void el.offsetWidth;
    el.classList.add(klasse);
  }
  document.addEventListener('animationend', function (e) {
    var el = e.target;
    if (!el || !el.classList) { return; }
    el.classList.remove('quetscht', 'dehnt', 'huepft');
    /* Der Knauf quetscht, die Klasse sitzt aber am Schalter darueber. */
    var schalter = e.animationName === 'quetschen' && el.closest ? el.closest('.quetscht') : null;
    if (schalter) { schalter.classList.remove('quetscht'); }
  });

  /* == 1 · Federn und Takt =============================================== */

  /* Die Federung der ganzen Seite; der Regler "Federung" stellt sie. */
  var feder = { k: 280, c: 14.5 };

  /** Ein Schritt einer gedaempften Feder, in zwei halben Teilschritten. */
  function federSchritt(z, ziel, k, c, dt) {
    var h = dt / 2;
    for (var n = 0; n < 2; n++) {
      var a = -k * (z.x - ziel) - c * z.v;
      z.v += a * h;
      z.x += z.v * h;
    }
  }

  var koerper = [];
  var laeuft = false;
  var letzte = 0;

  function wecke() {
    if (laeuft || document.hidden) { return; }
    laeuft = true;
    letzte = 0;
    window.requestAnimationFrame(takt);
  }

  function takt(jetzt) {
    if (document.hidden) { laeuft = false; return; }
    var dt = letzte ? Math.min((jetzt - letzte) / 1000, 1 / 30) : 1 / 60;
    letzte = jetzt;
    var wach = false;
    for (var i = 0; i < koerper.length; i++) {
      if (koerper[i].schritt(dt)) { wach = true; }
    }
    if (wach) { window.requestAnimationFrame(takt); } else { laeuft = false; }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { wecke(); }
  });

  /* == 2 · Klang ========================================================== *
   *
   * Aus dem Nichts erzeugt, mit der Web Audio API. Voreingestellt aus; der
   * AudioContext entsteht erst, wenn jemand den Ton einschaltet — also in
   * einer Geste, sonst bliebe er stumm.
   * ===================================================================== */

  var ton = { an: false, ctx: null, rauschen: null };

  function tonKontext() {
    if (!ton.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return null; }
      try { ton.ctx = new AC(); } catch (e) { return null; }
    }
    if (ton.ctx.state === 'suspended' && ton.ctx.resume) { ton.ctx.resume(); }
    return ton.ctx;
  }

  function rauschPuffer(ctx) {
    if (ton.rauschen) { return ton.rauschen; }
    var laenge = Math.floor(ctx.sampleRate * .25);
    var puffer = ctx.createBuffer(1, laenge, ctx.sampleRate);
    var daten = puffer.getChannelData(0);
    for (var i = 0; i < laenge; i++) { daten[i] = Math.random() * 2 - 1; }
    ton.rauschen = puffer;
    return puffer;
  }

  /** 'boop' ein runder Ton, 'plopp' ein heller, 'quietsch' gedrueckte Knete. */
  function klang(art, hoehe) {
    if (!ton.an) { return; }
    var ctx = tonKontext();
    if (!ctx) { return; }
    var t = ctx.currentTime;
    var f = hoehe || 520;
    var huelle = ctx.createGain();
    huelle.connect(ctx.destination);
    huelle.gain.setValueAtTime(.0001, t);

    if (art === 'quietsch') {
      var quelle = ctx.createBufferSource();
      quelle.buffer = rauschPuffer(ctx);
      var band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 5;
      band.frequency.setValueAtTime(f * .6, t);
      band.frequency.exponentialRampToValueAtTime(f * 2.4, t + .14);
      quelle.connect(band);
      band.connect(huelle);
      huelle.gain.exponentialRampToValueAtTime(.22, t + .02);
      huelle.gain.exponentialRampToValueAtTime(.0001, t + .18);
      quelle.start(t);
      quelle.stop(t + .2);
      return;
    }

    var osz = ctx.createOscillator();
    osz.type = art === 'plopp' ? 'triangle' : 'sine';
    osz.frequency.setValueAtTime(f * 1.3, t);
    osz.frequency.exponentialRampToValueAtTime(f * .7, t + .17);
    osz.connect(huelle);
    huelle.gain.exponentialRampToValueAtTime(art === 'plopp' ? .12 : .16, t + .012);
    huelle.gain.exponentialRampToValueAtTime(.0001, t + .24);
    osz.start(t);
    osz.stop(t + .26);
  }

  /* == 3 · Meldung und Zwischenablage ===================================== */

  var toastEl = null;
  var toastUhr = 0;

  function melde(text) {
    if (!toastEl) { return; }
    toastEl.textContent = text;
    toastEl.classList.add('da');
    window.clearTimeout(toastUhr);
    toastUhr = window.setTimeout(function () { toastEl.classList.remove('da'); }, 2800);
  }

  /** Legt Text in die Zwischenablage. Ohne sicheren Kontext ueber den alten Weg. */
  function kopiere(text, danach) {
    function rueckfall() {
      var ok = false;
      try {
        var feld = document.createElement('textarea');
        feld.value = text;
        feld.setAttribute('readonly', '');
        feld.className = 'sr-only';
        document.body.appendChild(feld);
        feld.select();
        ok = document.execCommand('copy');
        document.body.removeChild(feld);
      } catch (e) { ok = false; }
      danach(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { danach(true); }, rueckfall);
    } else {
      rueckfall();
    }
  }

  /* == 4 · Konfetti aus Knete ============================================= *
   *
   * Ein Vorrat an Teilchen auf einer festen Leinwand. Gezeichnet werden
   * vorbereitete Bildchen — Kugeln, Pillen und Sterne in den fuenf Farben,
   * jeweils mit Lichtfleck —, gestaucht in Flugrichtung, je schneller, desto
   * mehr. Die Leinwand schlaeft, wenn nichts fliegt.
   * ===================================================================== */

  /* Die Farben stehen als Merkmale in stilprobe.css, hell, Grundton und
     satt; hier werden sie nur gelesen, damit sie an einer Stelle bleiben. */
  var FARBNAMEN = ['kaugummi', 'butter', 'minze', 'immergruen', 'pfirsich'];

  function farbtoene() {
    var stil = window.getComputedStyle(document.documentElement);
    var toene = [];
    for (var i = 0; i < FARBNAMEN.length; i++) {
      var ton = [
        stil.getPropertyValue('--' + FARBNAMEN[i] + '-hell').trim(),
        stil.getPropertyValue('--' + FARBNAMEN[i]).trim(),
        stil.getPropertyValue('--' + FARBNAMEN[i] + '-satt').trim()
      ];
      /* Ohne Stylesheet gibt es keine Werte; ein leerer Farbwert liesse
         addColorStop scheitern. Dann eben kein Konfetti. */
      if (ton[0] && ton[1] && ton[2]) { toene.push(ton); }
    }
    return toene;
  }
  var KONFETTI_MAX = 220;

  var konfetti = {
    leinwand: null, ctx: null, dpr: 1, breite: 0, hoehe: 0,
    teile: [], vorrat: [], bilder: [], schmutzig: false,

    bereit: function () {
      this.leinwand = $('#konfetti');
      if (!this.leinwand || !this.leinwand.getContext) { return; }
      this.ctx = this.leinwand.getContext('2d');
      if (!this.ctx) { return; }
      this.masse();
      this.baueBilder();
      var selbst = this;
      window.addEventListener('resize', function () { selbst.masse(); });
    },

    masse: function () {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.breite = window.innerWidth;
      this.hoehe = window.innerHeight;
      this.leinwand.width = Math.round(this.breite * this.dpr);
      this.leinwand.height = Math.round(this.hoehe * this.dpr);
    },

    baueBilder: function () {
      var toene = farbtoene();
      for (var f = 0; f < toene.length; f++) {
        for (var form = 0; form < 3; form++) { this.bilder.push(bildchen(form, toene[f])); }
      }
    },

    /* Wer Bewegung abbestellt hat, bekommt kein Konfetti, wie in der
       Anwendung; die Meldung sagt dasselbe ohne Flug. */
    platze: function (x, y, anzahl, staerke) {
      if (!this.ctx || !this.bilder.length || ruhig) { return; }
      var kraft = staerke || 1;
      for (var i = 0; i < anzahl; i++) {
        var t = this.vorrat.pop() || {};
        var winkel = -Math.PI / 2 + (Math.random() - .5) * 2.6;
        var tempo = (260 + Math.random() * 420) * kraft;
        t.x = x; t.y = y;
        t.vx = Math.cos(winkel) * tempo;
        t.vy = Math.sin(winkel) * tempo;
        t.r = Math.random() * 6.283;
        t.vr = (Math.random() - .5) * 12;
        t.bild = this.bilder[Math.floor(Math.random() * this.bilder.length)];
        t.groesse = zufall(12, 26);
        t.alter = 0;
        t.leben = zufall(1.1, 1.8);
        this.teile.push(t);
      }
      while (this.teile.length > KONFETTI_MAX) { this.vorrat.push(this.teile.shift()); }
      wecke();
    },

    schritt: function (dt) {
      var ctx = this.ctx;
      if (!ctx) { return false; }
      if (!this.teile.length) {
        if (this.schmutzig) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, this.leinwand.width, this.leinwand.height);
          this.schmutzig = false;
        }
        return false;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.leinwand.width, this.leinwand.height);
      var schwere = 1150;
      for (var i = this.teile.length - 1; i >= 0; i--) {
        var t = this.teile[i];
        t.alter += dt;
        if (t.alter >= t.leben || t.y > this.hoehe + 80) {
          this.vorrat.push(t);
          this.teile.splice(i, 1);
          continue;
        }
        t.vy += schwere * dt;
        t.vx *= 1 - .8 * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.r += t.vr * dt;
        var rest = t.leben - t.alter;
        var tempo = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
        var streck = 1 + Math.min(tempo / 1600, .45);
        ctx.globalAlpha = rest < .35 ? rest / .35 : 1;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, t.x * this.dpr, t.y * this.dpr);
        ctx.rotate(Math.atan2(t.vy, t.vx));
        ctx.scale(streck, 1 / streck);
        ctx.rotate(t.r);
        ctx.drawImage(t.bild, -t.groesse / 2, -t.groesse / 2, t.groesse, t.groesse);
      }
      ctx.globalAlpha = 1;
      this.schmutzig = true;
      return true;
    }
  };

  function bildchen(form, toene) {
    var S = 48;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    var verlauf = g.createRadialGradient(S * .38, S * .3, 1, S * .5, S * .5, S * .5);
    verlauf.addColorStop(0, toene[0]);
    verlauf.addColorStop(.55, toene[1]);
    verlauf.addColorStop(1, toene[2]);
    g.fillStyle = verlauf;
    g.beginPath();
    if (form === 0) {
      g.arc(S / 2, S / 2, S * .34, 0, Math.PI * 2);
      g.fill();
    } else if (form === 1) {
      rundRechteck(g, S * .1, S * .33, S * .8, S * .34, S * .17);
      g.fill();
    } else {
      sternPfad(g, S / 2, S / 2, S * .36, S * .17);
      g.lineJoin = 'round';
      g.lineWidth = S * .1;
      g.strokeStyle = toene[1];
      g.stroke();
      g.fill();
    }
    return c;
  }

  function rundRechteck(g, x, y, b, h, r) {
    g.moveTo(x + r, y);
    g.arcTo(x + b, y, x + b, y + h, r);
    g.arcTo(x + b, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + b, y, r);
    g.closePath();
  }

  function sternPfad(g, cx, cy, aussen, innen) {
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? innen : aussen;
      var w = -Math.PI / 2 + i * Math.PI / 5;
      var x = cx + Math.cos(w) * r;
      var y = cy + Math.sin(w) * r;
      if (i === 0) { g.moveTo(x, y); } else { g.lineTo(x, y); }
    }
    g.closePath();
  }

  /** Konfetti aus der Mitte eines Elements. */
  function platzeAn(el, anzahl, staerke) {
    var r = el.getBoundingClientRect();
    konfetti.platze(r.left + r.width / 2, r.top + r.height / 2, anzahl, staerke);
  }

  /* == 5 · Die Dinge im Held ============================================== *
   *
   * Jedes Ding ist ein Knopf und ein kleiner Koerper: eine Feder fuer das
   * Stauchen und Strecken, eine fuer die Drehung, dazu die Schwerkraft fuer
   * den Sprung. Gestaucht wird volumenerhaltend um die Unterkante: wird es
   * flacher, wird es im selben Mass breiter.
   *
   * Gerechnet wird in Einheiten der viewBox (120), also unabhaengig davon,
   * wie gross das Ding gerade gezeichnet ist.
   * ===================================================================== */

  var SPRUNG = { bohr: 1, leiter: 1.5, zelt: .85, wuerfel: 1.1, waffel: .9, schalter: 1 };
  var DREHUNG = { bohr: 2.4, leiter: .8, zelt: 1, wuerfel: 3, waffel: 1.2, schalter: .6 };
  var HOEHE = { bohr: 300, leiter: 420, zelt: 260, wuerfel: 480, waffel: 560, schalter: 520 };
  var SAETZE = {
    bohr: 'Eine Bohrmaschine. Das halbe Haus wird sich freuen.',
    leiter: 'Eine Leiter. Merk Dir gut, wer sie holt.',
    zelt: 'Ein Zelt. Damit verleihst Du ein Wochenende.',
    wuerfel: 'Ein Brettspiel. Bitte mit allen Teilen zurück.',
    waffel: 'Ein Waffeleisen. Ab jetzt bist Du sonntags gefragt.'
  };

  function Ding(knopf) {
    this.knopf = knopf;
    this.g = $('.ding__feder', knopf);
    this.art = knopf.getAttribute('data-ding');
    this.y = 0; this.vy = 0;
    this.s = { x: 1, v: 0 };
    this.r = { x: 0, v: 0 };
    this.gedrueckt = false;
    this.fliegt = false;
    this.wach = false;
    this.zuletzt = 0;
  }

  Ding.prototype.druck = function () {
    if (this.gedrueckt) { return; }
    this.gedrueckt = true;
    this.zuletzt = Date.now();
    this.wach = true;
    klang('quietsch', HOEHE[this.art]);
    wecke();
  };

  Ding.prototype.los = function (hopsen) {
    if (!this.gedrueckt) { return; }
    this.gedrueckt = false;
    /* Gezaehlt wird vom Loslassen an: Der Klick folgt ihm sofort, auch nach
       einem langen Druck. Vom Druck an gezaehlt, sprang ein Ding nach mehr
       als 700 ms ein zweites Mal. */
    this.zuletzt = Date.now();
    if (hopsen) { this.hopse(); }
  };

  Ding.prototype.hopse = function () {
    this.wach = true;
    platzeAn(this.knopf, 26, this.art === 'leiter' ? 1.25 : 1);
    klang('boop', HOEHE[this.art]);
    if (ruhig) { wecke(); return; }
    this.s.v += 4.2;
    this.vy = -330 * (SPRUNG[this.art] || 1);
    this.fliegt = true;
    this.r.v += seite() * zufall(70, 130) * (DREHUNG[this.art] || 1);
    wecke();
  };

  /** Der eigentliche Klick: was das Ding bedeutet. Ein Klick ohne Druck davor
      (etwa aus einem Vorleseprogramm) bekommt den Sprung dazu. */
  Ding.prototype.klick = function () {
    if (Date.now() - this.zuletzt > 700) { this.hopse(); }
    if (this.art === 'schalter') {
      var frei = this.knopf.getAttribute('aria-pressed') !== 'true';
      this.knopf.setAttribute('aria-pressed', frei ? 'true' : 'false');
      melde(frei ? 'Verfügbar. Freund:innen sehen, dass es frei ist.' : 'Verliehen. Das Ding ist unterwegs.');
      return;
    }
    melde(SAETZE[this.art] || '');
  };

  Ding.prototype.schritt = function (dt) {
    if (!this.wach) { return false; }
    if (ruhig) {
      this.s.x = 1; this.s.v = 0; this.r.x = 0; this.r.v = 0; this.y = 0; this.vy = 0; this.fliegt = false;
    } else {
      var ziel = this.gedrueckt ? .78 : (this.fliegt ? 1.05 : 1);
      federSchritt(this.s, ziel, feder.k, feder.c, dt);
      federSchritt(this.r, 0, feder.k * .55, feder.c * .7, dt);
      if (this.fliegt) {
        this.vy += 1500 * dt;
        this.y += this.vy * dt;
        if (this.y >= 0) {
          var aufprall = this.vy;
          this.y = 0;
          this.s.v -= aufprall * .007;
          if (aufprall > 170) { this.vy = -aufprall * .3; } else { this.vy = 0; this.fliegt = false; }
        }
      }
    }
    var s = begrenze(this.s.x, .6, 1.45);
    var ruhend = !this.gedrueckt && !this.fliegt &&
      Math.abs(s - 1) < .002 && Math.abs(this.s.v) < .02 &&
      Math.abs(this.r.x) < .05 && Math.abs(this.r.v) < .2;
    if (ruhend) {
      this.g.removeAttribute('transform');
      this.wach = false;
      return false;
    }
    this.g.setAttribute('transform',
      'translate(60 ' + (108 + this.y).toFixed(2) + ') rotate(' + this.r.x.toFixed(2) + ') ' +
      'scale(' + (1 / s).toFixed(4) + ' ' + s.toFixed(4) + ') translate(-60 -108)');
    return true;
  };

  function dingeBereit() {
    $$('.ding').forEach(function (knopf) {
      var ding = new Ding(knopf);
      koerper.push(ding);
      knopf.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) { return; }
        ding.druck();
      });
      knopf.addEventListener('pointerup', function () { ding.los(true); });
      knopf.addEventListener('pointerleave', function () { ding.los(false); });
      knopf.addEventListener('pointercancel', function () { ding.los(false); });
      knopf.addEventListener('keydown', function (e) {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { ding.druck(); }
      });
      knopf.addEventListener('keyup', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { ding.los(true); }
      });
      knopf.addEventListener('click', function () { ding.klick(); });
    });
  }

  /* == 6 · Die Wortmarke ================================================== *
   *
   * Jeder Buchstabe ist ein eigener SVG-Text, dreifach geschichtet: eine
   * dunklere Kopie darunter als Sockel, eine mit dickem runden Rand fuer die
   * Pausbacken, darueber die Flaeche mit dem Lichtfleck. Wo die Buchstaben
   * stehen, wird zur Laufzeit gemessen — so passt die Wortmarke zu jeder
   * runden Schrift, die das System gerade hat. Der Punkt am Ende ist eine
   * eigene Kugel.
   * ===================================================================== */

  var WORT_FARBE = [
    'kaugummi', 'kaugummi', 'kaugummi', 'kaugummi', null,
    'butter', 'butter', 'butter', null,
    'immergruen', 'immergruen', 'immergruen'
  ];

  function svgEl(name, attribute) {
    var el = document.createElementNS(NS, name);
    for (var a in attribute) {
      if (Object.prototype.hasOwnProperty.call(attribute, a)) { el.setAttribute(a, attribute[a]); }
    }
    return el;
  }

  function Buchstabe(huelle, federG, mitte) {
    this.huelle = huelle;
    this.federG = federG;
    this.mitte = mitte;
    this.r = { x: 0, v: 0 };
    this.s = { x: 1, v: 0 };
    this.wach = false;
  }

  Buchstabe.prototype.stups = function (staerke) {
    if (ruhig) { return; }
    this.r.v += seite() * zufall(60, 110) * staerke;
    this.s.v -= 2.4 * staerke;
    this.wach = true;
    wecke();
  };

  Buchstabe.prototype.schritt = function (dt) {
    if (!this.wach) { return false; }
    federSchritt(this.r, 0, feder.k * .7, feder.c * .8, dt);
    federSchritt(this.s, 1, feder.k, feder.c, dt);
    var s = begrenze(this.s.x, .7, 1.35);
    var ruhend = Math.abs(this.r.x) < .05 && Math.abs(this.r.v) < .2 &&
      Math.abs(this.s.x - 1) < .002 && Math.abs(this.s.v) < .02;
    if (ruhend) {
      this.federG.removeAttribute('transform');
      this.wach = false;
      return false;
    }
    this.federG.setAttribute('transform',
      'translate(' + this.mitte.toFixed(1) + ' 0) rotate(' + this.r.x.toFixed(2) + ') ' +
      'scale(' + (1 / s).toFixed(4) + ' ' + s.toFixed(4) + ') translate(' + (-this.mitte).toFixed(1) + ' 0)');
    return true;
  };

  function wortmarkeBauen() {
    var svg = $('#wortmarke');
    if (!svg) { return; }
    var satz = 'Leih ich Dir';
    var SPERRE = 6;   // zusaetzlicher Abstand je Buchstabe, gegen das Verschmelzen der Raender
    var SOCKEL = 10;  // so tief liegt die dunklere Kopie
    var RAND = 26;    // Platz fuer Rand, Sockel und Filter

    /* Messen geht nur an einem gezeichneten Element. Die Klasse schaltet das
       SVG sichtbar und den Titel unsichtbar — beides im selben Zug, bevor
       der Browser zeichnet. */
    wurzel.classList.add('wortmarke-da');
    var mess = svgEl('text', { x: '0', y: '0' });
    mess.textContent = satz;
    svg.appendChild(mess);
    var breite = 0;
    var xs = [];
    var zeichen = [];
    var box = null;
    try {
      breite = mess.getComputedTextLength();
      box = mess.getBBox();
      for (var i = 0; i < satz.length; i++) {
        xs.push(mess.getStartPositionOfChar(i).x);
        zeichen.push(satz.charAt(i) === ' ' ? 0 : mess.getSubStringLength(i, 1));
      }
    } catch (e) { breite = 0; }
    svg.removeChild(mess);
    if (!breite || !box || !box.height) {
      wurzel.classList.remove('wortmarke-da');
      return;
    }

    var wort = svgEl('g', { filter: 'url(#knete)' });
    var n = 0;
    var ende = 0;
    for (var j = 0; j < satz.length; j++) {
      var c = satz.charAt(j);
      if (c === ' ') { continue; }
      var x = xs[j] + n * SPERRE;
      var huelle = svgEl('g', { 'class': 'buchstabe w-' + WORT_FARBE[j], transform: 'translate(' + x.toFixed(1) + ' 0)' });
      var wippe = svgEl('g', { 'class': 'buchstabe__wippe' });
      var federG = svgEl('g', { 'class': 'buchstabe__feder' });
      var schichten = [['b-tiefe', SOCKEL], ['b-rand', 0], ['b-flaeche', 0]];
      for (var k = 0; k < schichten.length; k++) {
        var t = svgEl('text', { 'class': schichten[k][0], x: '0', y: String(schichten[k][1]) });
        t.textContent = c;
        federG.appendChild(t);
      }
      wippe.appendChild(federG);
      huelle.appendChild(wippe);
      wort.appendChild(huelle);
      buchstabeVerdrahten(huelle, new Buchstabe(huelle, federG, zeichen[j] / 2));
      ende = x + zeichen[j];
      n++;
    }

    /* Der Punkt: eine Kugel auf der Grundlinie, mit eigenem Sockel. */
    var r = Math.max(12, box.height * .1);
    var px = ende + SPERRE + r * 1.3;
    var punkt = svgEl('g', { 'class': 'buchstabe w-pfirsich', transform: 'translate(' + px.toFixed(1) + ' 0)' });
    var pWippe = svgEl('g', { 'class': 'buchstabe__wippe' });
    var pFeder = svgEl('g', { 'class': 'buchstabe__feder' });
    pFeder.appendChild(svgEl('circle', { 'class': 'punkt__tiefe', cx: '0', cy: String(-r + SOCKEL), r: String(r) }));
    pFeder.appendChild(svgEl('circle', { 'class': 'punkt__kugel', cx: '0', cy: String(-r), r: String(r) }));
    pWippe.appendChild(pFeder);
    punkt.appendChild(pWippe);
    wort.appendChild(punkt);
    buchstabeVerdrahten(punkt, new Buchstabe(punkt, pFeder, 0));

    svg.appendChild(wort);
    var links = box.x - RAND;
    var oben = box.y - RAND;
    var b = (px + r) - links + RAND;
    var h = box.height + SOCKEL + RAND * 2;
    svg.setAttribute('viewBox', links.toFixed(1) + ' ' + oben.toFixed(1) + ' ' + b.toFixed(1) + ' ' + h.toFixed(1));
  }

  function buchstabeVerdrahten(huelle, buchstabe) {
    koerper.push(buchstabe);
    huelle.addEventListener('pointerenter', function () { buchstabe.stups(.6); });
    huelle.addEventListener('click', function () {
      buchstabe.stups(1.3);
      platzeAn(huelle, 18, .9);
      klang('plopp', zufall(520, 880));
    });
  }

  /* == 7 · Bauteile ======================================================= */

  function knoepfeBereit() {
    $$('[data-ton]').forEach(function (k) {
      k.addEventListener('click', function () { klang('boop', zufall(420, 640)); });
    });
    var merk = $('#merkKnopf');
    if (merk) {
      merk.addEventListener('click', function () {
        var an = merk.getAttribute('aria-pressed') !== 'true';
        merk.setAttribute('aria-pressed', an ? 'true' : 'false');
        klang(an ? 'quietsch' : 'boop', 480);
      });
    }
  }

  function tonSetzen(an) {
    ton.an = an;
    $$('#tonSchalter, #tonSchalter2').forEach(function (s) { s.setAttribute('aria-checked', an ? 'true' : 'false'); });
    if (an) {
      tonKontext();
      klang('boop', 660);
    }
  }

  /* Alle Schalter: umlegen, quetschen, und was der einzelne bedeutet. */
  function schalterBereit() {
    $$('[role="switch"]').forEach(function (s) {
      s.addEventListener('click', function () {
        var an = s.getAttribute('aria-checked') !== 'true';
        einmal(s, 'quetscht');
        if (s.id === 'tonSchalter' || s.id === 'tonSchalter2') {
          tonSetzen(an);
          return;
        }
        s.setAttribute('aria-checked', an ? 'true' : 'false');
        klang('boop', an ? 620 : 440);
        var eintrag = s.closest ? s.closest('.eintrag') : null;
        if (eintrag) { eintragUmlegen(eintrag, an); }
        if (s.id === 'preisSchalter') { preisUmlegen(an); }
      });
    });
  }

  function reglerBereit() {
    var weich = $('#weichheit');
    var weichWert = $('#weichheitWert');
    if (weich) {
      weich.addEventListener('input', function () {
        var v = Number(weich.value);
        wurzel.style.setProperty('--weich', (v / 100).toFixed(2));
        if (weichWert) { weichWert.textContent = v + ' %'; }
      });
    }
    var fed = $('#federung');
    var fedWert = $('#federungWert');
    if (fed) {
      fed.addEventListener('input', function () {
        var v = Number(fed.value);
        feder.k = 150 + v * 2.6;
        feder.c = 21 - v * .13;
        if (fedWert) { fedWert.textContent = v + ' %'; }
      });
    }
  }

  /* -- Gelee --------------------------------------------------------------- */

  var STUFEN = ['Erste Runde', 'Kurzer Draht', 'Dachboden mit Auftrag', 'Ehrenamt für alles',
                'Kreisverleihamt', 'Wandelnde Leihstation'];

  var gelee = {
    el: null, fuellung: null, satz: null,
    w: { x: 0, v: 0 }, ziel: 0, stufe: 1, voll: false, wach: false,

    bereit: function () {
      this.el = $('#gelee');
      this.fuellung = $('#geleeFuellung');
      this.satz = $('#stufeSatz');
      if (!this.el || !this.fuellung) { return; }
      koerper.push(this);
      var selbst = this;
      var plus = $('#geleePlus');
      var nullK = $('#geleeNull');
      if (plus) { plus.addEventListener('click', function () { selbst.setze(selbst.ziel + 25); klang('boop', 500 + selbst.ziel * 3); }); }
      if (nullK) { nullK.addEventListener('click', function () { selbst.voll = false; selbst.setze(0); klang('boop', 360); }); }
      this.beschrifte();
      /* Wird der Balken zum ersten Mal sichtbar, fuellt er sich vor. */
      if ('IntersectionObserver' in window) {
        var beob = new IntersectionObserver(function (eintraege) {
          if (eintraege[0].isIntersecting) {
            beob.disconnect();
            if (selbst.ziel === 0) { selbst.setze(75); }
          }
        }, { threshold: .6 });
        beob.observe(this.el);
      }
    },

    naechste: function () { return STUFEN[this.stufe % STUFEN.length]; },

    beschrifte: function () {
      var runden = Math.round(this.ziel / 25);
      var name = this.naechste();
      this.satz.textContent = 'Auf dem Weg zu „' + name + '“';
      this.el.setAttribute('aria-valuenow', String(Math.round(this.ziel)));
      this.el.setAttribute('aria-valuetext', runden + ' von 4 Runden bis „' + name + '“');
    },

    setze: function (wert) {
      this.ziel = begrenze(wert, 0, 100);
      if (this.ziel < 100) { this.voll = false; }
      this.beschrifte();
      this.wach = true;
      wecke();
    },

    feiern: function () {
      var r = this.fuellung.getBoundingClientRect();
      konfetti.platze(r.right - 12, r.top + r.height / 2, 34, 1.1);
      klang('plopp', 880);
      melde('Stufe ' + (this.stufe + 1) + ': ' + this.naechste() + '!');
      var selbst = this;
      window.setTimeout(function () {
        /* Nach der letzten Stufe geht es mit der zweiten weiter: Die erste
           ist die, mit der man anfaengt, sie wird nicht gefeiert. */
        selbst.stufe = selbst.stufe + 1 < STUFEN.length ? selbst.stufe + 1 : 1;
        selbst.setze(0);
      }, 1100);
    },

    schritt: function (dt) {
      if (!this.wach) { return false; }
      if (ruhig) { this.w.x = this.ziel; this.w.v = 0; } else { federSchritt(this.w, this.ziel, feder.k * .55, feder.c * .65, dt); }
      var x = begrenze(this.w.x, 0, 104);
      var v = this.w.v;
      this.fuellung.style.width = x.toFixed(2) + '%';
      this.fuellung.style.transform = 'scaleY(' + (1 - begrenze(v / 900, -.16, .16)).toFixed(3) + ') skewX(' + begrenze(-v / 45, -9, 9).toFixed(2) + 'deg)';
      if (this.ziel >= 100 && !this.voll && this.w.x >= 99) { this.voll = true; this.feiern(); }
      var ruhend = Math.abs(this.w.x - this.ziel) < .05 && Math.abs(v) < .05;
      if (ruhend) {
        this.fuellung.style.transform = '';
        this.wach = false;
        return false;
      }
      return true;
    }
  };

  /* -- Segmente ------------------------------------------------------------ */

  var SEGMENT_SATZ = [
    'Diesen Link geben Deine Freunde weiter. Er zeigt die Liste, ändern lässt sich damit nichts.',
    'Dieser Link ist Dein Zugang. Gib ihn niemandem und speichere ihn als Lesezeichen.'
  ];

  function segmentBereit() {
    var seg = $('#segment');
    if (!seg) { return; }
    var wahlen = $$('.segment__wahl', seg);
    var knauf = $('.segment__knauf', seg);
    var satz = $('#segmentSatz');

    function waehle(i, fokus) {
      if (fokus) { wahlen[i].focus(); }
      if (String(i) === seg.getAttribute('data-wahl')) { return; }
      seg.setAttribute('data-wahl', String(i));
      wahlen.forEach(function (w, j) {
        w.setAttribute('aria-checked', j === i ? 'true' : 'false');
        w.tabIndex = j === i ? 0 : -1;
      });
      if (satz) { satz.textContent = SEGMENT_SATZ[i]; }
      einmal(knauf, 'dehnt');
      klang('boop', i ? 560 : 440);
    }

    wahlen.forEach(function (w, i) {
      w.addEventListener('click', function () { waehle(i, false); });
      w.addEventListener('keydown', function (e) {
        var ziel = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { ziel = (i + 1) % wahlen.length; }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { ziel = (i + wahlen.length - 1) % wahlen.length; }
        else if (e.key === 'Home') { ziel = 0; }
        else if (e.key === 'End') { ziel = wahlen.length - 1; }
        if (ziel >= 0) { e.preventDefault(); waehle(ziel, true); }
      });
    });
  }

  /* -- Zaehler und Klumpen ------------------------------------------------- */

  function zaehlerBereit() {
    var wert = $('#zaehlerWert');
    var satz = $('#zaehlerSatz');
    if (!wert || !satz) { return; }
    var tage = 3;
    $$('[data-schritt]').forEach(function (k) {
      k.addEventListener('click', function () {
        tage = begrenze(tage + Number(k.getAttribute('data-schritt')), 0, 60);
        wert.textContent = String(tage);
        einmal(wert, 'huepft');
        satz.textContent = tageSatz(tage);
        klang('boop', 380 + tage * 7);
      });
    });
  }

  function tageSatz(n) {
    if (n === 0) { return 'Die Leiter ist wieder da.'; }
    var s = 'Die Leiter ist ' + (n === 1 ? 'seit einem Tag' : 'seit ' + n + ' Tagen') + ' unterwegs.';
    if (n >= 14) { s += ' Ein kurzer Anruf wäre kein Drama.'; }
    return s;
  }

  var KLUMPEN_FARBEN = ['k-kaugummi', 'k-butter', 'k-minze', 'k-immergruen', 'k-pfirsich'];
  var NAME_LEER = 'Aus Deinem Namen wird ein Klumpen. Mit der Eingabetaste formst Du ihn fertig.';

  function klumpenBereit() {
    var feld = $('#nameFeld');
    var klumpen = $('#klumpen');
    var satz = $('#nameSatz');
    if (!feld || !klumpen || !satz) { return; }
    feld.addEventListener('input', function () {
      var name = feld.value.replace(/^\s+|\s+$/g, '');
      klumpen.textContent = name ? name.charAt(0).toUpperCase() : '?';
      var h = 0;
      for (var i = 0; i < name.length; i++) { h = (h * 31 + name.charCodeAt(i)) % 9973; }
      KLUMPEN_FARBEN.forEach(function (k) { klumpen.classList.remove(k); });
      klumpen.classList.add(KLUMPEN_FARBEN[h % KLUMPEN_FARBEN.length]);
      satz.textContent = name ? 'Liste von ' + name : NAME_LEER;
      einmal(klumpen, 'huepft');
    });
    feld.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') { return; }
      e.preventDefault();
      var name = feld.value.replace(/^\s+|\s+$/g, '');
      if (!name) { return; }
      satz.textContent = 'Hallo ' + name + '. Dein Klumpen ist fertig geformt.';
      einmal(klumpen, 'huepft');
      platzeAn(klumpen, 28);
      klang('plopp', 760);
    });
  }

  /* -- Die Leihliste ------------------------------------------------------- */

  function eintragUmlegen(eintrag, frei) {
    var name = eintrag.getAttribute('data-name');
    eintrag.classList.toggle('ist-verliehen', !frei);
    var zustand = $('.zustand', eintrag);
    if (zustand) { zustand.textContent = frei ? 'Verfügbar' : 'Verliehen'; }
    if (frei) {
      melde(name + ' ist wieder da.');
      platzeAn(eintrag, 22, .8);
    } else {
      melde(name + ' ist unterwegs. Gute Reise.');
    }
    freiZaehlen();
  }

  function freiZaehlen() {
    var el = $('#freiZahl');
    if (!el) { return; }
    var n = $$('.eintrag').filter(function (e) { return !e.classList.contains('ist-verliehen'); }).length;
    el.textContent = n + ' gerade frei';
  }

  function anfragenBereit() {
    $$('[data-anfrage]').forEach(function (k) {
      k.addEventListener('click', function () {
        var text = 'Hallo Mia, ich möchte ' + k.getAttribute('data-anfrage') + ' ausleihen. Passt das bei Dir?';
        kopiere(text, function (ok) {
          melde(ok ? 'Anfragetext kopiert.' : 'Kopieren nicht möglich. Bitte den Text von Hand markieren.');
        });
        klang('boop', 600);
      });
    });
  }

  /* -- Farben und Preis ---------------------------------------------------- */

  function farbenBereit() {
    $$('.farbe').forEach(function (k) {
      k.addEventListener('click', function () {
        var hex = k.getAttribute('data-hex');
        var name = $('.farbe__name', k).textContent;
        einmal($('.farbe__klecks', k), 'huepft');
        klang('plopp', 640);
        kopiere(hex, function (ok) {
          melde(ok ? name + ' ' + hex + ' liegt in der Zwischenablage.' : 'Kopieren nicht möglich. ' + name + ' ist ' + hex + '.');
        });
      });
    });
  }

  function preisUmlegen(jaehrlich) {
    var je = $('#preisJe');
    if (je) { je.textContent = jaehrlich ? 'je Jahr' : 'je Monat'; }
    var monat = $('#preisMonat');
    var jahr = $('#preisJahr');
    if (monat) { monat.classList.toggle('ist-aktiv', !jaehrlich); }
    if (jahr) { jahr.classList.toggle('ist-aktiv', jaehrlich); }
    einmal($('#preisZahl'), 'huepft');
  }

  /* -- Fragen: Die Klappe federt auf ---------------------------------------- */

  function Frage(knopf) {
    this.knopf = knopf;
    this.feld = document.getElementById(knopf.getAttribute('aria-controls'));
    this.h = { x: 0, v: 0 };
    this.ziel = 0;
    this.offen = false;
    this.wach = false;
  }

  Frage.prototype.umschalten = function () {
    var feld = this.feld;
    this.offen = !this.offen;
    this.knopf.setAttribute('aria-expanded', this.offen ? 'true' : 'false');
    klang(this.offen ? 'plopp' : 'boop', this.offen ? 700 : 420);
    if (ruhig) {
      feld.hidden = !this.offen;
      feld.style.height = '';
      return;
    }
    if (this.offen) {
      feld.hidden = false;
      if (!this.wach) { this.h.x = 0; this.h.v = 0; }
    } else if (!this.wach) {
      this.h.x = feld.offsetHeight;
      this.h.v = 0;
    }
    feld.style.height = this.h.x.toFixed(1) + 'px';
    this.wach = true;
    wecke();
  };

  Frage.prototype.schritt = function (dt) {
    if (!this.wach) { return false; }
    this.ziel = this.offen ? this.feld.scrollHeight : 0;
    federSchritt(this.h, this.ziel, feder.k * .6, feder.c * .95, dt);
    this.feld.style.height = Math.max(0, this.h.x).toFixed(1) + 'px';
    var ruhend = Math.abs(this.h.x - this.ziel) < .5 && Math.abs(this.h.v) < 4;
    if (ruhend) {
      this.wach = false;
      this.feld.style.height = '';
      if (!this.offen) { this.feld.hidden = true; }
      return false;
    }
    return true;
  };

  function fragenBereit() {
    $$('.frage__knopf').forEach(function (knopf) {
      var frage = new Frage(knopf);
      if (!frage.feld) { return; }
      koerper.push(frage);
      knopf.addEventListener('click', function () { frage.umschalten(); });
    });
  }

  /* -- Auftritt ------------------------------------------------------------ */

  function auftrittBereit() {
    var teile = $$('.zeige');
    if (!('IntersectionObserver' in window)) {
      teile.forEach(function (t) { t.classList.add('da'); });
      return;
    }
    var beob = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('da');
          beob.unobserve(e.target);
        }
      });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    teile.forEach(function (t) { beob.observe(t); });
  }

  /* == 8 · Start ========================================================== */

  function start() {
    ruheAnwenden();
    if (ruhigAbfrage) {
      if (ruhigAbfrage.addEventListener) { ruhigAbfrage.addEventListener('change', ruheAnwenden); }
      else if (ruhigAbfrage.addListener) { ruhigAbfrage.addListener(ruheAnwenden); }
    }
    window.addEventListener('storage', function (e) { if (e.key === 'lid.ruhig') { ruheAnwenden(); } });

    toastEl = $('#toast');
    konfetti.bereit();
    koerper.push(konfetti);
    wortmarkeBauen();
    dingeBereit();
    knoepfeBereit();
    schalterBereit();
    reglerBereit();
    gelee.bereit();
    segmentBereit();
    zaehlerBereit();
    klumpenBereit();
    anfragenBereit();
    farbenBereit();
    fragenBereit();
    auftrittBereit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
