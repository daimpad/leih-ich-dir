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

## Die Zeichen der Anwendung

Favicon, Apple-Symbol und die Symbole des Manifests liegen fertig in
`assets/favicon/` und stammen nicht aus diesem Verzeichnis — sie werden
extern erzeugt und hier nur abgelegt. Die Bildmarke im Seitenkopf ist
`assets/pics/logo.svg`.

Zwei Dinge sind dabei zu beachten:

- `favicon.ico` liegt **zusätzlich** im Wurzelverzeichnis. Browser und fremde
  Abholer fordern sie dort blind an, ohne auf den `<link>` zu sehen. Wird die
  Datei in `assets/favicon/` erneuert, muss die Kopie mitgezogen werden.
- `site.webmanifest` liegt im Wurzelverzeichnis, nicht bei den Symbolen. Die
  Adressen darin lösen relativ zum Ort des Manifests auf; aus
  `assets/favicon/` heraus zeigte `start_url` in dieses Verzeichnis statt auf
  die Anwendung.

## Warum die Vorlagen hier liegen

`tools/` ist über `.htaccess` mit 404 gesperrt, die Vorlagen sind also nur
über einen lokalen Server erreichbar. Das ist Absicht: `og-vorlage.html`
trägt dieselbe Wortmarke und denselben Satz wie die Startseite und wäre
sonst eine indexierbare Dublette. Beide Vorlagen tragen zusätzlich ein
`noindex` im Kopf, weil auf GitHub Pages, unter nginx und unter `php -S`
keine `.htaccess` gilt; dort schließt sie das Pages-Deployment ohnehin aus.

Sie dürfen deshalb nie nach `assets/` oder ins Wurzelverzeichnis wandern.
