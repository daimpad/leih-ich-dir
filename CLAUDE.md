# LeihIchDir · Arbeitsgrundlage

Diese Datei liest eine neue Sitzung zuerst. Sie sagt, was feststeht, wo etwas
steht und wie geprüft wird — damit nichts davon aus README, CONTRIBUTING und
Quelltext neu zusammengesucht werden muss. Die Begründungen stehen dort;
hier stehen die Regeln.

## Was das ist

Eine Leihliste: verschlüsselt im Browser, auf einem Server abgelegt, der sie
nicht lesen kann, geteilt über Links. Eine Superliste: eine Liste der
Leihlisten, sie bündelt die Ansehen-Links mehrerer Freunde. Keine Konten,
keine Datenbank, kein Framework, kein Bauschritt. Betrieb: leihichdir.de.

## Was feststeht

- **Backend** nur pures PHP, Flat File unter `data/`. Der Server ist ein
  dummer Speicher für Chiffrat und prüft Schreibrechte, mehr nicht. Nichts,
  was Klartext auf den Server brächte.
- **Frontend** HTML, CSS, Vanilla JS in **ES5**: `var`, `function`,
  `Promise`. Keine Pfeilfunktionen, kein `let`/`const`, kein `async`, keine
  Schablonenzeichenketten. Die GitHub-Action prüft das mit `grep` über jede
  `.js`-Datei — auch unter `tools/`. Die Browsertests (`.mjs`) sind ausgenommen.
- **CSP** ist strikt: keine eingebetteten `style`-Angaben, kein
  `<script>`-Inhalt, keine fremden Server. Ein `style="…"` wird stumm
  verworfen und fällt lokal nicht auf.
- **Schlüssel im Fragment** (`#e=id.key.token`, `#v=id.key`, `#k=id.key.token`).
  Das Fragment verlässt den Browser nie. `#v` ist die einzige Form ohne Token.
- **Ein Stylesheet**, `style.css`. Farben, Abstände, Radien nur als Merkmale
  in `:root`, hell und dunkel. Keine Verläufe, keine Emoji; Zeichen sind
  `<symbol>` in `index.html`, 64×64, Strich 4–5, eckige Enden.
- **Sichtbare Texte** stehen in beiden Wörterbüchern (`I18N.de`, `I18N.en`)
  und werden über `t()` ausgegeben. Der deutsche Ersatztext im HTML muss
  dem Wörterbuch gleichen (`tools/fallback-check.js`); Werte mit `{name}`
  sind Vorlagen und dürfen abweichen.
- **Nutzerinhalte** nur über `textContent` ins DOM. Bereiche mit
  entschlüsseltem Inhalt tragen `translate="no"`.
- **Sprache der Texte:** Deutsch, Du-Form, Freund:innen wo gemischt. Keine
  Werbewörter — eine benannte Ausnahme: *Superliste* ist ein Name. Deutsches
  Wort vor Anglizismus. Ein Ausrufezeichen nur, wo es etwas kostet.
- **Kommentare** auf Deutsch, sie erklären das *Warum*. Umlaute in
  Kommentaren als `ae`, `oe`, `ue`; in sichtbaren Texten echt.
- **Namen im Quelltext:** Die Oberfläche sagt „Superliste", der Quelltext
  sagt `kreis`/`circle` — Zustandsobjekt, Wörterbuch-Namensraum, das Präfix
  `#k=` und `kind: 'circle'` im Dokument. Die beiden letzten stehen in jedem
  verschickten Link und jedem gespeicherten Dokument und sind nicht frei
  wählbar. Begründung im Kopf von Abschnitt 10a in `app.js`. Nicht umbenennen.
- **Der Server sieht nie** `kind`: Er kann Leihliste und Superliste nicht
  unterscheiden. Alles, was die beiden verschieden behandeln soll, muss im
  Browser geschehen.

## Wo etwas steht

`app.js` (~5000 Zeilen) ist in nummerierte Abschnitte geteilt. Die Karte mit
den aktuellen Zeilen liefert:

    grep -n "^   \* [0-9]\+[a-z]* · " app.js

Abschnitte: 0 Konfiguration · 1 Helfer · 2 Kryptografie · 3 i18n (beide
Wörterbücher) · 4 Katalog · 5 Speicher-Adapter · 6 Zustand · 7 Links und
Navigation · 8 Rendering · 9 Mutationen und Persistenz · 9a Das Spielerische ·
10 Laden, Anlegen, Aktualisieren · 10a Die Superliste · 11 Zwischenablage ·
12 Spracheingabe und KI · 13 Ereignisse (`bindEvents()` und sieben Binder je
Ansicht) · 14 Router und Start · 14a Einstellungsseite.

Einen Abschnitt liest man mit `sed -n A,Bp app.js`, nicht die ganze Datei.

Sonst: `api.php` (Schnittstelle, Drosselung, Sperren), `index.html`
(Oberfläche und Symbolsatz), `einstellungen.html` (eigener Einstieg
`initSettings()`, erreicht `bindEvents()` nie), `tests/api-test.php`,
`tests/e2e/` (Browsertests, `README.md` daneben), `tools/` (Prüfwerkzeuge,
`purge.php`, Schriften).

## Wie geprüft wird

    tools/pruefe.sh                         # alles Statische, eine Zeile je Prüfung
    php -S 127.0.0.1:8099                   # Fenster 1
    node tests/e2e/lauf.mjs kreis kopfmine  # Fenster 2: nur betroffene Suiten
    node tests/e2e/lauf.mjs                 # vor dem Push: alle, rund sechs Minuten

Die Batterie im Hintergrund starten und *einmal* am Ende lesen — nicht
zwischendurch nachsehen. `lauf.mjs` setzt vor jeder Suite `data/throttle`
zurück; wer eine Suite einzeln startet, macht das selbst (`rm -rf
data/throttle`), sonst antwortet `api.php` ab der zwanzigsten Liste mit 429.

Fällt eine Zusicherung: erst nachsehen, ob sie noch gilt. Abgelöste
Anforderungen werden nachgezogen, nicht repariert.

## Wie gearbeitet wird

- Commit-Nachrichten auf Deutsch, Betreff ohne Umlaute, ein langer Rumpf mit
  dem *Warum* — so wie die Geschichte es vormacht (`git log -3`).
- Pull Requests gegen `main`, gemergt als Merge-Commit. Nach einem Merge den
  Arbeitszweig mit `git merge --ff-only origin/main` nachziehen, nie
  umschreiben.
- Ein Thema je PR. Eine PR, die etwas umbaut, ändert kein Verhalten; eine,
  die Verhalten ändert, baut nichts um.
- Bevor etwas als „Fund" gilt, ist es nachgestellt: im Browser, mit einem
  zweiten Prozess, mit einem absichtlich verstellten Wert. Eine Wächterin,
  die noch nie gefallen ist, hat noch nichts bewiesen.
