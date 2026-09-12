<?php
declare(strict_types=1);

/**
 * Leih-Katalog · leih-ich-dir.de
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

const API_VERSION      = '1.0.0';
const DATA_DIR         = __DIR__ . '/data';
const LISTS_DIR        = DATA_DIR . '/lists';
const THROTTLE_DIR     = DATA_DIR . '/throttle';
const SALT_FILE        = DATA_DIR . '/.salt';

const MAX_REQUEST_SIZE = 1048576;  // 1 MiB Rohanfrage
const MAX_CT_CHARS     = 524288;   // 512 KiB Chiffrat (base64url)
const CREATE_LIMIT     = 20;       // neue Listen pro Fenster und IP
const CREATE_WINDOW    = 3600;     // Sekunden
const THROTTLE_GC_PROB = 50;       // 1 von n Anfragen räumt alte Zählerdateien auf

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
    foreach ([DATA_DIR, LISTS_DIR, THROTTLE_DIR] as $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
            fail(500, 'storage');
        }
    }
    $guard = DATA_DIR . '/.htaccess';
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
    return LISTS_DIR . '/' . substr($id, 0, 2) . '/' . $id . '.json';
}

/** Installationsspezifisches Salz für Ratenbegrenzungs-Hashes. */
function install_salt(): string
{
    $salt = @file_get_contents(SALT_FILE);
    if (is_string($salt) && strlen($salt) >= 32) {
        return $salt;
    }
    $salt = bin2hex(random_bytes(32));
    @file_put_contents(SALT_FILE, $salt, LOCK_EX);
    @chmod(SALT_FILE, 0600);
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
 * Begrenzt das Anlegen neuer Listen pro IP und Zeitfenster.
 * Gespeichert wird nur ein gesalzener Hash der Adresse, nie die Adresse selbst.
 */
function throttle_create(): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $file = THROTTLE_DIR . '/' . hash('sha256', $ip . '|' . install_salt()) . '.json';

    $fh = @fopen($file, 'c+');
    if ($fh === false) {
        return; // Ratenbegrenzung darf den Dienst nicht blockieren
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $rec = json_decode((string) $raw, true);
    $now = time();

    if (!is_array($rec) || ($rec['w'] ?? 0) + CREATE_WINDOW < $now) {
        $rec = ['w' => $now, 'n' => 0];
    }
    $rec['n'] = (int) $rec['n'] + 1;

    rewind($fh);
    ftruncate($fh, 0);
    fwrite($fh, (string) json_encode($rec));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    if ($rec['n'] > CREATE_LIMIT) {
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
    foreach (glob(THROTTLE_DIR . '/*.json') ?: [] as $file) {
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
    ]);
}

/** Liest eine Liste. Mit &rev=<n> wird bei unverändertem Stand nur das gemeldet. */
function action_read(): never
{
    $id = $_GET['id'] ?? '';
    if (!valid_id($id)) {
        fail(400, 'malformed');
    }
    $raw = @file_get_contents(list_path($id));
    if ($raw === false) {
        fail(404, 'notfound');
    }
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

    throttle_create();
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
    fail(400, 'unknown_action');
}

header('Allow: GET, POST');
fail(405, 'method_not_allowed');
