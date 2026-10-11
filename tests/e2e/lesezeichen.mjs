/*
 * Der Zugang im dritten Schritt: erst der Link, dann das Sichern.
 *
 * Seit Oktober 2026 steht unter dem Bearbeiten-Link, ruhig wie frisch, wie
 * man ihn sichert: als Lesezeichen auf die Seite, denn ihre Adresse ist der
 * Link. Und dass er nicht der zum Teilen ist. Danach folgt das Sichern als
 * eigener Aufklapper, nur im dritten Schritt; vorher lag es zugeklappt in
 * der Karte des Schritts, ueber dem Zugang. Die Superliste folgt derselben
 * Ordnung, ohne den Satz zum zweiten Link: Sie hat nur einen.
 *
 * Festgehalten wird auch, worauf der Satz baut: Die Adresse der Seite ist
 * der Link im Feld, auch nach dem Zurueckziehen.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const SATZ_DE = 'Setz ein Lesezeichen auf diese Seite — ihre Adresse ist dieser Link, und ohne ihn kannst Du Dein Inventar nicht mehr bearbeiten. Zum Teilen gibt es einen anderen, den Ansehen-Link.';
const SATZ_EN = 'Bookmark this page — its address is this link, and without it you can no longer edit your inventory. For sharing there is a different one, the view link.';
const KREIS_DE = 'Setz ein Lesezeichen auf diese Seite — ihre Adresse ist dieser Link, und ohne ihn kommst Du nicht mehr an Deine Superliste.';

async function neu(breite) {
  const ctx = await br.newContext({ viewport: { width: breite || 1280, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
  const p = await ctx.newPage();
  p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') { probleme.push(m.text()); } });
  p.on('dialog', d => d.accept());
  return { ctx, p };
}

const sichtbar = (p, sel) => p.locator(sel).isVisible();
const satz = (p, kasten) => p.locator('#' + kasten + ' .keybox__lesezeichen').evaluate(n => n.textContent.replace(/\s+/g, ' ').trim());
/* Die Reihenfolge, wie man sie sieht: Oberkante von Schritt, Zugang und
   Sichern. */
const lage = (p, ids) => p.evaluate((ids) => ids.map(id => {
  const n = document.getElementById(id);
  return n.hidden ? null : Math.round(n.getBoundingClientRect().top + scrollY);
}), ids);

console.log('· Leihliste, frisch angelegt');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(400);

  ok('im Inventar: der Zugang mit dem Satz zum Lesezeichen', await sichtbar(p, '#keyBox .keybox__lesezeichen') &&
     await satz(p, 'keyBox') === SATZ_DE, await satz(p, 'keyBox'));
  ok('aber kein Sichern', !(await sichtbar(p, '#backupBox')));
  ok('die Adresse der Seite ist der Link im Feld', await p.evaluate(() => location.href) === await p.locator('#keyLink').inputValue());
  await p.locator('#schrittTab2').click();
  ok('im Kontakt ebenso kein Sichern', !(await sichtbar(p, '#backupBox')) && await sichtbar(p, '#keyBox'));

  await p.locator('#schrittTab3').click();
  await p.waitForTimeout(200);
  const [schritt, zugang, sichern] = await lage(p, ['shareBox', 'keyBox', 'backupBox']);
  ok('im dritten Schritt: erst der Schritt, dann der Zugang, dann das Sichern',
     schritt !== null && zugang !== null && sichern !== null && schritt < zugang && zugang < sichern, [schritt, zugang, sichern].join(' < '));
  ok('das Sichern steht nicht mehr in der Karte des Schritts',
     await p.evaluate(() => !document.getElementById('shareBox').contains(document.getElementById('backupBox'))));
  ok('es ist zugeklappt, eine Zeile mit "Sichern"',
     !(await p.locator('#backupBox').evaluate(n => n.open)) && !(await sichtbar(p, '#btnBackup')) &&
     (await p.locator('#backupBox summary').textContent()).trim() === 'Sichern');
  await p.locator('#backupBox summary').click();
  ok('aufgeklappt steht der Knopf zum Sichern', await sichtbar(p, '#btnBackup'));

  /* Nach dem Haken geht die Bitte, der Satz bleibt. */
  await p.locator('#chkKeyDone').check();
  await p.waitForTimeout(300);
  ok('ruhig steht der Satz weiter unter dem Feld', await sichtbar(p, '#keyBox .keybox__lesezeichen') &&
     !(await p.locator('#keyBox').evaluate(n => n.classList.contains('keybox--frisch'))));
  ok('die Nebenbemerkung geht mit der Bitte', !(await sichtbar(p, '#keyRemember')));
  await p.locator('#schrittTab1').click();
  ok('ruhig im Inventar: weder Zugang noch Sichern', !(await sichtbar(p, '#keyBox')) && !(await sichtbar(p, '#backupBox')));

  console.log('· Nach dem Zurueckziehen');
  await p.locator('#schrittTab3').click();
  await p.locator('#btnRevoke').click();
  await p.waitForTimeout(1500);
  ok('die Adresse der Seite ist der neue Link im Feld',
     await p.evaluate(() => location.href) === await p.locator('#keyLink').inputValue());

  console.log('· Auf Englisch');
  await p.locator('#btnLang').click();
  await p.waitForTimeout(300);
  ok('der Satz auf Englisch', await satz(p, 'keyBox') === SATZ_EN, await satz(p, 'keyBox'));
  ok('und das Sichern heisst Back up', (await p.locator('#backupBox summary').textContent()).trim() === 'Back up');
  await p.locator('#btnLang').click();

  console.log('· Beim Freund');
  const link = await p.locator('#linkView').inputValue();
  await p.goto(link, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);
  ok('weder Zugang noch Sichern', !(await sichtbar(p, '#keyBox')) && !(await sichtbar(p, '#backupBox')));
  await ctx.close();
}

console.log('· Superliste');
{
  const { ctx, p } = await neu();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(400);
  ok('der Satz zum Lesezeichen, ohne einen zweiten Link', await satz(p, 'circleKeyBox') === KREIS_DE, await satz(p, 'circleKeyBox'));
  ok('die Adresse der Seite ist der Zugangs-Link', await p.evaluate(() => location.href) === await p.locator('#circleKeyLink').inputValue());
  ok('im ersten Schritt kein Sichern', !(await sichtbar(p, '#circleBackupBox')));
  await p.locator('#kreisSchritte [data-schritt="3"]').click();
  await p.waitForTimeout(200);
  const [schritt, zugang, sichern] = await lage(p, ['circleShareBox', 'circleKeyBox', 'circleBackupBox']);
  ok('im dritten Schritt: erst der Schritt, dann der Zugang, dann das Sichern',
     schritt !== null && zugang !== null && sichern !== null && schritt < zugang && zugang < sichern, [schritt, zugang, sichern].join(' < '));
  ok('zugeklappt, und aufgeklappt mit dem Knopf', !(await sichtbar(p, '#btnCircleBackup')) &&
     await p.locator('#circleBackupBox summary').click().then(() => sichtbar(p, '#btnCircleBackup')));
  await p.locator('#chkCircleKeyDone').check();
  await p.waitForTimeout(300);
  ok('ruhig bleibt der Satz', await sichtbar(p, '#circleKeyBox .keybox__lesezeichen'));
  await p.locator('#kreisSchritte [data-schritt="2"]').click();
  ok('im zweiten Schritt weder Zugang noch Sichern', !(await sichtbar(p, '#circleKeyBox')) && !(await sichtbar(p, '#circleBackupBox')));
  await ctx.close();
}

console.log('· Schmal');
for (const breite of [390, 320]) {
  const { ctx, p } = await neu(breite);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await p.locator('#schrittTab3').click();
  await p.locator('#backupBox summary').click();
  await p.waitForTimeout(200);
  const ueber = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(breite + 'px: Satz und Sichern laufen nicht ueber', ueber <= 0 && await sichtbar(p, '#btnBackup'), String(ueber));
  await ctx.close();
}

ok('keine Ausnahme und keine Fehlermeldung in der Konsole', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
