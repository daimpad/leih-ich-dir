# Mitwirken

Beiträge sind willkommen: Fehlerberichte, Übersetzungen, Gestaltung, Code.
Deutsch und Englisch sind beide in Ordnung, in Issues wie in Pull Requests.

## Leitlinien des Projekts

Vor größeren Änderungen hilft ein Blick auf diese vier Festlegungen. Sie sind
der Grund für viele Entwurfsentscheidungen im Code:

1. **Keine Abhängigkeiten.** Kein Framework, kein Paketmanager, kein
   Build-Schritt. Was im Repository liegt, läuft unverändert auf dem Server.
2. **Der Server bleibt dumm.** Er speichert Chiffrat und prüft Schreibrechte,
   mehr nicht. Jede Funktion, die Klartext auf den Server brächte, widerspricht
   dem Kern des Projekts.
3. **Flat File statt Datenbank.** Die Anwendung soll auf einfachstem
   Shared Hosting laufen.
4. **Minimalismus.** Eine neue Funktion muss mehr Nutzen stiften, als sie
   Oberfläche und Wartungsaufwand kostet. Im Zweifel: erst ein Issue eröffnen.
5. **Das Erscheinungsbild gehört dem Projekt.** Es steht vollständig in
   `style.css`. Farben, Abstände und Radien stehen als Merkmale in `:root`;
   wer das Aussehen ändert, ändert dort und nirgends sonst.

## Ablauf

1. Repository forken und einen Branch anlegen (`feature/…`, `fix/…`).
2. Änderung umsetzen, lokal prüfen (siehe unten).
3. Pull Request gegen `main` stellen, mit kurzer Beschreibung des *Warum*.
   Bei Änderungen an der Oberfläche gern ein Bildschirmfoto beilegen.

Lokal testen:

```bash
php -S localhost:8000                                # Anwendung starten
find . -name '*.php' -print0 | xargs -0 -n1 php -l   # PHP-Syntax
node --check app.js                                  # JavaScript-Syntax
php tests/api-test.php                               # Funktionstest des Backends
node tools/i18n-check.js                             # beide Wörterbücher vollständig
```

Alle vier Prüfungen laufen als GitHub-Action; ein Pull Request sollte sie
bestehen. Der Funktionstest deckt bislang nur das Backend ab. Änderungen an der
Oberfläche bitte zusätzlich manuell durchspielen: Liste anlegen, Gegenstand
hinzufügen, Status wechseln, Ansehen-Link in einem zweiten Browserprofil öffnen,
Sprache umschalten. Ein automatisierter Browsertest wäre ein lohnender Beitrag,
sofern er die Anwendung selbst abhängigkeitsfrei lässt.

## Code-Stil

**Allgemein**

- Einrückung mit 4 Leerzeichen (PHP) bzw. 2 Leerzeichen (HTML, CSS, JS).
- Kommentare erklären das *Warum*, nicht das *Was*; sie sind auf Deutsch gehalten.
- Keine externen Ressourcen (Schriften, CDNs, Analytik). Die Content Security
  Policy in `index.html` und `.htaccess` würde sie ohnehin blockieren.

**PHP**, angelehnt an PSR-12

- `declare(strict_types=1)` in jeder Datei, Typangaben an allen Signaturen.
- Jede Eingabe wird validiert, bevor sie einen Dateipfad berührt.
- Schreibzugriffe laufen über `flock`; Geheimnisse werden mit `hash_equals`
  verglichen.

**JavaScript**

- Kein Transpiler: ES5-verträgliche Syntax plus `Promise`, `fetch` und
  `crypto.subtle`. Keine Module, kein Bundling.
- Alles innerhalb der bestehenden IIFE, `'use strict'` bleibt.
- Nutzerinhalte ausschließlich über `textContent` in das DOM schreiben, nie
  über `innerHTML`.
- Sichtbare Zeichenketten gehören in beide Wörterbücher (`I18N.de` und
  `I18N.en`) und werden über `t()` ausgegeben.

**CSS**

- Alles steht in `style.css`, gegliedert nach Abschnitten. Keine zweite
  Stylesheet-Datei, kein Baukasten von außen.
- Keine Farb-, Schrift- oder Abstandswerte im Rumpf der Datei, sondern die
  Merkmale aus `:root` benutzen. Gibt es für etwas kein Merkmal, ist das ein
  Hinweis darauf, dass der Baustein woanders hingehört.
- Jede Farbe ist auch für dunkel zu setzen, in beiden Blöcken: unter
  `prefers-color-scheme` **und** unter `[data-theme="dark"]`.
- Bestehende Bausteine (`.btn`, `.card`, `.input`, `.chip`, `.note`, `.fold`,
  `.itemrow` …) vor neuen Klassen bevorzugen.
- Formsprache: runde Ecken aus `--r-*`, weiche Schatten aus `--shadow*`, keine
  Verläufe. Grün heißt frei und führt die Handlung, Bernstein heißt verliehen,
  Rot bleibt dem Zerstörenden vorbehalten.
- **Keine eingebetteten `style`-Angaben.** Die Sicherheitsrichtlinie erlaubt
  nur `style-src 'self'`; der Browser verwirft sie stillschweigend.
- Layout mit Flexbox und Grid, mobile Breite ab 320 px berücksichtigen.

**Zeichen und Schriften**

- Keine Emoji, nirgends. Zeichen liegen als `<symbol>` in `index.html`, sind
  einfarbig und folgen über `currentColor` der Schriftfarbe.
- Ein neues Motiv hält sich an die vorhandene Bauart: Raster 64 × 64,
  Strichstärke 4 bis 5, eckige Enden, keine Füllung außer `currentColor`.
- Schriften werden selbst ausgeliefert. Neue Schnitte entstehen über
  `tools/build-fonts.py`, nie über einen Verweis auf Google Fonts.

## Sprache der Texte

Sichtbare Texte folgen diesen Regeln:

- Kurze Hauptsätze, konkret vor allgemein.
- Keine Gedankenstriche im Fließtext, dort steht ein Komma. Bei Paaren aus
  Label und Wert steht ein Mittelpunkt.
- Keine Ausrufezeichen. Drei eng gefasste Ausnahmen: die Überschrift des
  Zugangskastens einer Liste, weil ein verlorener Bearbeiten-Link die Liste
  kostet; die Klappenzeilen der höchsten Feierstufe, also der Stufenaufstieg
  und die laut gefeierte Heimkehr; und der erste Satz des Aufrufs auf der
  Startseite. Von den rund dreißig Feiertexten tragen zwei eines. Der
  Zugangskasten des Freundeskreises hat bewusst keines bekommen, und
  Einstellungen, Hinweise, Abzeichentexte, Rundenbuch und jede Fehlermeldung
  bleiben ohne. Ein Ausrufezeichen, das überall steht, ruft nirgends mehr.
- Deutsches Wort vor Anglizismus, wo es eines gibt: Schaltfläche statt Button.
- Keine Werbewörter.

Dasselbe gilt für Kommentare im Code, Commit-Nachrichten und
Pull-Request-Beschreibungen.

## Übersetzungen

Eine weitere Sprache braucht genau zwei Schritte in `app.js`:

1. Im Objekt `I18N` einen Block mit dem Sprachkürzel anlegen und alle
   Schlüssel aus `I18N.de` übersetzen.
2. Im Katalog `CATALOG` je Gegenstand ein Feld mit demselben Kürzel ergänzen.

Dazu eine Schaltfläche in der Sprachumschaltung in `index.html`. Fehlt ein
Schlüssel, greift automatisch die deutsche Fassung.

## Sicherheitslücken melden

Sicherheitsrelevante Funde bitte **nicht** als öffentliches Issue, sondern über
den Punkt *Security → Report a vulnerability* im Repository oder direkt an die
im Profil hinterlegte Adresse. Eine Rückmeldung erfolgt so zügig wie möglich.

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE)
veröffentlicht wird.
