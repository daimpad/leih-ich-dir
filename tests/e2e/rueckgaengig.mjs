/*
 * Rueckgaengig bleibt, solange man es ansteuert, und gibt es auch fuer
 * "Mehrere auf einmal".
 *
 * Bis November 2026 lief die Meldung mit Rueckweg fest neun Sekunden. Wer
 * mit der Tastatur bis zum Knopf brauchte oder den Zeiger schon darauf
 * hatte, sah sie unter sich verschwinden (WCAG 2.2.1). Die Sammeleingabe
 * trug gar keinen Rueckweg, obwohl ihre Zerlegung sich leicht irrt.
 *
 * In der Superliste hing das Schreiben an einer eigenen Uhr von neun
 * Sekunden. Seit die Meldung stehen bleiben kann, haengt es an ihrem Ende;
 * geprueft wird beides: kein Schreiben, solange sie steht, und Schreiben,
 * wenn sie geht.
 *
 * Laeuft rund eine Minute, weil es auf die Uhr der Meldung wartet.
 */
import { starteBrowser, BASE, pruefer, macheListe, liesListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

async function neu() {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
  return { ctx, p };
}

const sichtbar = (p) => p.locator('#toastAct').isVisible();

async function listeMitDreien(p) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  for (const n of ['Bohrmaschine', 'Zelt', 'Leiter']) {
    await p.locator('#addName').fill(n);
    await p.locator('#addForm button[type=submit]').click();
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(400);
}

async function ersteLoeschen(p) {
  await p.locator('.item').first().locator('.itemrow').click();
  await p.waitForSelector('#itemModal[open]');
  await p.locator('#modalFoot button.btn--danger').click();
  await p.waitForTimeout(300);
}

console.log('· Ohne Zutun geht die Meldung nach der Frist');
{
  const { ctx, p } = await neu();
  await listeMitDreien(p);
  await ersteLoeschen(p);
  await p.mouse.move(5, 5);
  ok('Rueckgaengig steht da', await sichtbar(p));
  await p.waitForTimeout(9600);
  ok('nach gut neun Sekunden ist es weg', !(await sichtbar(p)));
  ok('und der Eintrag bleibt geloescht', (await p.locator('.item').count()) === 2);
  await ctx.close();
}

console.log('· Unter dem Mauszeiger bleibt sie');
{
  const { ctx, p } = await neu();
  await listeMitDreien(p);
  await ersteLoeschen(p);
  await p.locator('#toastAct').hover();
  await p.waitForTimeout(11000);
  ok('nach elf Sekunden unter dem Zeiger steht sie noch', await sichtbar(p));
  await p.mouse.move(5, 5);
  await p.waitForTimeout(2000);
  ok('kurz nach dem Wegziehen noch', await sichtbar(p));
  await p.waitForTimeout(8500);
  ok('danach geht sie', !(await sichtbar(p)));
  await ctx.close();
}

console.log('· Mit dem Fokus darauf bleibt sie');
{
  const { ctx, p } = await neu();
  await listeMitDreien(p);
  await ersteLoeschen(p);
  await p.mouse.move(5, 5);
  await p.locator('#toastAct').focus();
  await p.waitForTimeout(11000);
  ok('nach elf Sekunden mit Fokus steht sie noch', await sichtbar(p));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  ok('Enter nimmt das Loeschen zurueck', (await p.locator('.item').count()) === 3);
  ok('und die Meldung ist weg', !(await sichtbar(p)));
  await ctx.close();
}

console.log('· Mehrere auf einmal');
{
  const { ctx, p } = await neu();
  await listeMitDreien(p);
  await p.locator('#btnBulk').click();
  await p.waitForSelector('#voiceBox:not([hidden])');
  const text = 'Hammer, Leiter ist gerade bei Ben, Kamera';
  await p.locator('#voiceText').fill(text);
  await p.locator('#btnVoiceApply').click();
  await p.waitForTimeout(800);
  ok('drei Eintraege dazu', (await p.locator('.item').count()) === 6, String(await p.locator('.item').count()));
  ok('die Meldung bietet Rueckgaengig an', await sichtbar(p));
  await p.locator('#toastAct').click();
  await p.waitForTimeout(300);
  ok('Rueckgaengig nimmt alle drei heraus', (await p.locator('.item').count()) === 3, String(await p.locator('.item').count()));
  ok('die alten bleiben', (await p.locator('.item').allTextContents()).join('|').includes('Bohrmaschine'));
  ok('das Feld ist wieder offen', await p.locator('#voiceBox').isVisible());
  ok('mit dem Text darin', (await p.locator('#voiceText').inputValue()) === text);
  await ctx.close();
}

console.log('· Superliste: entfernen, halten, zuruecknehmen');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const anna = await macheListe(p, L('Annas Liste', 'Anna', [{ id: 'a1', name: 'Zelt', note: '', status: 'available', borrower: '', since: '' }]));
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
  const kreisHash = await p.evaluate(() => location.hash);
  const kreisIdKey = kreisHash.slice(3).split('.').slice(0, 2).join('.');
  await p.locator('#kreisTab1').click();
  await p.locator('#circleAddLink').fill('#v=' + anna.id + '.' + anna.keyStr);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(800);
  const freunde = async () => (await liesListe(p, kreisIdKey)).doc.friends.length;
  ok('Anna steht in der Superliste', (await freunde()) === 1);

  await p.locator('#circleFriends [data-kreis-act="remove"]').first().click();
  await p.waitForTimeout(300);
  await p.locator('#toastAct').hover();
  await p.waitForTimeout(11000);
  ok('solange die Meldung steht, wird nicht geschrieben', (await freunde()) === 1);
  await p.locator('#toastAct').click();
  await p.waitForTimeout(500);
  ok('nach Rueckgaengig steht sie hier wieder', (await p.locator('#circleFriends li').count()) === 1);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  ok('und nach dem Neuladen auch', (await freunde()) === 1);

  await p.locator('#kreisTab1').click();
  await p.locator('#circleFriends [data-kreis-act="remove"]').first().click();
  await p.mouse.move(5, 5);
  await p.waitForTimeout(10000);
  ok('geht die Meldung von selbst, ist sie entfernt', (await freunde()) === 0);
  await ctx.close();
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
