<?php
declare(strict_types=1);

/**
 * Leih-Katalog · leihichdir.de
 * -----------------------------------------------------------------------------
 * Flat-File-Backend. Bewusst "dumm": Der Server kennt ausschließlich Chiffrat.
 *
 * Er speichert pro Liste eine JSON-Datei mit
 *   - verifier : SHA-256 des Schreibnachweises (autorisiert Schreibzugriffe)
 *   - payload  : {iv, ct} – AES-GCM-Chiffrat, im Browser erzeugt
 *   - rev      : Revisionszähler für optimistisches Sperren
 *
 * Der AES-Schlüssel steht im URL-Fragment und erreicht diesen Code nie.
 * Es gibt keine Datenbank, keine Sitzungen, keine Cookies, kein Logging von
 * Inhalten. IP-Adressen werden ausschließlich gesalzen gehasht (Ratenbegrenzung).
 *
 * API (JSON über POST, Lesen über GET):
 *   GET  ?a=ping
 *   GET  ?a=read&id=<id>[&rev=<rev>]
 *   POST {a:"create", id, proof, payload}
 *   POST {a:"write",  id, proof, rev, payload}
 *   POST {a:"delete", id, proof}
 *
 * @license MIT
 */

/* == Konfiguration ========================================================= */

const API_VERSION      = '1.1.0';

/**
 * Ablageort der Daten. Die Umgebungsvariable LEIH_DATA_DIR verlegt ihn, etwa
 * nach außerhalb des DocumentRoot; das ist die robustere Absicherung, weil sie
 * nicht von .htaccess abhängt. Im Virtual Host: SetEnv LEIH_DATA_DIR /var/lib/…
 */
function data_dir(): string
{
    $env = getenv('LEIH_DATA_DIR');
    return (is_string($env) && $env !== '') ? rtrim($env, '/') : __DIR__ . '/data';
}

function lists_dir(): string { return data_dir() . '/lists'; }
function throttle_dir(): string { return data_dir() . '/throttle'; }
function salt_file(): string { return data_dir() . '/.salt'; }
/**
 * Ablageorte des KI-Schlüssels, in dieser Reihenfolge geprüft.
 *
 * Die zweite Fassung ohne führenden Punkt gibt es, weil viele Dateiverwaltungen
 * von Webhostern versteckte Dateien weder anzeigen noch anlegen können. Beide
 * liegen in data/ und sind damit über HTTP gleich gut gesperrt.
 *
 * @return list<string>
 */
function ai_key_files(): array
{
    return [data_dir() . '/.ai-key', data_dir() . '/ai-key.txt'];
}

const MAX_REQUEST_SIZE = 1048576;  // 1 MiB Rohanfrage
const MAX_CT_CHARS     = 524288;   // 512 KiB Chiffrat (base64url)
const CREATE_LIMIT     = 20;       // neue Listen pro Fenster und IP
const CREATE_WINDOW    = 3600;     // Sekunden
const THROTTLE_GC_PROB = 50;       // 1 von n Anfragen räumt alte Zählerdateien auf

/* -- KI-Proxy ---------------------------------------------------------------
 * Für leihichdir.de eingeschaltet. Die Entscheidung ist bewusst gefallen.
 *
 * Der Rest dieser Anwendung ist so gebaut, dass der Server keinen Klartext
 * sehen kann. Der Proxy durchbricht das für genau eine Angabe: den Satz, den
 * jemand ins Mikrofon gesprochen hat. Dieser Satz läuft dann über diesen
 * Server und weiter zu Google, statt vom Gerät aus direkt dorthin.
 *
 * Wer ihn einschaltet, entscheidet sich für Bequemlichkeit (Gäste brauchen
 * keinen eigenen Schlüssel) und gegen die Reinheit der Zusage. Das gehört in
 * die Datenschutzerklärung des Betriebs, nicht in eine Fußnote.
 *
 * Der Schalter allein tut nichts. Ohne hinterlegten Schlüssel meldet ping
 * aiProxy: false, die Aktion antwortet mit 404, und der Browser zerlegt den
 * Text weiterhin selbst. Erst der Schlüssel macht den Proxy scharf:
 *
 *   printf '%s' 'SCHLUESSEL' > data/.ai-key && chmod 600 data/.ai-key
 *   oder data/ai-key.txt, falls die Dateiverwaltung keine Punktdateien kann
 *   oder SetEnv LEIH_AI_KEY … im Virtual Host
 *
 * Der Schlüssel gehört nicht ins Repository; data/ steht in .gitignore.
 * Der Text wird nicht protokolliert und nicht gespeichert.
 * -------------------------------------------------------------------------- */
const AI_PROXY_ENABLED = true;
const AI_ENDPOINT      = 'https://generativelanguage.googleapis.com/v1beta/models/';
/* Am besten belegte Kennung. Eine geänderte Kennung vorher mit einem gültigen
   Schlüssel über GET /v1beta/models prüfen, unangemeldet geht das nicht. */
const AI_MODEL         = 'gemini-2.5-flash';
const AI_MAX_TEXT      = 1500;     // Zeichen je Anfrage
const AI_LIMIT         = 60;       // Anfragen pro Fenster und IP
const AI_WINDOW        = 3600;

/* == Antworten ============================================================= */

/**
 * Sendet eine JSON-Antwort und beendet die Ausführung.
 *
 * @param int                  $code HTTP-Statuscode
 * @param array<string, mixed> $data Antwortkörper
 */
function respond(int $code, array $data): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    /* Die Schnittstelle gehört in keinen Suchindex. Sie gibt nur Chiffrate
       aus, und ein Treffer darauf wäre für niemanden von Nutzen. */
    header('X-Robots-Tag: noindex, nofollow');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** Kurzform für Fehlerantworten. */
function fail(int $code, string $error): never
{
    respond($code, ['error' => $error]);
}

/* == Ablage ================================================================ */

/**
 * Legt die Datenverzeichnisse an und schützt sie zusätzlich per .htaccess.
 * Die mitgelieferte data/.htaccess bleibt die primäre Absicherung; dieser
 * Schritt greift, falls sie beim Deployment verloren geht.
 */
function ensure_dirs(): void
{
    foreach ([data_dir(), lists_dir(), throttle_dir()] as $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
            fail(500, 'storage');
        }
    }
    $guard = data_dir() . '/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents(
            $guard,
            "# Zugriff über den Webserver vollständig unterbinden.\n"
            . "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n"
        );
    }
}

/** Dateipfad einer Liste; die ersten zwei Zeichen bilden ein Unterverzeichnis. */
function list_path(string $id): string
{
    return lists_dir() . '/' . substr($id, 0, 2) . '/' . $id . '.json';
}

/** Installationsspezifisches Salz für Ratenbegrenzungs-Hashes. */
function install_salt(): string
{
    $salt = @file_get_contents(salt_file());
    if (is_string($salt) && strlen($salt) >= 32) {
        return $salt;
    }
    $salt = bin2hex(random_bytes(32));
    @file_put_contents(salt_file(), $salt, LOCK_EX);
    @chmod(salt_file(), 0600);
    return $salt;
}

/** Schreibnachweis → gespeicherter Prüfwert. */
function verifier(string $proof): string
{
    return hash('sha256', $proof);
}

/* == Eingabevalidierung ==================================================== */

/** Liest und dekodiert den JSON-Anfragekörper. @return array<string, mixed> */
function request_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, MAX_REQUEST_SIZE + 1);
    if ($raw === false || $raw === '') {
        fail(400, 'empty');
    }
    if (strlen($raw) > MAX_REQUEST_SIZE) {
        fail(413, 'toolarge');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail(400, 'malformed');
    }
    return $data;
}

/** Listen-IDs sind 16 zufällige Bytes in Hex-Schreibweise. */
function valid_id(mixed $id): bool
{
    return is_string($id) && preg_match('/^[0-9a-f]{32}$/', $id) === 1;
}

/** Der Schreibnachweis ist ein SHA-256 in base64url ohne Auffüllzeichen. */
function valid_proof(mixed $proof): bool
{
    return is_string($proof) && preg_match('/^[A-Za-z0-9_-]{43}$/', $proof) === 1;
}

/**
 * Prüft die Struktur des Chiffrats, nicht dessen Inhalt.
 *
 * @return array{iv: string, ct: string}
 */
function valid_payload(mixed $payload): array
{
    if (!is_array($payload) || !isset($payload['iv'], $payload['ct'])) {
        fail(400, 'malformed');
    }
    $iv = $payload['iv'];
    $ct = $payload['ct'];
    if (!is_string($iv) || preg_match('/^[A-Za-z0-9_-]{16}$/', $iv) !== 1) {
        fail(400, 'malformed');
    }
    if (!is_string($ct) || preg_match('/^[A-Za-z0-9_-]+$/', $ct) !== 1) {
        fail(400, 'malformed');
    }
    if (strlen($ct) > MAX_CT_CHARS) {
        fail(413, 'toolarge');
    }
    return ['iv' => $iv, 'ct' => $ct];
}

/* == Ratenbegrenzung ======================================================= */

/**
 * Begrenzt Anfragen pro IP und Zeitfenster.
 * Gespeichert wird nur ein gesalzener Hash der Adresse, nie die Adresse selbst.
 *
 * @param string $bucket Name des Zählers, trennt Anlegen und KI-Anfragen
 */
function throttle(string $bucket, int $limit, int $window): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $file = throttle_dir() . '/' . hash('sha256', $bucket . '|' . $ip . '|' . install_salt()) . '.json';

    $fh = @fopen($file, 'c+');
    if ($fh === false) {
        return; // Ratenbegrenzung darf den Dienst nicht blockieren
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $rec = json_decode((string) $raw, true);
    $now = time();

    if (!is_array($rec) || ($rec['w'] ?? 0) + $window < $now) {
        $rec = ['w' => $now, 'n' => 0];
    }
    $rec['n'] = (int) $rec['n'] + 1;

    rewind($fh);
    ftruncate($fh, 0);
    fwrite($fh, (string) json_encode($rec));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    if ($rec['n'] > $limit) {
        fail(429, 'ratelimit');
    }
}

/** Entfernt gelegentlich abgelaufene Zählerdateien. */
function throttle_gc(): void
{
    if (random_int(1, THROTTLE_GC_PROB) !== 1) {
        return;
    }
    $cutoff = time() - (CREATE_WINDOW * 2);
    foreach (glob(throttle_dir() . '/*.json') ?: [] as $file) {
        if (@filemtime($file) < $cutoff) {
            @unlink($file);
        }
    }
}

/* == Aktionen ============================================================== */

/** Dienstkennung – der Client erkennt daran ein echtes PHP-Backend. */
function action_ping(): never
{
    respond(200, [
        'ok'         => true,
        'service'    => 'leih-katalog',
        'version'    => API_VERSION,
        'maxPayload' => MAX_CT_CHARS,
        'aiProxy'    => ai_available(),
    ]);
}

/** Liest eine Liste. Mit &rev=<n> wird bei unverändertem Stand nur das gemeldet. */
function action_read(): never
{
    $id = $_GET['id'] ?? '';
    if (!valid_id($id)) {
        fail(400, 'malformed');
    }
    /* Mit geteilter Sperre lesen. action_write schreibt in dieselbe Datei
       (ftruncate, dann fwrite) und haelt dabei LOCK_EX; ein ungesperrtes
       file_get_contents traf das Fenster dazwischen und bekam eine leere
       oder halbe Datei. Der Leser sah dann 500 corrupt fuer eine Liste, der
       nichts fehlt — und im Freundeskreis bietet der Aufklapper fuer diesen
       Status bewusst kein "Erneut versuchen" an. LOCK_SH laesst beliebig
       viele Leser gleichzeitig zu und haelt nur den Schreiber auf. */
    $fh = @fopen(list_path($id), 'rb');
    if ($fh === false) {
        fail(404, 'notfound');
    }
    if (!flock($fh, LOCK_SH)) {
        fclose($fh);
        fail(503, 'busy');
    }
    $raw = (string) stream_get_contents($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    $rec = json_decode($raw, true);
    if (!is_array($rec)) {
        fail(500, 'corrupt');
    }
    $clientRev = isset($_GET['rev']) ? (int) $_GET['rev'] : 0;
    if ($clientRev > 0 && $clientRev === (int) $rec['rev']) {
        respond(200, ['rev' => (int) $rec['rev'], 'unchanged' => true]);
    }
    respond(200, [
        'rev'     => (int) $rec['rev'],
        'updated' => (int) $rec['updated'],
        'payload' => $rec['payload'],
    ]);
}

/**
 * Legt eine neue Liste an. Die ID stammt aus dem Browser, damit sie in die
 * Verschlüsselung eingebunden werden kann; Kollisionen scheitern am Modus 'x'.
 *
 * @param array<string, mixed> $in
 */
function action_create(array $in): never
{
    $id = $in['id'] ?? '';
    $proof = $in['proof'] ?? '';
    if (!valid_id($id) || !valid_proof($proof)) {
        fail(400, 'malformed');
    }
    $payload = valid_payload($in['payload'] ?? null);

    throttle('create', CREATE_LIMIT, CREATE_WINDOW);
    throttle_gc();

    $path = list_path($id);
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        fail(500, 'storage');
    }

    $fh = @fopen($path, 'x');
    if ($fh === false) {
        fail(409, 'exists');
    }
    $now = time();
    $rec = [
        'v'        => 1,
        'verifier' => verifier($proof),
        'rev'      => 1,
        'created'  => $now,
        'updated'  => $now,
        'payload'  => $payload,
    ];
    fwrite($fh, (string) json_encode($rec, JSON_UNESCAPED_SLASHES));
    fclose($fh);
    @chmod($path, 0660);

    respond(200, ['id' => $id, 'rev' => 1, 'updated' => $now]);
}

/**
 * Überschreibt eine Liste. Erfordert den Schreibnachweis und die Revision,
 * auf der die Änderung beruht (optimistisches Sperren).
 *
 * @param array<string, mixed> $in
 */
function action_write(array $in): never
{
    $id = $in['id'] ?? '';
    $proof = $in['proof'] ?? '';
    if (!valid_id($id) || !valid_proof($proof)) {
        fail(400, 'malformed');
    }
    $payload = valid_payload($in['payload'] ?? null);
    $baseRev = isset($in['rev']) ? (int) $in['rev'] : 0;

    $fh = @fopen(list_path($id), 'r+');
    if ($fh === false) {
        fail(404, 'notfound');
    }
    if (!flock($fh, LOCK_EX)) {
        fail(503, 'busy');
    }
    $rec = json_decode((string) stream_get_contents($fh), true);
    if (!is_array($rec) || !isset($rec['verifier'])) {
        fail(500, 'corrupt');
    }
    if (!hash_equals((string) $rec['verifier'], verifier($proof))) {
        fail(403, 'forbidden');
    }
    if ($baseRev !== (int) $rec['rev']) {
        respond(409, ['error' => 'conflict', 'rev' => (int) $rec['rev']]);
    }

    $rec['rev'] = (int) $rec['rev'] + 1;
    $rec['updated'] = time();
    $rec['payload'] = $payload;

    rewind($fh);
    ftruncate($fh, 0);
    fwrite($fh, (string) json_encode($rec, JSON_UNESCAPED_SLASHES));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    respond(200, ['rev' => $rec['rev'], 'updated' => $rec['updated']]);
}

/**
 * Löscht eine Liste unwiderruflich.
 *
 * @param array<string, mixed> $in
 */
function action_delete(array $in): never
{
    $id = $in['id'] ?? '';
    $proof = $in['proof'] ?? '';
    if (!valid_id($id) || !valid_proof($proof)) {
        fail(400, 'malformed');
    }
    $path = list_path($id);
    $raw = @file_get_contents($path);
    if ($raw === false) {
        fail(404, 'notfound');
    }
    $rec = json_decode($raw, true);
    if (!is_array($rec) || !hash_equals((string) ($rec['verifier'] ?? ''), verifier($proof))) {
        fail(403, 'forbidden');
    }
    @unlink($path);
    respond(200, ['ok' => true]);
}

/* == KI-Proxy ============================================================== */

/** Liest den Schlüssel aus der Umgebung oder aus einer der Schlüsseldateien. */
function ai_key(): string
{
    $env = getenv('LEIH_AI_KEY');
    if (is_string($env) && $env !== '') {
        return trim($env);
    }
    foreach (ai_key_files() as $path) {
        $content = @file_get_contents($path);
        if (is_string($content) && trim($content) !== '') {
            return trim($content);
        }
    }
    return '';
}

function ai_available(): bool
{
    return AI_PROXY_ENABLED && ai_key() !== '';
}

/**
 * Dieselbe Anweisung wie im Browser: ausschließlich ein JSON-Array,
 * kein Markdown, keine Erklärung.
 */
function ai_system_prompt(): string
{
    return implode("\n", [
        'You convert a spoken inventory description into structured data.',
        'Return ONLY a valid JSON array. No markdown, no code fences, no commentary, no other keys.',
        'Format: [{"item": "Gegenstandsname", "status": "available"}]',
        'Rules:',
        '- "status" is exactly "available" or "lent". Use "lent" only when the speaker states the thing is currently lent out, borrowed or otherwise unavailable.',
        '- Keep "item" in the language the speaker used. Use a short, singular, capitalised noun phrase without articles, numerals or filler words.',
        '- Split enumerations into separate entries. If a count is stated, repeat the entry that many times, at most ten.',
        '- Ignore anything that is not a lendable object.',
        '- If nothing usable is present, return [].',
    ]);
}

/**
 * Sendet eine Anfrage an die KI. Nutzt cURL, wo vorhanden, sonst Streams,
 * damit auch einfaches Shared Hosting bedient wird.
 *
 * @return string|null Antwortkörper oder null bei einem Fehlschlag
 */
function ai_post(string $url, string $body, string $key): ?string
{
    $headers = ['Content-Type: application/json', 'x-goog-api-key: ' . $key];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
        ]);
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($status === 200 && is_string($response)) ? $response : null;
    }

    $context = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", $headers),
        'content'       => $body,
        'timeout'       => 20,
        'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($url, false, $context);
    return is_string($response) && $response !== '' ? $response : null;
}

/**
 * Wandelt gesprochenen Freitext in Einträge. Der Text wird weitergereicht und
 * danach verworfen: kein Protokoll, keine Ablage, keine Zuordnung zu einer Liste.
 *
 * @param array<string, mixed> $in
 */
function action_ai(array $in): never
{
    if (!ai_available()) {
        fail(404, 'disabled');
    }
    $text = $in['text'] ?? '';
    if (!is_string($text) || trim($text) === '') {
        fail(400, 'malformed');
    }
    $text = mb_substr(trim($text), 0, AI_MAX_TEXT);

    throttle('ai', AI_LIMIT, AI_WINDOW);
    throttle_gc();

    $request = json_encode([
        'systemInstruction' => ['parts' => [['text' => ai_system_prompt()]]],
        'contents'          => [['role' => 'user', 'parts' => [['text' => $text]]]],
        'generationConfig'  => [
            'temperature'      => 0,
            'responseMimeType' => 'application/json',
            /* Groß geschriebene Typen: der Dialekt ist eine Auswahl aus
               OpenAPI 3.0, nicht JSON Schema. responseSchema ist als
               abgekündigt markiert, arbeitet aber in v1 und v1beta. */
            'responseSchema'   => [
                'type'  => 'ARRAY',
                'items' => [
                    'type'       => 'OBJECT',
                    'properties' => [
                        'item'   => ['type' => 'STRING'],
                        'status' => ['type' => 'STRING', 'enum' => ['available', 'lent']],
                    ],
                    'required' => ['item', 'status'],
                ],
            ],
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $raw = ai_post(AI_ENDPOINT . rawurlencode(AI_MODEL) . ':generateContent', (string) $request, ai_key());
    if ($raw === null) {
        fail(502, 'upstream');
    }

    $data = json_decode($raw, true);
    $text = $data['candidates'][0]['content']['parts'][0]['text'] ?? null;
    if (!is_string($text)) {
        fail(502, 'upstream');
    }

    $items = json_decode($text, true);
    if (!is_array($items)) {
        fail(502, 'upstream');
    }

    /* Nur bekannte Felder weiterreichen, in begrenzter Menge und Länge. */
    $clean = [];
    foreach (array_slice($items, 0, 50) as $entry) {
        if (!is_array($entry) || !isset($entry['item']) || !is_string($entry['item'])) {
            continue;
        }
        $name = trim($entry['item']);
        if (mb_strlen($name) < 2) {
            continue;
        }
        $clean[] = [
            'item'   => mb_substr($name, 0, 80),
            'status' => (($entry['status'] ?? '') === 'lent') ? 'lent' : 'available',
        ];
    }

    respond(200, ['items' => $clean]);
}

/* == Einstiegspunkt ======================================================== */

ensure_dirs();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $action = $_GET['a'] ?? '';
    if ($action === 'ping') {
        action_ping();
    }
    if ($action === 'read') {
        action_read();
    }
    fail(400, 'unknown_action');
}

if ($method === 'POST') {
    $in = request_body();
    $action = is_string($in['a'] ?? null) ? $in['a'] : '';
    if ($action === 'create') {
        action_create($in);
    }
    if ($action === 'write') {
        action_write($in);
    }
    if ($action === 'delete') {
        action_delete($in);
    }
    if ($action === 'ai') {
        action_ai($in);
    }
    fail(400, 'unknown_action');
}

header('Allow: GET, POST');
fail(405, 'method_not_allowed');
