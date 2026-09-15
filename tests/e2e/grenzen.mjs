import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };
const browser = await chromium.launch({ executablePath: B });
const problems = [];

/* -- 1 · Beim Freund: keine Feier, kein Gedaechtnis --------------------- */
console.log('\n· Beim Freund im Ansehen-Modus');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => problems.push('view: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').first().click();
  await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await page.locator('#chkKeyDone').check();
  for (const n of ['Bohrmaschine', 'Zelt']) {
    await page.locator('#addName').fill(n);
    await page.locator('#addForm button[type=submit]').click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  const viewLink = await page.locator('#linkView').inputValue();
  await page.close();

  const gast = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  gast.on('pageerror', e => problems.push('gast: ' + e.message));
  await gast.goto(viewLink, { waitUntil: 'networkidle' });
  await gast.waitForSelector('.item', { timeout: 10000 });
  await gast.waitForTimeout(600);
  ok('die Liste ist beim Gast lesbar', await gast.locator('.item').count() === 2);
  ok('Gesichter auch beim Gast', await gast.evaluate(() =>
    document.querySelector('.item .item-badge use').getAttribute('href') === '#i-face-frei'));
  ok('kein Stufenchip beim Gast', !(await gast.locator('#levelChip').isVisible()));
  ok('kein Konfetti beim Gast', !(await gast.evaluate(() => !!document.getElementById('konfetti'))));
  const gastSpeicher = await gast.evaluate(() => localStorage.getItem('lid.spiel'));
  ok('auf dem Gerät des Gastes wird nichts gezählt', gastSpeicher === null, String(gastSpeicher));
  await gast.locator('.item-ask').first().click();
  await gast.waitForSelector('#itemModal[open]');
  await gast.waitForTimeout(300);
  ok('auch die Anfrage feiert nicht', !(await gast.evaluate(() => !!document.getElementById('konfetti'))));
  ok('und zählt nichts', await gast.evaluate(() => localStorage.getItem('lid.spiel')) === null);
  await gast.close();
}

/* -- 2 · Abbestellte Bewegung ------------------------------------------ */
console.log('\n· Wenn Bewegung abbestellt ist');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => problems.push('ruhig: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').first().click();
  await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await page.locator('#chkKeyDone').check();
  await page.waitForTimeout(250);
  const k = await page.evaluate(() => {
    const n = document.getElementById('klappe');
    if (!n || n.hidden) return null;
    const cs = getComputedStyle(n);
    return { text: document.getElementById('klappeText').textContent, opacity: cs.opacity, visibility: cs.visibility };
  });
  ok('die Klappe erscheint trotzdem', !!k, 'verborgen');
  ok('und ist auch wirklich sichtbar', k && parseFloat(k.opacity) > .9 && k.visibility === 'visible', JSON.stringify(k));
  ok('das Abzeichen wird trotzdem verliehen', await page.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('lid.spiel') || '{}'); return !!(g.abz && g.abz.schluessel);
  }));
  ok('kein Konfetti', !(await page.evaluate(() => !!document.getElementById('konfetti'))));
  await page.waitForTimeout(1700);
  ok('die Klappe verschwindet wieder', await page.evaluate(() => document.getElementById('klappe').hidden));
  await page.close();
}

/* -- 3 · Loeschen: die neun Sekunden gehoeren dem Rueckweg -------------- */
console.log('\n· Löschen mit Rückgängig');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => problems.push('undo: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').first().click();
  await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await page.locator('#chkKeyDone').check();
  await page.waitForTimeout(2000);
  for (const n of ['Bohrmaschine', 'Zelt', 'Leiter']) {
    await page.locator('#addName').fill(n);
    await page.locator('#addForm button[type=submit]').click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2000);
  await page.locator('.item').first().locator('.itemrow').click();
  await page.waitForSelector('#itemModal[open]');
  await page.locator('#modalFoot button.btn--danger').click();
  await page.waitForTimeout(300);
  ok('die Meldung bietet Rückgängig an', await page.locator('#toastAct').isVisible());
  ok('mit erschrockenem Gesicht', await page.evaluate(() => {
    const u = document.querySelector('#toastText .toast__face use');
    return u && u.getAttribute('href') === '#i-face-schreck';
  }));
  // Waehrend der Frist etwas eintragen: es darf die Meldung nicht verdraengen
  await page.locator('#addName').fill('Hammer');
  await page.locator('#addForm button[type=submit]').click();
  await page.waitForTimeout(300);
  ok('die Rückgängig-Meldung steht noch', await page.locator('#toastAct').isVisible());
  ok('kein Konfetti über dem Rückweg', !(await page.evaluate(() => !!document.getElementById('konfetti'))));
  ok('keine Klappe über dem Rückweg', await page.evaluate(() => document.getElementById('klappe').hidden));
  await page.locator('#toastAct').click();
  await page.waitForTimeout(200);
  ok('der Eintrag kehrt zurück', await page.locator('.item').count() === 4, String(await page.locator('.item').count()));
  await page.close();
}

/* -- 4 · Spracheingabe: mehrere auf einmal ----------------------------- */
console.log('\n· Mehrere auf einmal');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => problems.push('bulk: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').first().click();
  await page.waitForSelector('#keyBox:not([hidden])', { timeout: 15000 });
  await page.locator('#chkKeyDone').check();
  await page.waitForTimeout(2000);
  await page.locator('#btnBulk').click();
  await page.locator('#voiceText').fill('Bohrmaschine, Zelt, Leiter, Waffeleisen, Beamer, Hammer, Säge, Hobel, Bollerwagen, Kreissäge, Schleifer, Zange');
  await page.locator('#btnVoiceApply').click();
  await page.waitForTimeout(900);
  const n = await page.locator('.item').count();
  ok('alle Einträge sind da', n === 12, String(n));
  const g = await page.evaluate(() => JSON.parse(localStorage.getItem('lid.spiel') || '{}'));
  ok('der Zähler springt mit', g.dinge === 12, String(g.dinge));
  ok('das Abzeichen an der Schwelle 1 fällt trotzdem', !!(g.abz && g.abz.erster), JSON.stringify(g.abz));
  const tx = await page.evaluate(() => document.getElementById('toastText').textContent);
  ok('die Meldung über die Menge bleibt stehen', /12|zwölf/i.test(tx), tx);
  await page.close();
}

console.log('\n· Konsole');
ok('keine Fehler auf allen Wegen', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
