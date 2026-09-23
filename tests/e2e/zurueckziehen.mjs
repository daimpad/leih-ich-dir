/*
 * Den Ansehen-Link zurueckziehen.
 *
 * Die Liste wird unter einem neuen Schluessel neu verschluesselt und bekommt
 * ein neues Token, bei gleicher Kennung. Danach muss gelten: Der alte
 * Ansehen-Link scheitert mit einem Wort, das den Fall benennt; der alte
 * Bearbeiten-Link darf auch nicht mehr schreiben — sonst koennte ein noch
 * offenes Fenster den Widerruf still aufheben; der neue Link zeigt die Liste;
 * eine Superliste, die den alten Schluessel haelt, meldet die Liste als
 * nicht mehr passend und bietet kein "Erneut versuchen" an; das Gedaechtnis
 * dieses Geraets traegt den neuen Zugang; und auf dem Server liegt derselbe
 * Datensatz, eine Revision weiter, mit dem alten Schluessel unlesbar.
 */
import { starteBrowser, BASE, pruefer, macheListe, liesListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const ctx = await br.newContext({ viewport: { width: 1000, height: 1200 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') { fehler.push('console: ' + m.text()); } });
/* Die Rueckfrage wird bestaetigt; ihr Wortlaut wird festgehalten. */
let rueckfrage = '';
p.on('dialog', d => { rueckfrage = d.message(); d.accept(); });

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });

const anna = await macheListe(p, L('Annas Keller', 'Anna', [
  { id: 'i1', name: 'Bohrmaschine', note: 'mit Koffer', status: 'available', borrower: '', since: '' },
  { id: 'i2', name: 'Leiter', note: '', status: 'available', borrower: '', since: '' }
]));
ok('Testliste angelegt', anna.status === 200, String(anna.status));
const altView = '#v=' + anna.id + '.' + anna.keyStr;
const altEdit = '#e=' + anna.id + '.' + anna.keyStr + '.' + anna.token;

console.log('· Vorher: eine Superliste haelt den alten Schluessel');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(600);
const kh = await p.evaluate(() => location.hash);
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
await p.locator('#circleAddLink').fill(altView);
await p.locator('#btnCircleAdd').click();
await p.waitForTimeout(1200);
ok('die Superliste zeigt Annas zwei Sachen',
   (await p.locator('#circleItems > li:not([hidden])').count()) === 2);

console.log('· Zurueckziehen');
await p.goto(BASE + '/' + altEdit, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(500);
ok('beim Ansehen-Link steht der Knopf', await p.locator('#btnRevoke').isVisible());
const revVorher = (await liesListe(p, anna.id + '.' + anna.keyStr)).rev;
await p.locator('#btnRevoke').click();
await p.waitForTimeout(1500);
ok('die Rueckfrage nennt beide Links', /Bearbeiten-Link/.test(rueckfrage) && /Ansehen-Link/.test(rueckfrage), rueckfrage);
const neuHash = await p.evaluate(() => location.hash);
const neuTeile = neuHash.slice(3).split('.');
ok('das Fragment traegt neuen Schluessel und neues Token bei gleicher Kennung',
   /^#e=/.test(neuHash) && neuTeile[0] === anna.id && neuTeile[1] !== anna.keyStr && neuTeile[2] !== anna.token,
   neuHash.slice(0, 30));
ok('der Zugangskasten steht offen, mit dem neuen Bearbeiten-Link',
   !(await p.locator('#keyBox').isHidden()) && (await p.locator('#keyLink').inputValue()).includes(neuTeile[1]));
ok('der Ansehen-Link im Kasten ist der neue',
   (await p.locator('#linkView').inputValue()).includes('#v=' + anna.id + '.' + neuTeile[1]));
ok('die Meldung sagt es', (await p.locator('#toastText').textContent()).includes('Zurückgezogen'),
   await p.locator('#toastText').textContent());
ok('das Gedaechtnis traegt den neuen Zugang',
   await p.evaluate((h) => (localStorage.getItem('lid.mine') || '').includes(h), neuHash));

console.log('· Danach: alt scheitert, neu traegt');
const drueben = await liesListe(p, anna.id + '.' + neuTeile[1]);
ok('auf dem Server liegt derselbe Datensatz eine Revision weiter, unter dem neuen Schluessel lesbar',
   drueben.rev === revVorher + 1 && drueben.doc.items.length === 2 && drueben.doc.title === 'Annas Keller',
   drueben.rev + ' / ' + revVorher);
let altLesbar = true;
try { await liesListe(p, anna.id + '.' + anna.keyStr); } catch (e) { altLesbar = false; }
ok('mit dem alten Schluessel ist er unlesbar', !altLesbar);

/* Und das Wichtigste: Das alte Token darf auch nicht mehr schreiben. Sonst
   koennte ein Fenster, das die Liste noch unter dem alten Schluessel offen
   haelt, sie beim naechsten Tastendruck in der alten Verschluesselung
   zurueckschreiben — der Widerruf waere still aufgehoben, und der eben
   notierte neue Link passte nicht mehr. Geschrieben wird hier unmittelbar
   ueber die Schnittstelle, mit dem Nachweis aus dem alten Token. */
const vorProbe = fehler.length;
const altSchreibt = await p.evaluate(async (arg) => {
  const enc = (b) => { let s = ''; for (const x of b) { s += String.fromCharCode(x); }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const proof = enc(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(arg.token))));
  const r = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'write', id: arg.id, proof: proof, rev: arg.rev,
                           payload: { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' } }) });
  return r.status;
}, { id: anna.id, token: anna.token, rev: drueben.rev });
ok('das alte Token schreibt nicht mehr', altSchreibt === 403, String(altSchreibt));
/* Der Browser schreibt jedes abgewiesene fetch in die Konsole. Dieses 403 hat
   die Probe eben selbst herbeigefuehrt; es waere der einzige Fund am Ende und
   ein falscher. Herausgenommen wird genau das, was seit vorProbe dazukam und
   nach einem abgewiesenen Abruf aussieht — kein pauschales Stummschalten. */
fehler.splice(vorProbe, fehler.length - vorProbe,
  ...fehler.slice(vorProbe).filter(z => !/403 \(Forbidden\)/.test(z)));

await p.goto(BASE + '/' + altView, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
ok('der alte Ansehen-Link fuehrt in die Fehleransicht', await p.locator('#viewError').isVisible());
ok('und die benennt den Fall', /passt nicht mehr/.test(await p.locator('#errorText').textContent()),
   await p.locator('#errorText').textContent());
await p.goto(BASE + '/' + altEdit, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
ok('der alte Bearbeiten-Link ebenso', await p.locator('#viewError').isVisible());

await p.goto(BASE + '/#v=' + anna.id + '.' + neuTeile[1], { waitUntil: 'networkidle' });
await p.waitForSelector('#viewList:not([hidden])');
await p.waitForTimeout(500);
ok('der neue Ansehen-Link zeigt die Liste',
   (await p.locator('#itemList .item-name').allTextContents()).join('|') === 'Bohrmaschine|Leiter');

console.log('· Die Superliste mit dem alten Schluessel');
await p.goto(BASE + '/' + kh, { waitUntil: 'networkidle' });
await p.waitForSelector('#viewCircle:not([hidden])');
await p.waitForTimeout(1500);
ok('sie zeigt nichts mehr von Anna', (await p.locator('#circleItems > li:not([hidden])').count()) === 0);
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
const zeile = await p.locator('#circleFriends li').first().textContent();
ok('der Aufklapper benennt den Fall', /passt nicht mehr/.test(zeile), zeile.trim().slice(0, 80));
ok('und bietet kein "Erneut versuchen" an', (await p.locator('#circleFriends [data-kreis-act="retry"]').count()) === 0);
ok('die Zahl nennt die fehlende Leihliste', /1 Leihliste konnte nicht geladen werden/.test(await p.locator('#circleCount').textContent()),
   await p.locator('#circleCount').textContent());

ok('keine Ausnahme', fehler.length === 0, fehler.join(' | '));
await br.close();
process.exit(bilanz());
