# leih-ich-dir

Ein minimalistischer **Leih-Katalog**: Du pflegst eine Liste deiner Gegenstände,
deine Freunde sehen über einen Link, was gerade verfügbar ist, und fragen mit
einem Klick per E-Mail oder WhatsApp an.

Die Inhalte werden **im Browser ver- und entschlüsselt**. Der Server speichert
ausschließlich unlesbare Zeichenketten und kennt weder Gegenstände noch Namen
oder Kontaktdaten.

- Produktivbetrieb: <https://leihichdir.de>
- Oberflächen-Vorschau (ohne Backend): <https://daimpad.github.io/leih-ich-dir/>

## Eigenschaften

| | |
|---|---|
| **Kein Konto** | Zugang ausschließlich über Links, keine Registrierung, keine Cookies, keine Sitzungen |
| **Ende-zu-Ende-verschlüsselt** | AES-GCM-256 über die Web Crypto API, Schlüssel nur im URL-Fragment |
| **Zwei Linkarten** | ein geheimer Bearbeiten-Link, ein konstanter Ansehen-Link für Freunde |
| **Live-Daten** | der Ansehen-Link lädt den aktuellen Stand und aktualisiert sich selbsttätig |
| **Zweisprachig** | Deutsch und Englisch, automatische Erkennung plus manuelle Umschaltung |
| **Autovervollständigung** | 29 typische Leih-Gegenstände über ein natives `<datalist>`-Element |
| **Anfragen** | `mailto:`- und `wa.me`-Links mit vorformuliertem Text in der aktiven Sprache |
| **Spracheingabe** | Gegenstände unterwegs einsprechen, Zerlegung im Browser oder wahlweise per Gemini |
| **Erscheinungsbild** | das Corporate Design von nozilla, mitgeliefert und ohne fremde Server |
| **Ohne Abhängigkeiten** | pures PHP, HTML, CSS, Vanilla JS, kein Framework, kein Bauschritt, keine Datenbank |

## Funktionsweise der Verschlüsselung

Beim Anlegen einer Liste erzeugt der Browser drei Werte:

| Wert | Länge | Zweck | Verlässt den Browser? |
|---|---|---|---|
| Listen-ID | 16 Byte (hex) | Adresse der Datei auf dem Server | ja |
| AES-Schlüssel | 256 Bit | Ver-/Entschlüsselung der Inhalte | **nein** |
| Bearbeiten-Token | 24 Byte | Autorisiert Schreibzugriffe | **nein** (nur sein SHA-256) |

Daraus entstehen die beiden Links:

```
Bearbeiten   https://leihichdir.de/#e=<id>.<schlüssel>.<token>
Ansehen      https://leihichdir.de/#v=<id>.<schlüssel>
```

Der Teil hinter `#` ist das **URL-Fragment**. Browser senden es grundsätzlich
nicht an den Server. Es steht damit weder in Zugriffsprotokollen noch in
Proxy-Aufzeichnungen. Genau dort stehen Schlüssel und Token.

Vor jedem Speichern verschlüsselt der Browser das gesamte Dokument mit
AES-GCM (12 Byte Initialisierungsvektor je Schreibvorgang, 128 Bit
Authentifizierungs-Tag). Die Listen-ID geht als *additional authenticated data*
in die Verschlüsselung ein: Ein Chiffrat, das in eine andere Liste kopiert wird,
lässt sich nicht mehr entschlüsseln.

**Was der Server sieht**

```json
{
  "v": 1,
  "verifier": "9f2c…",                     ← SHA-256 des Schreibnachweises
  "rev": 7,
  "created": 1757660000, "updated": 1757663400,
  "payload": { "iv": "kM1p…", "ct": "3Ot9uQ…" }   ← AES-GCM-Chiffrat
}
```

**Schreibrechte ohne Klartext-Geheimnis.** Der Browser sendet nicht das Token
selbst, sondern dessen SHA-256 als *Schreibnachweis*. Der Server legt davon
wiederum nur den Hash ab und vergleicht ihn zeitkonstant (`hash_equals`). Weder
in der Datenablage noch in Server-Protokollen steht damit ein Wert, der zum
Wiederherstellen des Bearbeiten-Links genügt.

### Grenzen (Bedrohungsmodell)

Ehrliche Einordnung, denn Verschlüsselung ersetzt kein Rechtemanagement:

- Wer den Ansehen-Link hat, kann alles lesen und weitergeben. Der Link *ist* das Geheimnis.
- Wer den Bearbeiten-Link verliert, verliert den Zugang; eine Wiederherstellung ist bauartbedingt unmöglich.
- Der Server kennt zwar keine Inhalte, aber Metadaten: Größe des Chiffrats, Zeitpunkte, Revisionszähler.
- Ein kompromittierter Server könnte manipuliertes JavaScript ausliefern. Diesem Angriff ist jede Web-Anwendung mit Client-Verschlüsselung ausgesetzt; er lässt sich nur durch Prüfung des ausgelieferten Codes eingrenzen.
- Gleichzeitige Änderungen an zwei Bearbeiten-Links: Der Server erkennt den Konflikt über den Revisionszähler, der Client schreibt danach seinen Stand fort (*last write wins*).
- Die Spracheingabe steht außerhalb dieser Zusage. Gesprochenes Audio und der erkannte Text verlassen das Gerät, sobald die Spracherkennung des Browsers oder die KI genutzt wird. Der Abschnitt zur Spracheingabe sagt genau, wann das passiert und wie es sich abstellen lässt.

## Spracheingabe und KI-Strukturierung

Im Bearbeitenmodus steht eine Schaltfläche „Einsprechen". Sie nutzt die
Spracherkennung des Browsers (`SpeechRecognition`, in Chrome und Safari als
`webkitSpeechRecognition`). Der erkannte Freitext wird in einzelne Gegenstände
zerlegt und in die Liste eingetragen. Ohne Spracherkennung im Browser, etwa in
Firefox, bleibt das Textfeld nutzbar.

Für die Zerlegung gibt es drei Wege. Die Anwendung wählt den ersten, der
verfügbar ist:

| Weg | Voraussetzung | Wohin der Text geht |
|---|---|---|
| **Gemini, eigener Schlüssel** | Schlüssel in den Einstellungen hinterlegt | vom Gerät direkt zu Google |
| **Gemini über den Server** | `AI_PROXY_ENABLED` in `api.php` eingeschaltet | über diesen Server zu Google |
| **Zerlegung im Browser** | immer | nirgendwohin |

Die KI bekommt eine Systemanweisung, die ausschließlich ein JSON-Array
zulässt, ohne Markdown und ohne Erklärung:

```json
[{"item": "Bohrmaschine", "status": "available"}]
```

Zusätzlich erzwingt die Anfrage das Format auf Protokollebene über
`responseMimeType` und `responseSchema`. Fällt die KI aus, übernimmt die
Zerlegung im Browser, und die Eingabe geht nicht verloren.

**Der Schlüssel bleibt auf dem Gerät.** Er liegt im `localStorage` des
Browsers, nicht im verschlüsselten Dokument. Freunde, die den Ansehen-Link
öffnen, bekommen ihn also nicht. Ein Schlüssel im ausgelieferten Quelltext
wäre öffentlich lesbar; deshalb gibt es ihn dort nicht.

**Was das für die Zusage bedeutet.** Die Liste bleibt Ende-zu-Ende
verschlüsselt. Der gesprochene Satz ist davon ausgenommen: Er ist der einzige
Klartext, der das Gerät verlässt, und zwar zweimal, wenn beide Stufen genutzt
werden. Chrome überträgt das Audio zur Erkennung an Google, und die KI-Anfrage
überträgt den erkannten Text. Wer das nicht will, hinterlegt keinen Schlüssel
und lässt den Proxy aus; dann bleibt nur die Erkennung des Browsers, und die
Zerlegung passiert lokal.

### Server-Proxy einschalten

Nur sinnvoll, wenn Gäste ohne eigenen Schlüssel die KI nutzen sollen. Der
Server sieht dabei den gesprochenen Text.

```php
// api.php
const AI_PROXY_ENABLED = true;
```

```bash
printf '%s' 'DEIN-GEMINI-SCHLUESSEL' > data/.ai-key
chmod 600 data/.ai-key && chown www-data data/.ai-key
```

Alternativ über die Umgebung, etwa `SetEnv LEIH_AI_KEY …` im Virtual Host. Der
Text wird weitergereicht und danach verworfen: kein Protokoll, keine Ablage,
keine Zuordnung zu einer Liste. Die Ratenbegrenzung liegt bei 60 Anfragen je
Stunde und IP-Adresse. Wer den Proxy einschaltet, gehört mit dieser
Übermittlung in die eigene Datenschutzerklärung.

## Erscheinungsbild

Die Oberfläche folgt dem Corporate Design von nozilla
([daimpad/nozilla-ci](https://github.com/daimpad/nozilla-ci)):
Papierton als Grund, Signalgrün ausschließlich für Aktionen, Tinte-Schwarz für
Text und Linien, Radius null, harte Schatten ohne Weichzeichnung, keine Emoji.

Übernommen wurde nicht abgeschrieben, sondern eingebunden:

* `vendor/nozilla-ci/design-system.css` ist eine unveränderte Kopie. Ein
  Abgleich mit dem Ursprung bleibt damit ein Dateivergleich. Der Stand steht
  in `vendor/nozilla-ci/README.md`.
* `style.css` ist die Anwendungsschicht darüber. Sie enthält keinen einzigen
  Farb- oder Schriftwert, sondern arbeitet ausschließlich über die Marken
  `--nz-*` und die Bausteine `.nz-*`.
* Die Zeichen in `index.html` sind Kopien aus `project/assets/icon-*.svg`,
  eingebettet als Symbolsatz, damit sie über `currentColor` dem hellen und dem
  dunklen Erscheinungsbild folgen. Jedes trägt die Signatur des Hauses.
* Die Schriften Zilla Slab, Inter und Space Mono liegen als WOFF2-Teilmengen
  unter `assets/fonts/` und werden selbst ausgeliefert. Zusammen 104 KiB.
  Erzeugt mit `tools/build-fonts.py`.

Nichts wird von fremden Servern nachgeladen. Das ist nicht nur eine Frage der
Ladezeit: Ein Aufruf von `fonts.gstatic.com` würde die IP-Adresse jeder
Besucherin an einen Dritten übertragen, und die Content Security Policy
unterbindet das ohnehin.

## Repository-Struktur

```
.
├── index.html                    Oberfläche und Symbolsatz, ohne Inline-Skripte
├── app.js                        Verschlüsselung · i18n · Rendering · Sprache · Speicher
├── style.css                     Anwendungsschicht über dem Erscheinungsbild
├── api.php                       Flat-File-Backend, optional mit KI-Proxy
├── .htaccess                     Sicherheits-Header, Sperren für Punktdateien
├── vendor/nozilla-ci/
│   ├── design-system.css         unveränderte Kopie des Erscheinungsbilds
│   └── README.md                 Herkunft, Stand, Abgleich
├── assets/fonts/                 WOFF2-Teilmengen und ihre @font-face-Regeln
├── data/                         Laufzeitdaten, nicht im Repository
│   ├── .htaccess                 verbietet jeden HTTP-Zugriff
│   ├── .ai-key                   optionaler Schlüssel für den KI-Proxy
│   ├── lists/                    verschlüsselte Listen
│   └── throttle/                 Ratenbegrenzung, gehashte IP-Adressen
├── tools/
│   ├── purge.php                 Wartungsskript für alte Listen
│   └── build-fonts.py            erzeugt die Schriftteilmengen
├── tests/api-test.php            Funktionstest des Backends, ohne Abhängigkeiten
├── .github/workflows/ci.yml      Syntaxprüfung und Funktionstest
├── CONTRIBUTING.md
└── LICENSE                       MIT
```

## Deployment auf einem LAMP-Stack

Vorausgesetzt werden Apache 2.4 mit `AllowOverride All` sowie PHP 8.1 oder
neuer. Eine Datenbank wird nicht benötigt.

**1. Code bereitstellen**

```bash
cd /var/www
git clone https://github.com/daimpad/leih-ich-dir.git
```

**2. Virtual Host einrichten**

```apache
<VirtualHost *:443>
    ServerName leihichdir.de
    DocumentRoot /var/www/leih-ich-dir

    <Directory /var/www/leih-ich-dir>
        AllowOverride All          # nötig, damit .htaccess greift
        Require all granted
    </Directory>

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/leihichdir.de/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/leihichdir.de/privkey.pem
</VirtualHost>
```

HTTPS ist keine Kür. Die Web Crypto API steht nur in sicheren Kontexten zur
Verfügung. Über `http://` bleibt die Anwendung funktionslos.

**3. Schreibrechte setzen**

```bash
sudo mkdir -p /var/www/leih-ich-dir/data
sudo chown -R www-data:www-data /var/www/leih-ich-dir/data
sudo chmod 750 /var/www/leih-ich-dir/data
```

**4. Datenordner prüfen**

`data/.htaccess` sperrt den HTTP-Zugriff; `api.php` greift ausschließlich über
das Dateisystem zu. Die Sperre nach dem Deployment einmal verifizieren:

```bash
curl -sI https://leihichdir.de/data/lists/ | head -1   # erwartet: 403
curl -s  https://leihichdir.de/api.php?a=ping          # erwartet: {"ok":true,…}
```

Liefert der erste Aufruf keinen Statuscode 403, greift `.htaccess` nicht
(meist fehlt `AllowOverride All`). Robuster ist es, `data/` ganz aus dem
DocumentRoot zu nehmen. Dafür muss kein Code geändert werden, die
Umgebungsvariable genügt:

```apache
SetEnv LEIH_DATA_DIR /var/lib/leihichdir
```

```bash
sudo mkdir -p /var/lib/leihichdir
sudo chown www-data:www-data /var/lib/leihichdir
sudo chmod 750 /var/lib/leihichdir
```

Dann ist der Datenordner über HTTP schlicht nicht erreichbar, unabhängig
davon, ob `.htaccess` greift.

Hinter nginx statt Apache übernimmt folgender Block die Aufgabe von `.htaccess`:

```nginx
location ^~ /data/ { deny all; return 404; }
location ~ /\.     { deny all; return 404; }
```

**5. Aktualisieren**

```bash
cd /var/www/leih-ich-dir && git pull --ff-only
```

`data/` steht in `.gitignore` und bleibt dabei unberührt.

**6. Optional: alte Listen abräumen**

```cron
15 4 * * * /usr/bin/php /var/www/leih-ich-dir/tools/purge.php --days=365
```

Entfernt Listen, die ein Jahr lang nicht geschrieben wurden. Mit `--dry-run`
lässt sich der Lauf zunächst beobachten.

## Vorschau über GitHub Pages

Die Oberfläche lässt sich ohne Server betrachten. GitHub Pages liefert nur
statische Dateien aus; `api.php` wird dort nicht ausgeführt. Die Anwendung
erkennt das beim Start (die Kennungsabfrage `?a=ping` liefert kein gültiges
JSON) und schaltet in den **Vorschaumodus**:

- Listen werden im `localStorage` des Browsers abgelegt,
- Links funktionieren nur im selben Browser,
- ein Hinweisbanner macht das sichtbar.

Für Gestaltungs- und Barrierefreiheitsfragen genügt das; alles Serverseitige
gehört auf den LAMP-Stack. Da GitHub Pages PHP nicht interpretiert, ist
`api.php` dort als Quelltext abrufbar. Bei einem Open-Source-Projekt ist das
ohne Belang, da derselbe Code ohnehin im Repository liegt.

## Entwicklung

```bash
git clone https://github.com/daimpad/leih-ich-dir.git
cd leih-ich-dir
php -S localhost:8000        # eingebauter Server, api.php wird ausgeführt
```

Prüfungen vor einem Pull Request:

```bash
find . -name '*.php' -print0 | xargs -0 -n1 php -l   # PHP-Syntax
node --check app.js                                  # JavaScript-Syntax
php tests/api-test.php                               # Funktionstest des Backends
```

Der Funktionstest startet einen eigenen PHP-Server mit einem eigenen
Datenverzeichnis, prüft alle Endpunkte samt Fehlerfällen und Ratenbegrenzung
und weist nach, dass in der Ablage kein Klartext landet. Vorhandene Listen
bleiben unberührt. Alle drei Prüfungen laufen auch in der GitHub-Action `CI`.

## Lizenz

[MIT](LICENSE) · © 2026 Damian Paderta

---

## English summary

**leih-ich-dir** is a minimalist lending catalogue: you keep a list of the
things you lend out, friends open a view link to see what is available and ask
for an item via e-mail or WhatsApp.

All contents are encrypted in the browser with AES-GCM-256 (Web Crypto API).
The key travels in the URL fragment (`#`) and is therefore never transmitted to
the server; `api.php` is a deliberately dumb flat-file store for ciphertext.
There is no database, no framework, no build step and no account.

Two links per list: a secret edit link (`#e=id.key.token`) and a constant view
link (`#v=id.key`). Deployment targets a plain LAMP stack — see the German
deployment section above; `data/` must be writable by the web server and
unreachable over HTTP. GitHub Pages serves a design preview that falls back to
`localStorage` because PHP is not executed there.

Items can also be dictated: the browser's speech recognition produces free
text, which is split into items either locally or, if you supply your own
Gemini key, by the AI. That spoken text is the one piece of plaintext that
leaves the device, and the German section above says exactly when.

The visual identity is the nozilla corporate design, vendored verbatim under
`vendor/nozilla-ci/`, with self-hosted font subsets. Nothing is fetched from
third-party servers.

Interface, documentation and issues are welcome in German or English.
