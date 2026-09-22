<?php
declare(strict_types=1);

/**
 * Leih-Katalog · Funktionstest des Flat-File-Backends
 * -----------------------------------------------------------------------------
 * Startet einen eingebauten PHP-Server, prüft api.php gegen die erwarteten
 * Statuscodes und beendet den Server wieder. Ohne weitere Abhängigkeiten.
 *
 *   php tests/api-test.php
 *
 * Rückgabewert 0 = alle Prüfungen bestanden, 1 = mindestens eine fehlgeschlagen.
 * Die angelegten Testlisten werden am Ende wieder entfernt.
 *
 * @license MIT
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Dieses Skript läuft nur auf der Kommandozeile.\n");
}

const HOST = '127.0.0.1';
const PORT = 8712;

$root = dirname(__DIR__);
$base = 'http://' . HOST . ':' . PORT . '/api.php';
$failures = 0;

/* Eigenes Datenverzeichnis über LEIH_DATA_DIR. Der Test läuft damit auf einem
   leeren Stand, rührt vorhandene Listen nicht an und bekommt eine unverbrauchte
   Ratenbegrenzung. Es wird am Ende wieder entfernt. */
$dataDir = sys_get_temp_dir() . '/leih-test-' . bin2hex(random_bytes(6));
mkdir($dataDir, 0770, true);

function rmtree(string $path): void
{
    if (!is_dir($path)) {
        @unlink($path);
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry !== '.' && $entry !== '..') {
            rmtree($path . '/' . $entry);
        }
    }
    @rmdir($path);
}
register_shutdown_function(static function () use ($dataDir): void { rmtree($dataDir); });

/* -- Hilfsfunktionen ------------------------------------------------------ */

function b64u(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

/** @return array{0: int, 1: array<string, mixed>|null} */
function http_json(string $url, ?array $post = null): array
{
    $context = stream_context_create(['http' => [
        'method'        => $post === null ? 'GET' : 'POST',
        'header'        => "Content-Type: application/json\r\n",
        'content'       => $post === null ? null : json_encode($post),
        'ignore_errors' => true,
        'timeout'       => 10,
    ]]);
    $body = @file_get_contents($url, false, $context);
    $code = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
            $code = (int) $m[1];
        }
    }
    return [$code, json_decode((string) $body, true)];
}

function check(string $name, bool $ok, mixed $actual = null): void
{
    global $failures;
    if (!$ok) {
        $failures++;
        if ($actual !== null) {
            printf("    ist: %s\n", var_export($actual, true));
        }
    }
    printf("  %-48s %s\n", $name, $ok ? 'ok' : 'FEHLGESCHLAGEN');
}

/* -- Server starten ------------------------------------------------------- */

$descriptors = [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
$server = proc_open(
    sprintf('exec php -S %s:%d -t %s', HOST, PORT, escapeshellarg($root)),
    $descriptors,
    $pipes,
    null,
    array_merge(is_array(getenv()) ? getenv() : [], ['LEIH_DATA_DIR' => $dataDir])
);
if (!is_resource($server)) {
    exit("Der eingebaute PHP-Server ließ sich nicht starten.\n");
}
register_shutdown_function(static function () use ($server): void {
    proc_terminate($server);
    proc_close($server);
});

for ($i = 0; $i < 50; $i++) {
    usleep(100000);
    [$code] = http_json($base . '?a=ping');
    if ($code === 200) {
        break;
    }
}

/* -- Prüfungen ------------------------------------------------------------ */

echo "Leih-Katalog · API-Test\n";

$id      = bin2hex(random_bytes(16));
$token   = b64u(random_bytes(24));
$proof   = b64u(hash('sha256', $token, true));
$foreign = b64u(hash('sha256', 'fremdes-token', true));
$payload = static fn (string $text): array => ['iv' => b64u(random_bytes(12)), 'ct' => b64u($text)];

[$code, $body] = http_json($base . '?a=ping');
check('ping meldet den Dienst', $code === 200 && ($body['service'] ?? '') === 'leih-katalog');

[$code, $body] = http_json($base, ['a' => 'create', 'id' => $id, 'proof' => $proof, 'payload' => $payload('erste-fassung')]);
check('create liefert Revision 1', $code === 200 && ($body['rev'] ?? 0) === 1);

[$code, $body] = http_json($base, ['a' => 'create', 'id' => $id, 'proof' => $proof, 'payload' => $payload('x')]);
check('create auf belegte ID scheitert', $code === 409 && ($body['error'] ?? '') === 'exists');

[$code, $body] = http_json($base . '?a=read&id=' . $id);
check('read liefert das Chiffrat', $code === 200 && isset($body['payload']['ct']));

[$code, $body] = http_json($base . '?a=read&id=' . $id . '&rev=1');
check('read mit aktueller Revision spart Daten', $code === 200 && ($body['unchanged'] ?? false) === true);

[$code, $body] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 1, 'payload' => $payload('zweite-fassung')]);
check('write erhöht die Revision', $code === 200 && ($body['rev'] ?? 0) === 2);

[$code, $body] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 1, 'payload' => $payload('veraltet')]);
check('write auf veralteter Revision → Konflikt', $code === 409 && ($body['rev'] ?? 0) === 2);

[$code, $body] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $foreign, 'rev' => 2, 'payload' => $payload('fremd')]);
check('write ohne gültigen Nachweis → verboten', $code === 403);

[$code] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 2, 'payload' => ['iv' => 'zu-kurz', 'ct' => 'abc']]);
check('write mit defektem Initialisierungsvektor → 400', $code === 400);

[$code] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 2, 'payload' => ['iv' => b64u(random_bytes(12)), 'ct' => str_repeat('a', 600000)]]);
check('write mit übergroßem Chiffrat → 413', $code === 413);

[$code] = http_json($base . '?a=read&id=' . bin2hex(random_bytes(16)));
check('read auf unbekannte ID → 404', $code === 404);

[$code] = http_json($base . '?a=read&id=' . rawurlencode('../../etc/passwd'));
check('read mit Pfadwechsel → 400', $code === 400);

[$code] = http_json($base . '?a=read&id=' . str_repeat('Z', 32));
check('read mit ungültigem ID-Format → 400', $code === 400);

[$code] = http_json($base, ['a' => 'delete', 'id' => $id, 'proof' => $foreign]);
check('delete ohne gültigen Nachweis → verboten', $code === 403);

[$code, $body] = http_json($base, ['a' => 'delete', 'id' => $id, 'proof' => $proof]);
check('delete mit gültigem Nachweis', $code === 200 && ($body['ok'] ?? false) === true);

[$code] = http_json($base . '?a=read&id=' . $id);
check('read nach delete → 404', $code === 404);

[$code] = http_json($base, ['a' => 'frei-erfunden']);
check('unbekannte Aktion → 400', $code === 400);

/* Der KI-Proxy ist eingeschaltet, aber ohne hinterlegten Schlüssel stumm.
   Das ist die wichtige Eigenschaft: Der Schalter allein gibt nichts frei. */
[$code, $body] = http_json($base . '?a=ping');
check('ping meldet den Proxy ohne Schlüssel als nicht bereit', ($body['aiProxy'] ?? true) === false);

[$code] = http_json($base, ['a' => 'ai', 'text' => 'Bohrmaschine und Zelt']);
check('KI-Anfrage ohne hinterlegten Schlüssel → 404', $code === 404);

/* Mit Schlüssel meldet ping den Proxy als bereit. Die Anfrage selbst wird
   hier nicht gestellt: Sie ginge nach draußen, und ein Test soll nicht vom
   Netz abhängen. */
file_put_contents($dataDir . '/.ai-key', 'AIzaNurFuerDenTest');
[$code, $body] = http_json($base . '?a=ping');
check('ping meldet den Proxy mit Schlüssel als bereit', ($body['aiProxy'] ?? false) === true);
unlink($dataDir . '/.ai-key');
[$code, $body] = http_json($base . '?a=ping');
check('ping meldet ihn nach Entfernen wieder als nicht bereit', ($body['aiProxy'] ?? true) === false);

/* Der Server darf zu keinem Zeitpunkt Klartext ablegen. */
$plainId = bin2hex(random_bytes(16));
http_json($base, ['a' => 'create', 'id' => $plainId, 'proof' => $proof, 'payload' => $payload('Bohrmaschine')]);
$stored = (string) @file_get_contents($dataDir . '/lists/' . substr($plainId, 0, 2) . '/' . $plainId . '.json');
check('Ablage enthält keinen Klartext', $stored !== '' && !str_contains($stored, 'Bohrmaschine'));
check('Ablage speichert nur den Hash des Nachweises', str_contains($stored, '"verifier"') && !str_contains($stored, $proof));
http_json($base, ['a' => 'delete', 'id' => $plainId, 'proof' => $proof]);

/* Lesen ist gedrosselt, aber großzügig: Die Grenze steht in api.php. Dieser
   Block steht vor dem Anlege-Spam, denn danach ließe sich keine Liste mehr
   anlegen, an der man lesen könnte.
   Geprüft wird, dass sie greift, und dass sie erst greift, wenn ein
   einzelner Browser sie im Alltag nicht erreicht — eine Superliste mit allen
   Leihlisten, viele Male in der Stunde geöffnet. */
$readId = bin2hex(random_bytes(16));
http_json($base, ['a' => 'create', 'id' => $readId, 'proof' => $proof, 'payload' => $payload('Leiter')]);
$reads = 0;
$readBlocked = false;
for ($attempt = 0; $attempt < 1400; $attempt++) {
    [$code] = http_json($base . '?a=read&id=' . $readId);
    if ($code === 429) {
        $readBlocked = true;
        break;
    }
    if ($code === 200) {
        $reads++;
    }
}
check('Ratenbegrenzung greift beim Lesen', $readBlocked);
check('Ratenbegrenzung lässt reichlich Lesen zu', $reads >= 1000, $reads);
[$code, $body] = http_json($base, ['a' => 'delete', 'id' => $readId, 'proof' => $proof]);
check('Löschen bleibt trotz Lesedrossel möglich', $code === 200, (string) $code);

/* Ratenbegrenzung: irgendwann verweigert der Server neue Listen. Die genaue
   Grenze steht in api.php; geprüft wird, dass sie überhaupt greift und nicht
   schon nach wenigen Anfragen zuschlägt. */
$created = 0;
$blocked = false;
for ($attempt = 0; $attempt < 40; $attempt++) {
    $spamId = bin2hex(random_bytes(16));
    [$code] = http_json($base, ['a' => 'create', 'id' => $spamId, 'proof' => $proof, 'payload' => $payload('x')]);
    if ($code === 429) {
        $blocked = true;
        break;
    }
    if ($code === 200) {
        $created++;
    }
}
check('Ratenbegrenzung greift beim Anlegen', $blocked);
check('Ratenbegrenzung lässt genug Listen zu', $created >= 10, $created);

echo $failures === 0
    ? "\nAlle Prüfungen bestanden.\n"
    : "\n{$failures} Prüfung(en) fehlgeschlagen.\n";

exit($failures === 0 ? 0 : 1);
