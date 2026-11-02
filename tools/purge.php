<?php
declare(strict_types=1);

/**
 * Leih-Katalog · Wartungsskript
 * -----------------------------------------------------------------------------
 * Entfernt Listen, die seit N Tagen nicht mehr geschrieben wurden, damit
 * verwaiste Chiffrate nicht unbegrenzt liegen (Datensparsamkeit). Fuer
 * leihichdir.de ist es nicht optional: Die Datenschutzerklaerung sagt die
 * Loeschung nach einem Jahr zu, also muss es dort regelmaessig laufen
 * (README, Plesk, Schritt 7).
 *
 * Aufruf ausschließlich auf der Kommandozeile:
 *   php tools/purge.php --days=365 [--dry-run] [--data=/pfad/zum/datenordner]
 *
 * Beispiel für einen Cron-Eintrag (täglich um 4:15 Uhr):
 *   15 4 * * * /usr/bin/php /var/www/leih-ich-dir/tools/purge.php --days=365
 *
 * @license MIT
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Dieses Skript läuft nur auf der Kommandozeile.\n");
}

$options = getopt('', ['days::', 'dry-run', 'data::']);
$days = isset($options['days']) ? max(1, (int) $options['days']) : 365;
$dryRun = array_key_exists('dry-run', $options);

/* Derselbe Datenordner wie in api.php (data_dir()): zuerst --data, dann die
   Umgebung LEIH_DATA_DIR, sonst data/ neben der Anwendung. Das Argument gibt
   es, weil ein geplanter Task in Plesk die SetEnv-Zeilen des Virtual Host
   nicht erbt; bis November 2026 kannte das Skript nur data/ neben sich und
   lief bei verlegtem Ordner ins Leere, mit Status 0. */
$env = getenv('LEIH_DATA_DIR');
if (isset($options['data']) && is_string($options['data']) && $options['data'] !== '') {
    $dataDir = rtrim($options['data'], '/');
} elseif (is_string($env) && $env !== '') {
    $dataDir = rtrim($env, '/');
} else {
    $dataDir = dirname(__DIR__) . '/data';
}

/* Fehlt der Ordner, ist der Aufruf falsch eingerichtet: Status 1, damit der
   Task es meldet, statt jede Nacht still nichts zu tun. Fehlen nur die Listen
   darin, wurde noch keine angelegt, und es gibt nichts zu tun. */
if (!is_dir($dataDir)) {
    fwrite(STDERR, "Kein Datenverzeichnis gefunden: {$dataDir}\n");
    exit(1);
}
$listsDir = $dataDir . '/lists';
if (!is_dir($listsDir)) {
    printf("Noch keine Listen in %s.\n", $dataDir);
    exit(0);
}

$cutoff = time() - ($days * 86400);
$checked = 0;
$removed = 0;

/** @var SplFileInfo $file */
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($listsDir, FilesystemIterator::SKIP_DOTS)) as $file) {
    if (!$file->isFile() || $file->getExtension() !== 'json') {
        continue;
    }
    $checked++;

    // Bevorzugt den im Datensatz vermerkten Zeitstempel, ersatzweise die Dateizeit.
    $record = json_decode((string) @file_get_contents($file->getPathname()), true);
    $updated = is_array($record) && isset($record['updated']) ? (int) $record['updated'] : (int) $file->getMTime();

    if ($updated > $cutoff) {
        continue;
    }
    $removed++;
    if ($dryRun) {
        printf("[dry-run] würde löschen: %s (zuletzt %s)\n", $file->getFilename(), date('Y-m-d', $updated));
        continue;
    }
    @unlink($file->getPathname());
}

printf(
    "%d Listen geprüft, %d %s (Grenze: %d Tage).\n",
    $checked,
    $removed,
    $dryRun ? 'zum Löschen vorgemerkt' : 'gelöscht',
    $days
);
