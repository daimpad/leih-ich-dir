/*
 * Was die Vorlesestimme hoert.
 *
 * Bis November 2026:
 * - war #saveState eine Live-Region, und jeder Tastendruck schrieb "Nicht
 *   gespeichert" hinein; 22 Zeichen im Titel ergaben 22 Ansagen;
 * - blieb das Hinzufuegen stumm, sobald das Spiel keine Meldung hatte,
 *   ab dem elften Ding also immer;
 * - trug der Sprachknopf kein lang, und "Switch to English" klang deutsch;
 * - setzte nur render() den Seitentitel; Superliste, Fehler und Startseite
 *   erbten den der zuletzt geoeffneten Liste, auf Englisch blieb er
 *   deutsch;
 * - hiess die Fussnavigation "Rechtliches", obwohl sie auch "So geht's"
 *   und "Ueber" fuehrt.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); }
  /* Alles mitschreiben, was in eine Live-Region kommt. */
  window.__ansagen = [];
  new MutationObserver((ms) => {
    for (const m of ms) {
      const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const r = n && n.closest('[aria-live]');
      /* Mehrere Aenderungen eines Augenblicks lesen denselben Stand; der
         wird nur einmal gezaehlt. */
      const eintrag = r && r.textContent.trim() ? r.id + ': ' + r.textContent.trim() : null;
      if (eintrag && window.__ansagen[window.__ansagen.length - 1] !== eintrag) { window.__ansagen.push(eintrag); }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
});
const p = await ctx.newPage();
p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));
const ansagen = () => p.evaluate(() => window.__ansagen.slice());
const leeren = () => p.evaluate(() => { window.__ansagen = []; });

console.log('· Startseite');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
ok('Titel der Startseite', (await p.title()).startsWith('LeihIchDir · '), await p.title());
ok('der Sprachknopf traegt lang="en"', (await p.locator('#btnLang').getAttribute('lang')) === 'en');
ok('die Fussnavigation heisst "Weitere Seiten"', (await p.locator('.footer-nav').getAttribute('aria-label')) === 'Weitere Seiten');

console.log('· Tippen und Hinzufuegen');
{
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(500);
  ok('Titel der eigenen Liste', (await p.title()).startsWith('Deine Leihliste'), await p.title());
  ok('#saveState ist keine Live-Region', !(await p.locator('#saveState').getAttribute('aria-live')));
  await leeren();
  await p.locator('#listTitleInput').click();
  await p.keyboard.type(' fuer die Werkstatt', { delay: 30 });
  await p.waitForTimeout(400);
  const beimTippen = await ansagen();
  ok('beim Tippen keine Ansage "Nicht gespeichert"', !beimTippen.some((a) => /Nicht gespeichert/.test(a)), beimTippen.slice(0, 4).join(' | '));

  for (let i = 1; i <= 11; i++) {
    await leeren();
    await p.locator('#addName').fill('Ding ' + i);
    await p.locator('#addForm button[type=submit]').click();
    await p.waitForTimeout(250);
  }
  const elftes = await ansagen();
  ok('auch das elfte Ding wird angesagt', elftes.some((a) => a === 'ansage: Ding 11 hinzugefügt.'), elftes.join(' | '));
}

console.log('· Speichern hakt, dann wieder nicht');
{
  await p.waitForTimeout(2500);
  let sperre = true;
  await p.route('**/api.php', (r) => (sperre && r.request().method() === 'POST') ? r.abort('failed') : r.continue());
  await leeren();
  await p.locator('#addName').fill('Leiter');
  await p.locator('#addForm button[type=submit]').click();
  await p.waitForTimeout(3500);
  const haken = await ansagen();
  ok('der Haken wird angesagt, von der Meldung', haken.some((a) => /^toastRegion: Der Server antwortet gerade nicht/.test(a)), haken.join(' | '));
  ok('und nur einmal', haken.filter((a) => /antwortet gerade nicht|Wartet auf den Server/.test(a)).length === 1, haken.join(' | '));
  sperre = false;
  await leeren();
  await p.waitForTimeout(6000);
  ok('und danach "Gespeichert"', (await ansagen()).some((a) => a === 'ansage: Gespeichert'), (await ansagen()).join(' | '));
  await p.unroute('**/api.php');
}

console.log('· Titel je Ansicht');
{
  await p.locator('#lnkHome, a.brand').first().click().catch(() => p.goto(BASE + '/', { waitUntil: 'networkidle' }));
  await p.waitForTimeout(600);
  if (!(await p.locator('#viewStart').isVisible())) { await p.goto(BASE + '/', { waitUntil: 'networkidle' }); }
  ok('zurueck auf der Startseite ihr Titel', (await p.title()).startsWith('LeihIchDir · '), await p.title());
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  ok('Titel der Superliste', (await p.title()).startsWith('Deine Superliste'), await p.title());
  await p.goto(BASE + '/?x=1#v=' + 'c'.repeat(32) + '.' + 'A'.repeat(43), { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewError:not([hidden])');
  ok('Titel der Fehlerseite', (await p.title()).startsWith('Das hat nicht geklappt'), await p.title());
}

console.log('· Englisch');
{
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnLang').click();
  await p.waitForTimeout(300);
  ok('der Starttitel wird englisch', /Lend things/.test(await p.title()), await p.title());
  ok('der Sprachknopf traegt jetzt lang="de"', (await p.locator('#btnLang').getAttribute('lang')) === 'de');
  ok('die Fussnavigation heisst "More pages"', (await p.locator('.footer-nav').getAttribute('aria-label')) === 'More pages');
  await p.goto(BASE + '/einstellungen.html', { waitUntil: 'networkidle' });
  ok('Titel der Einstellungen englisch', (await p.title()) === 'Settings · LeihIchDir', await p.title());
  await p.locator('#btnLang').click();
  await p.waitForTimeout(300);
  ok('und deutsch', (await p.title()) === 'Einstellungen · LeihIchDir', await p.title());
}

console.log('· Seiten ohne app.js');
for (const seite of ['so-gehts.html', 'ueber.html', 'impressum.html', 'datenschutz.html']) {
  await p.goto(BASE + '/' + seite, { waitUntil: 'domcontentloaded' });
  ok(seite + ': Fussnavigation "Weitere Seiten"', (await p.locator('.footer-nav').getAttribute('aria-label')) === 'Weitere Seiten');
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
