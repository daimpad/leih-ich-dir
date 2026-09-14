# Das Vorschaubild neu erzeugen

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
