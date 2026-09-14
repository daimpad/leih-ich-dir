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

/* -- Sicherheitskopfzeilen ------------------------------------------------- */

echo "\nKopfzeilen\n";
$h = $home['headers'];
line('MUSS', 'Content-Security-Policy gesetzt', isset($h['content-security-policy']));
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
    ['/assets/fonts/fonts.css', 'text/css'],
    ['/assets/fonts/ranchers-400.woff2', 'font/woff2'],
    ['/assets/fonts/inter-400.woff2', 'font/woff2'],
] as [$path, $type]) {
    $res = fetch($base . $path);
    $ct = strtolower($res['headers']['content-type'] ?? '');
    line('MUSS', ltrim($path, '/'), $res['status'] === 200, 'Status ' . $res['status']);
    line('SOLL', '  Typ ' . $type, str_contains($ct, $type), $ct !== '' ? $ct : 'kein Typ');
}

/* -- Was nicht erreichbar sein darf ---------------------------------------- */

echo "\nAbschottung\n";
foreach ([
    '/data/',
    '/data/lists/',
    '/.git/config',
    '/tests/api-test.php',
    '/tools/purge.php',
] as $path) {
    $res = fetch($base . $path);
    line('MUSS', 'gesperrt: ' . $path, $res['status'] !== 200, 'Status ' . $res['status']);
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
