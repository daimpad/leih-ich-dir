/*
 * VORUEBERGEHEND. Eine absichtlich fallende Zusicherung, damit der erste
 * Lauf der Browsertests bei einem Pull Request einmal rot wird: Eine
 * Waechterin, die noch nie gefallen ist, hat noch nichts bewiesen
 * (CLAUDE.md). Der naechste Commit nimmt die Datei wieder heraus.
 */
import { pruefer } from './hilfe.mjs';
const { ok, bilanz } = pruefer();
ok('Gegenprobe: diese Zusicherung faellt absichtlich', false);
process.exit(bilanz());
