# Vorschaubild und Zeichen neu erzeugen

`assets/pics/og.png` ist das Bild, das Messenger und soziale Netze zeigen,
wenn jemand einen Link auf leihichdir.de einfügt. Es liegt fertig im
Projekt, damit die Anwendung ohne Bauschritt auskommt.

Die Vorlage ist `tools/og-vorlage.html`. Sie zieht Farben, Schrift und Knete
aus `style.css` und `assets/fonts/`, damit das Bild dieselbe Sprache spricht
wie die Seite. Wortmarke, Filter und die Dinge schreibt sie nicht ab: Drei
Platzhalter darin füllt `tools/bilder.mjs` beim Ablichten aus der laufenden
Startseite. Allein im Browser geöffnet, bleiben sie leer.

Alles neu erzeugen, über einen lokalen Server — nur so laden die Schriften:

```sh
php -S 127.0.0.1:8099        # in der Wurzel, Fenster 1
node tools/bilder.mjs         # Fenster 2
```

Das schreibt `assets/pics/og.png` (1200 × 630), die Zeichen in
`assets/favicon/` und die Kopie von `favicon.ico` in der Wurzel. Playwright
findet das Werkzeug über `tests/e2e/hilfe.mjs`, mit denselben
Umgebungsvariablen wie die Browsertests.

1200 × 630 ist das Maß, das die verbreiteten Dienste erwarten. Wer das
Seitenverhältnis ändert, muss die Angaben `og:image:width` und
`og:image:height` in den Seitenköpfen mitziehen, und wer das Bild ändert,
den Text in `og:image:alt`.

## Die Zeichen der Anwendung

Quelle aller Zeichen ist die Bildmarke `assets/pics/logo.svg`: das L der
Wortmarke und ihre Kugel aus Knete, auf einem Minzkissen. Das L ist ein Pfad
und keine Schrift, denn ein Bild im `<img>` erreicht die Schriften der Seite
nicht. `bilder.mjs` lichtet sie in allen Größen ab; `favicon.svg` ist eine
Kopie, `favicon.ico` trägt drei PNG-Bilder (16, 32, 48), das Apple-Symbol
einen Grund in Minzgrün, weil iOS Durchsichtiges schwarz füllt.

Zwei Dinge sind dabei zu beachten:

- `favicon.ico` liegt **zusätzlich** im Wurzelverzeichnis. Browser und fremde
  Abholer fordern sie dort blind an, ohne auf den `<link>` zu sehen.
  `bilder.mjs` zieht die Kopie mit.
- `site.webmanifest` liegt im Wurzelverzeichnis, nicht bei den Symbolen. Die
  Adressen darin lösen relativ zum Ort des Manifests auf; aus
  `assets/favicon/` heraus zeigte `start_url` in dieses Verzeichnis statt auf
  die Anwendung.

Die früheren Zeichen, die Pfote und das Katzenlogo liegen in
`archiv/alter-stil/`.

## Warum die Vorlagen hier liegen

`tools/` ist über `.htaccess` mit 404 gesperrt, die Vorlagen sind also nur
über einen lokalen Server erreichbar. Das ist Absicht: `og-vorlage.html`
trägt dieselbe Wortmarke und denselben Satz wie die Startseite und wäre
sonst eine indexierbare Dublette. Beide Vorlagen tragen zusätzlich ein
`noindex` im Kopf, weil auf GitHub Pages, unter nginx und unter `php -S`
keine `.htaccess` gilt; dort schließt sie das Pages-Deployment ohnehin aus.

Sie dürfen deshalb nie nach `assets/` oder ins Wurzelverzeichnis wandern.
