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

/**
 * Ohne $kopf geht jede Anfrage als application/json hinaus und, wie von
 * curl, ohne Origin und ohne Sec-Fetch-Site. Wer $kopf angibt,
 * ersetzt damit alle Kopfzeilen, den Inhaltstyp eingeschlossen.
 * check-deployment.php fragt nicht so: Es schickt bei jedem POST den Origin
 * der geprueften Adresse mit.
 *
 * @param list<string> $kopf
 * @return array{0: int, 1: array<string, mixed>|null}
 */
function http_json(string $url, ?array $post = null, array $kopf = ['Content-Type: application/json']): array
{
    $context = stream_context_create(['http' => [
        'method'        => $post === null ? 'GET' : 'POST',
        'header'        => implode("\r\n", $kopf) . "\r\n",
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

/* Der Widerruf: Beim Schreiben lässt sich der Nachweis austauschen. Danach
   schreibt nur noch der neue — das ist der Unterschied zwischen "der alte
   Link zeigt nichts mehr" und "der alte Link kann nichts mehr". */
$neuerNachweis = b64u(random_bytes(32));
[$code] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 2, 'payload' => $payload('x'), 'newproof' => 'kein gültiger Nachweis']);
check('write mit unbrauchbarem neuen Nachweis → 400', $code === 400);

[$code] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $foreign, 'rev' => 2, 'payload' => $payload('x'), 'newproof' => $neuerNachweis]);
check('Nachweistausch ohne gültigen alten Nachweis → verboten', $code === 403);

[$code] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 2, 'payload' => $payload('x')]);
check('der alte Nachweis schreibt noch, solange nichts getauscht wurde', $code === 200);

[$code, $body] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 3, 'payload' => $payload('widerrufen'), 'newproof' => $neuerNachweis]);
check('Nachweistausch mit gültigem alten Nachweis', $code === 200 && ($body['rev'] ?? 0) === 4);

[$code] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $proof, 'rev' => 4, 'payload' => $payload('zurueck')]);
check('danach schreibt der alte Nachweis nicht mehr', $code === 403);

[$code, $body] = http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $neuerNachweis, 'rev' => 4, 'payload' => $payload('weiter')]);
check('und der neue schreibt', $code === 200 && ($body['rev'] ?? 0) === 5);

/* Für die folgenden Prüfungen gilt wieder der ursprüngliche Nachweis. */
http_json($base, ['a' => 'write', 'id' => $id, 'proof' => $neuerNachweis, 'rev' => 5, 'payload' => $payload('zurueckgetauscht'), 'newproof' => $proof]);

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

/* Der KI-Proxy ist seit November 2026 ausgeschaltet (AI_PROXY_ENABLED,
   api.php). Bis dahin galt: eingeschaltet, aber ohne Schlüssel stumm. Jetzt
   gilt mehr: Auch ein abgelegter Schlüssel macht ihn nicht scharf, denn der
   Server soll keinen Klartext sehen. Die Anfrage wird nicht nach draußen
   gestellt; sie endet schon hier. */
[$code, $body] = http_json($base . '?a=ping');
check('ping meldet den Proxy ohne Schlüssel als nicht bereit', ($body['aiProxy'] ?? true) === false);

[$code] = http_json($base, ['a' => 'ai', 'text' => 'Bohrmaschine und Zelt']);
check('KI-Anfrage ohne hinterlegten Schlüssel → 404', $code === 404);

file_put_contents($dataDir . '/.ai-key', 'AIzaNurFuerDenTest');
[$code, $body] = http_json($base . '?a=ping');
check('auch mit Schlüssel meldet ping den Proxy als nicht bereit', ($body['aiProxy'] ?? true) === false);
[$code] = http_json($base, ['a' => 'ai', 'text' => 'Bohrmaschine und Zelt']);
check('und die KI-Anfrage endet mit 404, ohne nach draußen zu gehen', $code === 404);
unlink($dataDir . '/.ai-key');

/* Der Server darf zu keinem Zeitpunkt Klartext ablegen. */
$plainId = bin2hex(random_bytes(16));
http_json($base, ['a' => 'create', 'id' => $plainId, 'proof' => $proof, 'payload' => $payload('Bohrmaschine')]);
$stored = (string) @file_get_contents($dataDir . '/lists/' . substr($plainId, 0, 2) . '/' . $plainId . '.json');
check('Ablage enthält keinen Klartext', $stored !== '' && !str_contains($stored, 'Bohrmaschine'));
check('Ablage speichert nur den Hash des Nachweises', str_contains($stored, '"verifier"') && !str_contains($stored, $proof));
http_json($base, ['a' => 'delete', 'id' => $plainId, 'proof' => $proof]);

/* Schreiben nur von der eigenen Seite. Ohne Vorabanfrage kann eine fremde
   Seite nur text/plain, application/x-www-form-urlencoded und
   multipart/form-data schicken; mit mode 'no-cors' sieht sie die Antwort
   nie, aber die Liste stuende auf dem Server. Deshalb wird nach jedem
   abgewiesenen Anlegen nachgesehen, dass es die Liste nicht gibt.
   Ohne eigene Kopfzeilen fragt http_json wie curl: ohne Origin und ohne
   Sec-Fetch-Site. Dann gilt allein der Inhaltstyp. */
$json  = 'Content-Type: application/json';
$eigen = 'Origin: http://' . HOST . ':' . PORT;
/** @return array{0: int, 1: string, 2: int} Status, Fehlercode, Status von read danach */
$anlegenMit = static function (array $kopf) use ($base, $proof, $payload): array {
    $neu = ['a' => 'create', 'id' => bin2hex(random_bytes(16)), 'proof' => $proof, 'payload' => $payload('fremd')];
    [$code, $body] = http_json($base, $neu, $kopf);
    [$danach] = http_json($base . '?a=read&id=' . $neu['id']);
    return [$code, (string) ($body['error'] ?? ''), $danach];
};

foreach ([
    'text/plain',
    'text/plain; charset=UTF-8',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain; application/json',
] as $typ) {
    $r = $anlegenMit(['Content-Type: ' . $typ]);
    check("POST als $typ → 415, nichts angelegt", $r === [415, 'unsupported_media_type', 404], $r);
}

foreach ([
    'Sec-Fetch-Site cross-site'                => [$json, 'Sec-Fetch-Site: cross-site'],
    'fremdem Origin'                           => [$json, 'Origin: https://boese.example'],
    'Origin null'                              => [$json, 'Origin: null'],
    'Origin auf eigenem Rechner, fremdem Port' => [$json, 'Origin: http://' . HOST . ':9999'],
    'Origin, der mit dem eigenen beginnt'      => [$json, $eigen . '.boese.example'],
] as $name => $kopf) {
    $r = $anlegenMit($kopf);
    check("POST mit $name → 403, nichts angelegt", $r === [403, 'cross_origin', 404], $r);
}

/* Was der eigene Browser schickt, kommt durch: JSON, eigener Origin,
   same-origin. Einmal angelegt, danach nur geschrieben, damit das
   Kontingent fuer die Drosselprobe unten kaum angetastet wird. */
$hId = bin2hex(random_bytes(16));
[$code] = http_json($base, ['a' => 'create', 'id' => $hId, 'proof' => $proof, 'payload' => $payload('eigen')],
    [$json . '; charset=utf-8', $eigen, 'Sec-Fetch-Site: same-origin']);
check('POST wie aus dem eigenen Browser → 200', $code === 200, $code);
$rev = 1;
foreach ([
    'mit eigenem Origin'                  => [$json, $eigen],
    'ohne Origin und Sec-Fetch-Site'      => [$json],
    'als Application/JSON; charset=UTF-8' => ['Content-Type: Application/JSON; charset=UTF-8'],
    'mit Sec-Fetch-Site same-site'        => [$json, 'Sec-Fetch-Site: same-site'],
] as $name => $kopf) {
    [$code, $body] = http_json($base, ['a' => 'write', 'id' => $hId, 'proof' => $proof, 'rev' => $rev, 'payload' => $payload('eigen')], $kopf);
    check("write $name → 200", $code === 200 && ($body['rev'] ?? 0) === $rev + 1, $code);
    $rev++;
}

/* Jede Aktion steht hinter denselben Riegeln, nicht nur das Anlegen. */
[$code] = http_json($base, ['a' => 'write', 'id' => $hId, 'proof' => $proof, 'rev' => $rev, 'payload' => $payload('fremd')],
    [$json, 'Origin: https://boese.example']);
check('write mit gültigem Nachweis, fremdem Origin → 403', $code === 403, $code);
[$code] = http_json($base, ['a' => 'delete', 'id' => $hId, 'proof' => $proof], ['Content-Type: text/plain']);
check('delete als text/plain → 415', $code === 415, $code);
[$code] = http_json($base, ['a' => 'ai', 'text' => 'Bohrmaschine'], ['Content-Type: text/plain']);
check('KI-Anfrage als text/plain → 415', $code === 415, $code);
[$code, $body] = http_json($base . '?a=read&id=' . $hId);
check('die Liste steht danach unverändert', $code === 200 && ($body['rev'] ?? 0) === $rev, $code);

/* Lesen bleibt, wie es war: Es liefert nur Chiffrat. */
[$code] = http_json($base . '?a=read&id=' . $hId, null, [$json, 'Origin: https://boese.example', 'Sec-Fetch-Site: cross-site']);
check('read von fremder Herkunft bleibt 200', $code === 200, $code);
http_json($base, ['a' => 'delete', 'id' => $hId, 'proof' => $proof]);

/* Die Riegel stehen vor der Drosselung, und das ist eine eigene Zusage:
   Ein Schreibversuch von einer fremden Seite soll den Besucher:innen kein
   Kontingent nehmen. Stuenden sie dahinter, genuegten zwanzig unsichtbare
   Formulare, und sie koennten eine Stunde lang keine eigene Liste anlegen.
   Deshalb je Riegel mehr abgewiesene Anlegeversuche, als CREATE_LIMIT
   zulaesst, und danach ein gueltiges Anlegen von derselben Adresse.
   Je Riegel eine eigene Reihe von einer eigenen Adresse: Eine gemeinsame
   Reihe, abwechselnd abgewiesen vom einen und vom anderen, fiele erst, wenn
   alle Riegel zugleich hinter der Drosselung stuenden, denn jeder allein
   bekaeme nur einen Teil der Versuche ab und bliebe unter der Grenze. Die
   Grenze wird aus api.php gelesen, damit die Probe bei einer anderen
   Grenze nicht still zu kurz wird. Die Adresse steuert X-Forwarded-For
   (client_ip), so behalten die Drosselproben unten ihr eigenes
   Kontingent. */
preg_match('/const CREATE_LIMIT\s*=\s*(\d+)/', (string) file_get_contents($root . '/api.php'), $m);
$grenze = (int) ($m[1] ?? 0);
$versuche = $grenze + 5;
foreach ([
    'Inhaltstyp'                => ['203.0.113.25', ['Content-Type: text/plain'], 415],
    'Sec-Fetch-Site cross-site' => ['203.0.113.26', [$json, 'Sec-Fetch-Site: cross-site'], 403],
    'fremder Origin'            => ['203.0.113.27', [$json, 'Origin: https://boese.example'], 403],
] as $riegel => [$adresse, $kopf, $erwartet]) {
    $von = 'X-Forwarded-For: ' . $adresse;
    $abgewiesen = [];
    for ($n = 0; $n < $versuche; $n++) {
        [$code] = http_json($base, ['a' => 'create', 'id' => bin2hex(random_bytes(16)), 'proof' => $proof, 'payload' => $payload('fremd')],
            [...$kopf, $von]);
        $abgewiesen[] = $code;
    }
    check("$riegel: $versuche abgewiesene Anlegeversuche, je $erwartet",
        $grenze > 0 && array_count_values($abgewiesen) === [$erwartet => $versuche], array_count_values($abgewiesen));
    [$code] = http_json($base, ['a' => 'create', 'id' => bin2hex(random_bytes(16)), 'proof' => $proof, 'payload' => $payload('eigen')],
        [$json, $eigen, $von]);
    check("$riegel: danach legt dieselbe Adresse noch eine Liste an, kein 429", $code === 200, $code);
}

/* Lesen ist gedrosselt, aber großzügig: Die Grenze steht in api.php. Dieser
   Block steht vor dem Anlege-Spam, denn danach ließe sich keine Liste mehr
   anlegen, an der man lesen könnte.
   Geprüft wird, dass sie greift, und dass sie erst greift, wenn ein
   einzelner Browser sie im Alltag nicht erreicht — eine Superliste mit allen
   Leihlisten, viele Male in der Stunde geöffnet. */
$readId = bin2hex(random_bytes(16));
http_json($base, ['a' => 'create', 'id' => $readId, 'proof' => $proof, 'payload' => $payload('Leiter')]);
/* Eine Zaehlerdatei von vor drei Stunden, wie sie ein Ansehen hinterlaesst,
   das nie etwas anlegt. Seit November 2026 raeumt auch das Lesen auf (etwa
   jede fuenfzigste Anfrage); vorher blieb sie liegen. */
@mkdir($dataDir . '/throttle', 0770, true);
$altZaehler = $dataDir . '/throttle/' . str_repeat('a', 64) . '.json';
file_put_contents($altZaehler, '{"w":0,"n":1}');
touch($altZaehler, time() - 3 * 3600);
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
check('das Lesen räumt alte Zählerdateien weg', !is_file($altZaehler));
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

/* Gezaehlt wird je IPv4-Adresse, aber je IPv6-/64 (address_block in
   api.php): Im eigenen /64 waehlt jeder Anschluss seine Adresse selbst.
   Die Adresse steuert der Test ueber X-Forwarded-For, denn er fragt von
   127.0.0.1, und von dort gilt die letzte Adresse der Kette (client_ip).
   Eine Adresse fuellt ihr Kontingent bis zum ersten 429; dann zeigt eine
   zweite, ob sie auf dasselbe trifft. */
$anlegenVon = static function (string $ip) use ($base, $proof, $payload): int {
    [$code] = http_json($base, ['a' => 'create', 'id' => bin2hex(random_bytes(16)), 'proof' => $proof, 'payload' => $payload('x')],
        ['Content-Type: application/json', 'X-Forwarded-For: ' . $ip]);
    return $code;
};
$fuelle = static function (string $ip) use ($anlegenVon): bool {
    for ($n = 0; $n < 40; $n++) {
        if ($anlegenVon($ip) === 429) {
            return $n >= 10;
        }
    }
    return false;
};

check('IPv6: das Kontingent einer Adresse läuft voll', $fuelle('2001:db8:aaaa:1::1'));
$code = $anlegenVon('2001:0DB8:AAAA:0001:1234:5678:9abc:def0');
check('IPv6: eine andere Adresse im selben /64 teilt es', $code === 429, $code);
$code = $anlegenVon('2001:db8:aaaa:2::1');
check('IPv6: das Nachbar-/64 hat ein eigenes', $code === 200, $code);

check('IPv4: das Kontingent einer Adresse läuft voll', $fuelle('198.51.100.1'));
$code = $anlegenVon('198.51.100.2');
check('IPv4: die Nachbaradresse hat ein eigenes', $code === 200, $code);

check('IPv4-gemappt: das Kontingent läuft voll', $fuelle('::ffff:198.51.100.7'));
$code = $anlegenVon('::ffff:198.51.100.8');
check('IPv4-gemappt: die Nachbaradresse hat ein eigenes', $code === 200, $code);

/* tools/purge.php findet denselben Datenordner wie api.php und meldet einen
   falschen Pfad, statt still nichts zu tun. Bis November 2026 kannte es nur
   data/ neben sich und endete bei verlegtem Ordner mit Status 0. */
$purge = static function (string $args, ?string $env = null): array {
    $cmd = ($env !== null ? 'LEIH_DATA_DIR=' . escapeshellarg($env) . ' ' : 'env -u LEIH_DATA_DIR ')
         . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . '/tools/purge.php') . ' ' . $args . ' 2>&1';
    exec($cmd, $out, $status);
    /* is_file merkt sich, was es zuletzt gesehen hat; das Skript loescht in
       einem anderen Prozess. */
    clearstatcache();
    return [$status, implode("\n", $out)];
};
$wartung = sys_get_temp_dir() . '/leih-purge-' . bin2hex(random_bytes(6));
register_shutdown_function(static function () use ($wartung): void { rmtree($wartung); });
$alt = str_repeat('a', 32);
$neu = str_repeat('b', 32);
@mkdir($wartung . '/lists/aa', 0770, true);
@mkdir($wartung . '/lists/bb', 0770, true);
file_put_contents($wartung . '/lists/aa/' . $alt . '.json', json_encode(['v' => 1, 'updated' => strtotime('2020-01-01')]));
file_put_contents($wartung . '/lists/bb/' . $neu . '.json', json_encode(['v' => 1, 'updated' => time()]));

[$status, $out] = $purge('--days=365 --dry-run --data=' . escapeshellarg($wartung));
check('purge: Probelauf mit --data nennt die alte Liste', $status === 0 && str_contains($out, $alt) && is_file($wartung . '/lists/aa/' . $alt . '.json'), $out);
[$status, $out] = $purge('--days=365', $wartung);
check('purge: über LEIH_DATA_DIR löscht es die alte Liste und lässt die neue', $status === 0
    && !is_file($wartung . '/lists/aa/' . $alt . '.json') && is_file($wartung . '/lists/bb/' . $neu . '.json'), $out);
[$status, $out] = $purge('--days=365 --data=' . escapeshellarg($wartung . '/gibt-es-nicht'));
check('purge: ein falscher Pfad endet mit Status 1', $status === 1 && str_contains($out, 'Kein Datenverzeichnis'), $out);
$leer = $wartung . '/leer';
@mkdir($leer, 0770, true);
[$status] = $purge('--days=365 --data=' . escapeshellarg($leer));
check('purge: ein Ordner ohne Listen ist kein Fehler', $status === 0);

echo $failures === 0
    ? "\nAlle Prüfungen bestanden.\n"
    : "\n{$failures} Prüfung(en) fehlgeschlagen.\n";

exit($failures === 0 ? 0 : 1);
