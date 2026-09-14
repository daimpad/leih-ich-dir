<?php
declare(strict_types=1);

/**
 * Leih-Katalog · Abnahme einer Installation
 * -----------------------------------------------------------------------------
 * Prüft eine laufende Installation von außen, so wie ein Browser sie sieht.
 * Kein Zugriff auf das Dateisystem, keine Abhängigkeiten.
 *
 *   php tools/check-deployment.php https://leihichdir.de
 *
 * Das Skript legt zur Prüfung der Schreibrechte eine leere Liste an und löscht
 * sie sofort wieder. Es überträgt dabei keine Inhalte.
 *
 * Rückgabewert 0 = alles in Ordnung, 1 = mindestens ein Muss ist verletzt.
 *
 * @license MIT
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Dieses Skript läuft nur auf der Kommandozeile.\n");
}

$base = rtrim($argv[1] ?? '', '/');
if ($base === '') {
    exit("Aufruf: php tools/check-deployment.php https://leihichdir.de\n");
}

$must = 0;
$should = 0;

/** @return array{status: int, headers: array<string, string>, body: string} */
function fetch(string $url, ?array $post = null): array
{
    $context = stream_context_create([
        'http' => [
            'method'          => $post === null ? 'GET' : 'POST',
            'header'          => "Content-Type: application/json\r\nUser-Agent: leih-katalog-check\r\n",
            'content'         => $post === null ? null : json_encode($post),
            'ignore_errors'   => true,
            'follow_location' => 0,
            'timeout'         => 15,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $body = @file_get_contents($url, false, $context);
    $status = 0;
    $headers = [];
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
            $status = (int) $m[1];
            continue;
        }
        $parts = explode(':', $line, 2);
        if (count($parts) === 2) {
            $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
        }
    }
    return ['status' => $status, 'headers' => $headers, 'body' => (string) $body];
}

function line(string $level, string $name, bool $ok, string $detail = ''): void
{
    global $must, $should;
    if (!$ok) {
        if ($level === 'MUSS') {
            $must++;
        } else {
            $should++;
        }
    }
    printf("  %-4s  %-46s %s%s\n", $level, $name, $ok ? 'ok' : 'FEHLT', $detail !== '' ? '  (' . $detail . ')' : '');
}

echo "Leih-Katalog · Abnahme von {$base}\n\n";

/* -- Erreichbarkeit und Verschlüsselung ----------------------------------- */

echo "Erreichbarkeit\n";
$home = fetch($base . '/');
line('MUSS', 'Startseite antwortet mit 200', $home['status'] === 200, 'Status ' . $home['status']);
line('MUSS', 'Adresse ist https', str_starts_with($base, 'https://'),
    'ohne HTTPS stellt der Browser die Web Crypto API nicht bereit');

if (str_starts_with($base, 'https://')) {
    $plain = fetch('http://' . substr($base, 8) . '/');
    $location = $plain['headers']['location'] ?? '';
    line('SOLL', 'http leitet auf https um',
        in_array($plain['status'], [301, 308], true) && str_starts_with($location, 'https://'),
        'Status ' . $plain['status']);
}

/**
 * Die Direktiven, die diese Anwendung erwartet, und der Wert je Direktive.
 * @return array<string,string>
 */
function csp_soll(): array
{
    return [
        'default-src' => "'self'",
        'script-src'  => "'self'",
        'style-src'   => "'self'",
        'font-src'    => "'self'",
        'img-src'     => "'self' data:",
        'connect-src' => "'self' https://generativelanguage.googleapis.com",
        'base-uri'    => "'none'",
        'form-action' => "'none'",
    ];
}

/** Liest den Wert einer Direktive aus einer Richtlinie, sonst null. */
function csp_direktive(string $csp, string $name): ?string
{
    foreach (explode(';', $csp) as $teil) {
        $w = preg_split('/\s+/', trim($teil));
        if ($w && strtolower($w[0]) === $name) {
            return implode(' ', array_slice($w, 1));
        }
    }
    return null;
}

/* -- Sicherheitskopfzeilen ------------------------------------------------- */

echo "\nKopfzeilen\n";
$h = $home['headers'];
$kopfzeilenFehlen = !isset($h['content-security-policy']);
line('MUSS', 'Content-Security-Policy gesetzt', !$kopfzeilenFehlen,
    $kopfzeilenFehlen ? 'die Ursache steht am Ende unter Befund' : '');
/* Nicht nur, dass sie dasteht, sondern was sie sagt. Eine Pruefung auf
   Teilzeichenketten waere keine: "script-src 'self'" steckt auch in
   "script-src 'self' 'unsafe-inline'". Verglichen wird der ganze Wert. */
if (!$kopfzeilenFehlen) {
    foreach (csp_soll() as $name => $soll) {
        $ist = csp_direktive($h['content-security-policy'], $name);
        line('MUSS', "Kopfzeile: $name $soll", $ist === $soll, $ist === null ? 'fehlt' : $ist);
    }
}
/* Fehlt mod_headers, ist die Meta-Fassung in index.html die einzige
   verbliebene Sperre. Sie gehoert deshalb ebenso geprueft. */
if (preg_match('~<meta[^>]+http-equiv=["\']Content-Security-Policy["\'][^>]*>~i', $home['body'] ?? '', $m)
    && preg_match('~content\s*=\s*("|\')(.*?)\1~is', $m[0], $c)) {
    foreach (csp_soll() as $name => $soll) {
        $ist = csp_direktive($c[2], $name);
        line('SOLL', "meta: $name $soll", $ist === $soll, $ist === null ? 'fehlt' : $ist);
    }
} else {
    line('SOLL', 'Content-Security-Policy als <meta> in index.html', false, 'nicht gefunden');
}
line('SOLL', 'X-Content-Type-Options nosniff', ($h['x-content-type-options'] ?? '') === 'nosniff');
line('SOLL', 'Referrer-Policy no-referrer', ($h['referrer-policy'] ?? '') === 'no-referrer');
line('SOLL', 'X-Frame-Options DENY', strtoupper($h['x-frame-options'] ?? '') === 'DENY');
line('SOLL', 'Strict-Transport-Security gesetzt', isset($h['strict-transport-security']),
    'in .htaccess auskommentiert, erst nach dauerhaftem HTTPS einschalten');

/* -- Dateien, die die Seite braucht ---------------------------------------- */

echo "\nAuslieferung\n";
foreach ([
    ['/style.css', 'text/css'],
    ['/app.js', 'javascript'],
    ['/theme.js', 'javascript'],
    ['/einstellungen.html', 'text/html'],
    ['/ueber.html', 'text/html'],
    ['/impressum.html', 'text/html'],
    ['/datenschutz.html', 'text/html'],
    ['/assets/fonts/fonts.css', 'text/css'],
    ['/assets/fonts/ranchers-400.woff2', 'font/woff2'],
    ['/assets/fonts/inter-400.woff2', 'font/woff2'],
    ['/assets/pics/pfote.svg', 'image/svg+xml'],
    ['/assets/pics/og.png', 'image/png'],
    ['/assets/pics/logo.svg', 'image/svg+xml'],
    ['/assets/favicon/favicon.svg', 'image/svg+xml'],
    ['/assets/favicon/favicon-96x96.png', 'image/png'],
    ['/assets/favicon/apple-touch-icon.png', 'image/png'],
    ['/assets/favicon/web-app-manifest-192x192.png', 'image/png'],
    ['/assets/favicon/web-app-manifest-512x512.png', 'image/png'],
    ['/favicon.ico', 'image'],
    ['/site.webmanifest', 'json'],
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'xml'],
] as [$path, $type]) {
    $res = fetch($base . $path);
    $ct = strtolower($res['headers']['content-type'] ?? '');
    line('MUSS', ltrim($path, '/'), $res['status'] === 200, 'Status ' . $res['status']);
    line('SOLL', '  Typ ' . $type, str_contains($ct, $type), $ct !== '' ? $ct : 'kein Typ');
}

/* -- Was nicht erreichbar sein darf ---------------------------------------- */

$sperrenGreifen = false;
/* Getrennt gezaehlt, weil der Unterschied die Diagnose traegt: Eine PHP-Datei
   reicht jeder Aufbau an Apache weiter, eine statische Datei nicht unbedingt. */
$dynamischGesperrt = 0;
$statischOffen = 0;
echo "\nAbschottung\n";
/* Nicht jede Sperre stammt aus der .htaccess, und der Befund am Ende haengt
   daran. 'beweis' ist eine gewoehnliche lesbare Datei in einem gewoehnlichen
   Verzeichnis: Sie ist nur gesperrt, wenn der RedirectMatch greift.
   'dynamisch' sind die beiden PHP-Skripte, die sich selbst mit 403 sperren,
   sobald sie nicht auf der Kommandozeile laufen — erst ein 404 stammt vom
   RedirectMatch. 'sonst' koennen auch ohne .htaccess gesperrt sein: Ein
   Server ohne Verzeichnisliste antwortet auf einen Ordner mit 403, und
   Punktdateien sperren viele Aufbauten von sich aus. */
foreach ([
    '/data/'                  => 'sonst',
    '/data/lists/'            => 'sonst',
    '/.git/config'            => 'sonst',
    '/tests/api-test.php'     => 'dynamisch',
    '/tools/purge.php'        => 'dynamisch',
    '/tools/og-vorlage.html'  => 'beweis',
] as $path => $art) {
    $res = fetch($base . $path);
    $zu = $res['status'] !== 200;
    $detail = 'Status ' . $res['status'];
    if ($art === 'dynamisch' && $res['status'] === 403) {
        $detail .= ', Selbstsperre des Skripts, kein Beleg fuer die .htaccess';
    }
    if ($art === 'beweis') {
        if ($zu) { $sperrenGreifen = true; } else { $statischOffen++; }
    }
    if ($art === 'dynamisch' && $zu && $res['status'] !== 403) {
        $sperrenGreifen = true;
        $dynamischGesperrt++;
    }
    line('MUSS', 'gesperrt: ' . $path, $zu, $detail);
}

/* -- Schlussfolgerung ------------------------------------------------------ *
 *
 * Fehlen die Kopfzeilen, greifen aber die Sperren, dann wird die .htaccess
 * gelesen: RedirectMatch und Require all denied stehen in derselben Datei und
 * brauchen dasselbe AllowOverride wie Header. Dann fehlt nicht AllowOverride,
 * sondern das Modul mod_headers — der ganze Block steht in
 * <IfModule mod_headers.c> und wird ohne das Modul stillschweigend
 * uebersprungen. Genau diese Stille macht den Fehler so schwer zu finden.
 * ------------------------------------------------------------------------- */

/* Der zweite Befund gilt auch dann, wenn die Kopfzeilen stehen: Eine
   gesperrte PHP-Datei neben einer offenen .html-Datei im selben Verzeichnis
   kann kein einzelner Server erzeugen. Dieselbe Regel traefe beide. Also
   beantwortet sie nicht derselbe Server. */
$gespalten = $dynamischGesperrt > 0 && $statischOffen > 0;

if ($kopfzeilenFehlen || $gespalten) {
    echo "\nBefund\n";
    if ($gespalten) {
        line('MUSS', 'Ursache der offenen statischen Dateien', false,
            'Unter tools/ ist die PHP-Datei gesperrt und die .html-Datei nicht. '
            . 'Dieselbe Regel in .htaccess trifft beide, also beantwortet sie nicht '
            . 'derselbe Server: Ein vorgelagerter nginx liefert statische Dateien '
            . 'selbst aus und liest dabei keine .htaccess. In Plesk steht der Schalter '
            . 'unter Hosting-Einstellungen, Apache & nginx, bei "Smart static files '
            . 'processing". Abschalten laesst alles durch Apache laufen; wer ihn '
            . 'behalten will, traegt die Sperre zusaetzlich in die nginx-Direktiven '
            . 'ein. Der Wortlaut steht im README unter "Vorgelagerter nginx".');
    }
    if ($kopfzeilenFehlen && !empty($sperrenGreifen)) {
        line('MUSS', 'Ursache der fehlenden Kopfzeilen', false,
            'Die .htaccess wird gelesen, sonst waeren die Sperren oben nicht wirksam. '
            . 'Es fehlt das Apache-Modul mod_headers. In Plesk unter Tools & Einstellungen, '
            . 'Apache-Webserver, headers anhaken; danach erneut pruefen.');
    } elseif ($kopfzeilenFehlen) {
        line('MUSS', 'Ursache der fehlenden Kopfzeilen', false,
            'Weder Kopfzeilen noch Sperren greifen: Die .htaccess wird gar nicht '
            . 'ausgewertet. Im Virtual Host fehlt AllowOverride All.');
    }
}

/* -- Schnittstelle und Schreibrechte --------------------------------------- */

echo "\nSchnittstelle\n";
$ping = fetch($base . '/api.php?a=ping');
$info = json_decode($ping['body'], true);
$alive = is_array($info) && ($info['service'] ?? '') === 'leih-katalog';
line('MUSS', 'api.php antwortet als Dienst', $alive,
    $alive ? 'Fassung ' . ($info['version'] ?? '?') : 'PHP wird nicht ausgeführt oder ist blockiert');

if ($alive) {
    $b64 = static fn (string $bin): string => rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    $id = bin2hex(random_bytes(16));
    $proof = $b64(hash('sha256', $b64(random_bytes(24)), true));
    $payload = ['iv' => $b64(random_bytes(12)), 'ct' => $b64('abnahme')];

    $create = fetch($base . '/api.php', ['a' => 'create', 'id' => $id, 'proof' => $proof, 'payload' => $payload]);
    line('MUSS', 'Liste anlegen, data/ ist beschreibbar', $create['status'] === 200,
        'Status ' . $create['status'] . ($create['status'] === 500 ? ', Rechte auf data/ prüfen' : ''));

    if ($create['status'] === 200) {
        $read = fetch($base . '/api.php?a=read&id=' . $id);
        line('MUSS', 'Liste wieder lesbar', $read['status'] === 200, 'Status ' . $read['status']);
        $del = fetch($base . '/api.php', ['a' => 'delete', 'id' => $id, 'proof' => $proof]);
        line('MUSS', 'Testliste wieder entfernt', $del['status'] === 200, 'Status ' . $del['status']);
    }

    $proxy = ($info['aiProxy'] ?? false) === true;
    printf("  INFO  %-46s %s\n", 'KI-Proxy', $proxy
        ? 'bereit, gesprochener Text läuft über diesen Server'
        : 'nicht bereit, Browser zerlegt selbst (Schlüssel in data/.ai-key fehlt)');
}

/* -- Ergebnis --------------------------------------------------------------- */

echo "\n";
if ($must === 0 && $should === 0) {
    echo "Alles in Ordnung.\n";
} elseif ($must === 0) {
    echo "Betriebsbereit. {$should} Empfehlung(en) offen.\n";
} else {
    echo "{$must} Muss-Punkt(e) verletzt, {$should} Empfehlung(en) offen.\n";
}
exit($must === 0 ? 0 : 1);
