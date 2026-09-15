# Browsertests

Diese Suiten fahren die Oberfläche in einem echten Browser durch und messen,
was dabei herauskommt: Größen in Punkten, Statuscodes, Inhalte im Dokument,
unbehandelte Ausnahmen. Sie prüfen nicht, ob der Code aussieht wie gedacht,
sondern ob die Seite sich verhält wie zugesagt.

Sie gehören zu den Tests und nicht zur Anwendung. Ausgeliefert wird davon
nichts: `tests/` ist über `.htaccess` gesperrt und wird aus der
Oberflächen-Vorschau entfernt.

## Voraussetzungen

* Node 18 oder neuer
* Playwright mit einem Chromium

```bash
npm i -g playwright && playwright install chromium
```

Liegt Playwright anderswo, sagt man es über Umgebungsvariablen:

| Variable | Wofür | Vorgabe |
| --- | --- | --- |
| `LID_PLAYWRIGHT` | Pfad zu `playwright/index.mjs` | `/opt/node22/lib/node_modules/playwright/index.mjs` |
| `LID_CHROMIUM` | Pfad zum Chromium | was Playwright selbst findet |
| `LID_BASE` | laufende Anwendung | `http://127.0.0.1:8099` |
| `LID_SHOTS` | wohin Bildschirmfotos gehen | `tests/e2e/.bilder/` |

## Laufen lassen

In einem Fenster die Anwendung starten, in einem zweiten die Tests:

```bash
php -S 127.0.0.1:8099            # Fenster 1
node tests/e2e/lauf.mjs          # Fenster 2, alle Suiten
node tests/e2e/lauf.mjs kreis    # nur die passenden
node tests/e2e/kreis.mjs         # eine einzelne, mit allen Zeilen
```

Der Läufer setzt vor jeder Suite die Ratenbegrenzung des Servers zurück
(`data/throttle`). Jede Suite legt Listen an, und nach zwanzig in einer
Stunde antwortet `api.php` mit 429; ohne das Aufräumen scheitert ab der
dritten Suite alles aus einem Grund, der mit dem Geprüften nichts zu tun hat.

Wer die eigenen Daten nicht anfassen will, gibt dem Server ein eigenes
Verzeichnis:

```bash
LEIH_DATA_DIR=/tmp/leih-test php -S 127.0.0.1:8099
LEIH_DATA_DIR=/tmp/leih-test node tests/e2e/lauf.mjs
```

## Wie eine Suite aufgebaut ist

Kein Testrahmen, keine Zusicherungsbibliothek. `hilfe.mjs` bringt das
Wenige mit, das sonst in jeder Datei stünde:

```js
import { starteBrowser, BASE, pruefer, macheListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const p = await br.newPage();
await p.goto(BASE + '/', { waitUntil: 'networkidle' });

ok('die Startseite läuft ohne Ausnahme', true);

await br.close();
process.exit(bilanz());
```

`macheListe(page, L('Titel', 'Name', items))` legt eine Liste unmittelbar
über die Schnittstelle an, mit derselben Kryptografie wie die Anwendung.
`liesListe(page, 'id.key')` holt sie zurück und entschlüsselt sie — damit
lässt sich prüfen, was wirklich auf dem Server steht, und nicht nur, was der
Bildschirm zeigt.

## Wenn eine Zusicherung fällt

Erst nachsehen, ob sie noch gilt. Mehrere Suiten hielten Anforderungen fest,
die später abgelöst wurden; solche Zeilen werden nachgezogen und nicht
repariert. Ist die Anforderung dagegen unverändert, ist der Fund echt.
