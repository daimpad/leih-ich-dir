<?php
declare(strict_types=1);

/**
 * Leih-Katalog · Wartungsskript (optional)
 * -----------------------------------------------------------------------------
 * Entfernt Listen, die seit N Tagen nicht mehr geschrieben wurden. Sinnvoll,
 * um verwaiste Chiffrate nicht unbegrenzt vorzuhalten (Datensparsamkeit).
 *
 * Aufruf ausschließlich auf der Kommandozeile:
 *   php tools/purge.php --days=365 [--dry-run]
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

$options = getopt('', ['days::', 'dry-run']);
$days = isset($options['days']) ? max(1, (int) $options['days']) : 365;
$dryRun = array_key_exists('dry-run', $options);

$listsDir = dirname(__DIR__) . '/data/lists';
if (!is_dir($listsDir)) {
    exit("Kein Datenverzeichnis gefunden: {$listsDir}\n");
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
