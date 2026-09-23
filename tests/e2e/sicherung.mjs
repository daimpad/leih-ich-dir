/*
 * Sichern, Wiederherstellen und das Lebenszeichen.
 *
 * Zusagen, die das Fortbestehen der Daten betreffen: Die Sicherung einer
 * Leihliste traegt die Liste, aber keinen Zugang. Aus ihr entsteht eine neue
 * Liste mit neuen Links. Die Sicherung einer Superliste traegt die
 * gesammelten Ansehen-Links — fremden Zugang also, absichtlich und laut
 * angesagt —, aber nicht den Zugang zur Superliste selbst und kein Token.
 * Und eine Liste, die laenger als dreissig Tage nicht geschrieben wurde,
 * bekommt beim Oeffnen mit Zugang ein Lebenszeichen — beim Ansehen nicht.
 *
 * Das Lebenszeichen laesst sich nur pruefen, wenn der Datensatz aelter ist,
 * als ein Test warten kann. Die Suite greift deshalb neben der Anwendung in
 * data/lists/ und setzt den Zeitstempel zurueck; die Ablage liegt auf
 * demselben Rechner, das ist bei diesen Suiten die Voraussetzung.
 */
import { starteBrowser, BASE, pruefer, macheListe, liesListe, L } from './hilfe.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const DATEN = process.env.LEIH_DATA_DIR || join(HIER, '..', '..', 'data');
const datensatz = (id) => join(DATEN, 'lists', id.slice(0, 2), id + '.json');
const lies = (id) => JSON.parse(readFileSync(datensatz(id), 'utf8'));
const TAG = 86400;

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 }, locale: 'de-DE', acceptDownloads: true });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') { fehler.push('console: ' + m.text()); } });

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });

console.log('· Sichern');
const anna = await macheListe(p, L('Annas Keller', 'Anna', [
  { id: 'i1', name: 'Bohrmaschine', note: 'mit Koffer', status: 'available', borrower: '', since: '' },
  { id: 'i2', name: 'Rasenmäher', note: '', status: 'lent', borrower: 'Carla', since: '2026-08-01' }
], { showBorrower: true }));
ok('Testliste angelegt', anna.status === 200, String(anna.status));

await p.goto(BASE + '/#v=' + anna.id + '.' + anna.keyStr, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(400);
ok('beim Ansehen gibt es nichts zu sichern', await p.locator('#backupBox').isHidden());

await p.goto(BASE + '/#e=' + anna.id + '.' + anna.keyStr + '.' + anna.token, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(500);
ok('beim Bearbeiten steht der Aufklapper', !(await p.locator('#backupBox').isHidden()));
await p.evaluate(() => { document.querySelector('#backupBox').open = true; });
const [download] = await Promise.all([
  p.waitForEvent('download'),
  p.locator('#btnBackup').click()
]);
const name = download.suggestedFilename();
ok('die Datei heisst nach Liste und Tag', /^leihliste-annas-keller-\d{4}-\d{2}-\d{2}\.json$/.test(name), name);
const pfad = await download.path();
const text = readFileSync(pfad, 'utf8');
const datei = JSON.parse(text);
ok('sie traegt die Liste im Klartext',
   datei.title === 'Annas Keller' && datei.contact.name === 'Anna' && datei.items.length === 2
   && datei.items[1].borrower === 'Carla' && datei.showBorrower === true, text.slice(0, 160));
ok('aber weder Kennung noch Schluessel noch Token',
   !text.includes(anna.id) && !text.includes(anna.keyStr) && !text.includes(anna.token));
ok('und ist als Sicherung gekennzeichnet',
   datei.leihichdir === 1 && datei.kind === 'list' && /^\d{4}-\d{2}-\d{2}T/.test(datei.exported));

console.log('· Wiederherstellen');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
ok('der Weg steht auf der Startseite neben dem Anlegen', await p.locator('#btnRestore').isVisible());
ok('das Dateifeld selbst bleibt verborgen', await p.locator('#backupFile').isHidden());
await p.locator('#backupFile').setInputFiles(pfad);
await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(900);
const hash = await p.evaluate(() => location.hash);
ok('es entsteht eine neue Liste mit eigenem Zugang',
   /^#e=/.test(hash) && !hash.includes(anna.id) && !hash.includes(anna.keyStr), hash.slice(0, 24));
const namen = await p.evaluate(() => Array.from(document.querySelectorAll('#itemList .item-name')).map(n => n.textContent));
ok('mit denselben Gegenstaenden', namen.join('|') === 'Bohrmaschine|Rasenmäher', namen.join('|'));
ok('der Zugangskasten steht offen, denn die Links sind neu', !(await p.locator('#keyBox').isHidden()));
ok('die Meldung sagt es', (await p.locator('#toastText').textContent()).includes('neue Liste'),
   await p.locator('#toastText').textContent());
const neuTeile = hash.slice(3).split('.');
const drueben = await liesListe(p, neuTeile[0] + '.' + neuTeile[1]);
ok('und auf dem Server liegt sie vollstaendig',
   drueben.doc.title === 'Annas Keller' && drueben.doc.contact.name === 'Anna' && drueben.doc.items.length === 2
   && drueben.doc.items[1].status === 'lent');
ok('der Wiederherstellen-Verweis ist wieder frei', !(await p.evaluate(() => document.querySelector('#btnRestore').disabled)));

console.log('· Die Superliste sichern');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(800);
const kAlt = (await p.evaluate(() => location.hash)).slice(3).split('.');
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
await p.locator('#circleAddLink').fill('#v=' + anna.id + '.' + anna.keyStr);
await p.locator('#circleAddName').fill('Anna');
await p.locator('#btnCircleAdd').click();
await p.waitForTimeout(1500);
ok('die Superliste zeigt Annas zwei Sachen',
   (await p.locator('#circleItems > li:not([hidden])').count()) === 2);

ok('der Aufklapper zum Sichern steht da', !(await p.locator('#circleBackupBox').isHidden()));
await p.evaluate(() => { document.querySelector('#circleBackupBox').open = true; });
const [kDownload] = await Promise.all([
  p.waitForEvent('download'),
  p.locator('#btnCircleBackup').click()
]);
const kName = kDownload.suggestedFilename();
ok('die Datei heisst nach Superliste und Tag',
   /^superliste-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/.test(kName), kName);
const kPfad = await kDownload.path();
const kText = readFileSync(kPfad, 'utf8');
const kDatei = JSON.parse(kText);
ok('sie traegt die gesammelte Leihliste mit Kennung, Schluessel und Beschriftung',
   kDatei.leihichdir === 1 && kDatei.kind === 'circle' && kDatei.friends.length === 1
   && kDatei.friends[0].id === anna.id && kDatei.friends[0].key === anna.keyStr
   && kDatei.friends[0].label === 'Anna', kText.slice(0, 200));
/* Der springende Punkt: Fremden Ansehen-Zugang traegt die Datei absichtlich
   — das ist der Zweck und steht so in der Warnung. Den Zugang zur Superliste
   selbst traegt sie nicht, und ein Token keiner der beiden. */
ok('aber keinen Zugang zur Superliste selbst',
   !kText.includes(kAlt[0]) && !kText.includes(kAlt[1]) && !kText.includes(kAlt[2]));
ok('und kein Token irgendeiner Leihliste',
   !kText.includes(anna.token) && !/"token"/.test(kText));

console.log('· Die Superliste wiederherstellen');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
await p.locator('#backupFile').setInputFiles(kPfad);
await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(2000);
const kNeu = (await p.evaluate(() => location.hash));
const kNeuTeile = kNeu.slice(3).split('.');
ok('es entsteht eine neue Superliste mit eigenem Zugang',
   /^#k=/.test(kNeu) && kNeuTeile[0] !== kAlt[0] && kNeuTeile[1] !== kAlt[1]
   && kNeuTeile[2] !== kAlt[2], kNeu.slice(0, 24));
ok('die Meldung sagt es', (await p.locator('#toastText').textContent()).includes('neue Superliste'),
   await p.locator('#toastText').textContent());
ok('der Zugangskasten steht offen, denn der Link ist neu',
   !(await p.locator('#circleKeyBox').isHidden()));
ok('und Annas zwei Sachen stehen wieder da',
   (await p.locator('#circleItems > li:not([hidden])').count()) === 2);
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
ok('mit der Beschriftung aus der Datei',
   /Anna/.test(await p.locator('#circleFriends li').first().textContent()));

console.log('· Keine Sicherung');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
const muell = join(tmpdir(), 'lid-keine-sicherung.json');
/* Bis zu dieser Aenderung stand hier ein Superlisten-Dokument und die
   Zusicherung, es werde abgewiesen. Die Anforderung ist abgeloest, nicht
   verletzt: Beide Arten lassen sich jetzt wiederherstellen. Geprueft wird
   deshalb, was weiterhin keine Sicherung ist — ein Dokument ohne beides. */
writeFileSync(muell, JSON.stringify({ leihichdir: 1, kind: 'list', title: 'x' }));
await p.locator('#backupFile').setInputFiles(muell);
await p.waitForTimeout(500);
ok('ein Dokument ohne Gegenstaende und ohne Leihlisten wird abgewiesen',
   (await p.locator('#toastText').textContent()).includes('keine Sicherung'),
   await p.locator('#toastText').textContent());
ok('und die Startseite bleibt', await p.locator('#viewStart').isVisible());
writeFileSync(muell, 'das ist kein JSON');
await p.locator('#backupFile').setInputFiles(muell);
await p.waitForTimeout(500);
ok('Unlesbares ebenso', (await p.locator('#toastText').textContent()).includes('keine Sicherung'));

console.log('· Lebenszeichen der Leihliste');
const vorher = lies(anna.id);
const alt = Math.floor(Date.now() / 1000) - 40 * TAG;
vorher.updated = alt;
writeFileSync(datensatz(anna.id), JSON.stringify(vorher));
await p.goto(BASE + '/#v=' + anna.id + '.' + anna.keyStr, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(1500);
let jetzt = lies(anna.id);
ok('Ansehen schreibt nicht, auch nach vierzig Tagen nicht',
   jetzt.updated === alt && jetzt.rev === vorher.rev, jetzt.updated + ' / rev ' + jetzt.rev);
await p.goto(BASE + '/#e=' + anna.id + '.' + anna.keyStr + '.' + anna.token, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(2500);
jetzt = lies(anna.id);
ok('Bearbeiten nach vierzig Tagen schreibt ein Lebenszeichen',
   jetzt.updated > alt + 30 * TAG && jetzt.rev === vorher.rev + 1, jetzt.updated + ' / rev ' + jetzt.rev);
const nachher = await liesListe(p, anna.id + '.' + anna.keyStr);
ok('und laesst den Inhalt unveraendert',
   nachher.doc.title === 'Annas Keller' && nachher.doc.items.length === 2 && nachher.doc.items[1].borrower === 'Carla');
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(2000);
const nochmal = lies(anna.id);
ok('ein zweites Oeffnen schreibt nicht noch einmal', nochmal.rev === jetzt.rev, nochmal.rev + ' / ' + jetzt.rev);

console.log('· Lebenszeichen der Superliste');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(800);
const kh = await p.evaluate(() => location.hash);
const kid = kh.slice(3).split('.')[0];
const kVorher = lies(kid);
kVorher.updated = alt;
writeFileSync(datensatz(kid), JSON.stringify(kVorher));
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.goto(BASE + '/' + kh, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(2500);
const kJetzt = lies(kid);
ok('die Superliste bekommt ihr Lebenszeichen ebenso',
   kJetzt.rev === kVorher.rev + 1 && kJetzt.updated > alt + 30 * TAG, kJetzt.rev + ' / ' + kJetzt.updated);

ok('keine Ausnahme', fehler.length === 0, fehler.join(' | '));
await br.close();
process.exit(bilanz());
