# leih-ich-dir

Ein minimalistischer **Leih-Katalog**: Du pflegst eine Liste deiner Gegenstände,
deine Freunde sehen über einen Link, was gerade verfügbar ist, und fragen mit
einem Klick per E-Mail oder WhatsApp an.

Die Inhalte werden **im Browser ver- und entschlüsselt**. Der Server speichert
ausschließlich unlesbare Zeichenketten und kennt weder Gegenstände noch Namen
oder Kontaktdaten.

- Produktivbetrieb: <https://leih-ich-dir.de>
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
| **Ohne Abhängigkeiten** | pures PHP, HTML, CSS, Vanilla JS – kein Framework, kein Build-Schritt, keine Datenbank |

## Funktionsweise der Verschlüsselung

Beim Anlegen einer Liste erzeugt der Browser drei Werte:

| Wert | Länge | Zweck | Verlässt den Browser? |
|---|---|---|---|
| Listen-ID | 16 Byte (hex) | Adresse der Datei auf dem Server | ja |
| AES-Schlüssel | 256 Bit | Ver-/Entschlüsselung der Inhalte | **nein** |
| Bearbeiten-Token | 24 Byte | Autorisiert Schreibzugriffe | **nein** (nur sein SHA-256) |

Daraus entstehen die beiden Links:

```
Bearbeiten   https://leih-ich-dir.de/#e=<id>.<schlüssel>.<token>
Ansehen      https://leih-ich-dir.de/#v=<id>.<schlüssel>
```

Der Teil hinter `#` ist das **URL-Fragment**. Browser senden es grundsätzlich
nicht an den Server – es steht damit weder in Zugriffsprotokollen noch in
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

Ehrliche Einordnung – Verschlüsselung ersetzt kein Rechtemanagement:

- Wer den Ansehen-Link hat, kann alles lesen und weitergeben. Der Link *ist* das Geheimnis.
- Wer den Bearbeiten-Link verliert, verliert den Zugang; eine Wiederherstellung ist bauartbedingt unmöglich.
- Der Server kennt zwar keine Inhalte, aber Metadaten: Größe des Chiffrats, Zeitpunkte, Revisionszähler.
- Ein kompromittierter Server könnte manipuliertes JavaScript ausliefern. Diesem Angriff ist jede Web-Anwendung mit Client-Verschlüsselung ausgesetzt; er lässt sich nur durch Prüfung des ausgelieferten Codes eingrenzen.
- Gleichzeitige Änderungen an zwei Bearbeiten-Links: Der Server erkennt den Konflikt über den Revisionszähler, der Client schreibt danach seinen Stand fort (*last write wins*).

## Repository-Struktur

```
.
├── index.html              Oberfläche (statisch, ohne Inline-Skripte)
├── app.js                  Verschlüsselung, i18n, Rendering, Speicherzugriff
├── style.css               Stylesheet, helles und dunkles Farbschema
├── api.php                 Flat-File-Backend (create · read · write · delete)
├── .htaccess               Sicherheits-Header, Sperren für Punktdateien
├── data/                   Laufzeitdaten (nicht im Repository)
│   ├── .htaccess           verbietet jeden HTTP-Zugriff
│   ├── lists/              verschlüsselte Listen
│   └── throttle/           Ratenbegrenzung (gehashte IP-Adressen)
├── tools/purge.php         optionales Wartungsskript für alte Listen
├── tests/api-test.php      Funktionstest des Backends (ohne Abhängigkeiten)
├── .github/workflows/ci.yml  Syntaxprüfung für PHP und JavaScript
├── CONTRIBUTING.md
└── LICENSE                 MIT
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
    ServerName leih-ich-dir.de
    DocumentRoot /var/www/leih-ich-dir

    <Directory /var/www/leih-ich-dir>
        AllowOverride All          # nötig, damit .htaccess greift
        Require all granted
    </Directory>

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/leih-ich-dir.de/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/leih-ich-dir.de/privkey.pem
</VirtualHost>
```

HTTPS ist keine Kür: Die Web Crypto API steht nur in sicheren Kontexten zur
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
curl -sI https://leih-ich-dir.de/data/lists/ | head -1   # erwartet: 403
curl -s  https://leih-ich-dir.de/api.php?a=ping          # erwartet: {"ok":true,…}
```

Liefert der erste Aufruf keinen Statuscode 403, greift `.htaccess` nicht
(meist fehlt `AllowOverride All`). Alternativ – und robuster – liegt `data/`
außerhalb des DocumentRoot; dafür genügt es, die Konstante `DATA_DIR` in
`api.php` anzupassen.

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
`api.php` dort als Quelltext abrufbar – bei einem Open-Source-Projekt ohne
Belang, da derselbe Code ohnehin im Repository liegt.

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

Der Funktionstest startet einen eigenen PHP-Server, prüft alle Endpunkte samt
Fehlerfällen und weist nach, dass in der Ablage kein Klartext landet. Alle drei
Prüfungen laufen auch in der GitHub-Action `CI`.

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

Interface, documentation and issues are welcome in German or English.
