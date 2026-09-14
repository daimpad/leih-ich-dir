# Vorschaubild und Zeichen neu erzeugen

`assets/pics/og.png` ist das Bild, das Messenger und soziale Netze zeigen,
wenn jemand einen Link auf leihichdir.de einfügt. Es liegt fertig im
Projekt, damit die Anwendung ohne Bauschritt auskommt.

Die Vorlage ist `tools/og-vorlage.html`. Sie zieht Farben und Schriften aus
`style.css` und `assets/fonts/`, damit das Bild dieselbe Sprache spricht wie
die Seite.

Zum Neuerzeugen die Vorlage über einen lokalen Server öffnen — nur so laden
die Schriften — und auf 1200 × 630 Punkte ablichten:

```sh
php -S 127.0.0.1:8099 -t .
```

Dann mit einem Browser `http://127.0.0.1:8099/tools/og-vorlage.html`
aufrufen und den sichtbaren Bereich bei genau 1200 × 630 als PNG sichern.
Mit Playwright:

```js
const p = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('http://127.0.0.1:8099/tools/og-vorlage.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: 'assets/pics/og.png' });
```

1200 × 630 ist das Maß, das die verbreiteten Dienste erwarten. Wer das
Seitenverhältnis ändert, muss die Angaben `og:image:width` und
`og:image:height` in den Seitenköpfen mitziehen.

## Die Rasterzeichen

`assets/pics/favicon.svg` ist die Vorlage für alle Zeichen. Browser, die SVG
als Favicon lesen, nehmen sie direkt; für die übrigen liegen zwei Rasterdateien
bereit:

- `assets/pics/apple-touch-icon.png`, 180 × 180, für den Startbildschirm unter
  iOS — deckend, ohne Alphakanal und ohne runde Ecken, weil iOS seine eigene
  Maske anlegt.
- `favicon.ico` im Wurzelverzeichnis, mit 16 × 16 und 32 × 32 darin, für den
  stillen Abruf durch Browser und fremde Abholer.

Beide entstehen aus `tools/icon-vorlage.html`, die dieselbe Geometrie trägt wie
die SVG-Datei. **Wer die Pfote ändert, muss beide Stellen nachziehen.** Die
Rasterdateien wie beim Vorschaubild mit einem Browser ablichten; die `.ico`
ist ein schlichter Behälter, in dem seit Vista ein PNG stehen darf.

## Warum die Vorlagen hier liegen

`tools/` ist über `.htaccess` mit 404 gesperrt, die Vorlagen sind also nur
über einen lokalen Server erreichbar. Das ist Absicht: `og-vorlage.html`
trägt dieselbe Wortmarke und denselben Satz wie die Startseite und wäre
sonst eine indexierbare Dublette. Beide Vorlagen tragen zusätzlich ein
`noindex` im Kopf, weil auf GitHub Pages, unter nginx und unter `php -S`
keine `.htaccess` gilt; dort schließt sie das Pages-Deployment ohnehin aus.

Sie dürfen deshalb nie nach `assets/` oder ins Wurzelverzeichnis wandern.
