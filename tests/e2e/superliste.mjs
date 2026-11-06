/*
 * Die Superliste unterscheidet ihre Listen und fuehrt zum Gegenstand.
 *
 * Bis November 2026:
 * - hiessen gesammelte Listen ohne Kontaktnamen alle "Meine Leihliste",
 *   den Standardtitel, unter "Listen sammeln" wie in jedem Treffer;
 * - standen Linkfeld und "Aufnehmen" vor dem Namen, ohne Formular; Enter
 *   im Linkfeld tat nichts;
 * - liess sich der Name einer gesammelten Liste spaeter nicht aendern;
 * - oeffnete ein Treffer die Liste oben, ohne den Gegenstand zu zeigen.
 */
import { starteBrowser, BASE, pruefer, macheListe, liesListe, L } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
const p = await ctx.newPage();
p.on('pageerror', (e) => probleme.push('pageerror: ' + e.message));

const ding = (id, name, status) => ({ id, name, note: '', status: status || 'available', borrower: '', since: status === 'lent' ? '2026-10-01' : '' });
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
const a = await macheListe(p, L('Meine Leihliste', '', [ding('a1', 'Zelt')]));
const englisch = await macheListe(p, L('My lending list', '', [ding('e1', 'Kamera')]));
const sachen = [];
for (let i = 0; i < 30; i++) { sachen.push(ding('s' + i, 'Sache ' + i)); }
sachen[25] = ding('zoll', 'Zollstock');
const voll = await macheListe(p, L('Werkstatt', 'Ben', sachen));

await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
const kreisIdKey = (await p.evaluate(() => location.hash)).slice(3).split('.').slice(0, 2).join('.');
await p.locator('#kreisTab1').click();
const namen = () => p.locator('#circleFriends .item-name').allTextContents();

console.log('· Aufnehmen mit Enter');
{
  await p.locator('#circleAddLink').fill('#v=' + a.id + '.' + a.keyStr);
  await p.locator('#circleAddLink').press('Enter');
  await p.waitForTimeout(800);
  ok('Enter im Linkfeld nimmt auf', (await p.locator('#circleFriends li').count()) === 1);
  ok('das Linkfeld ist danach leer', (await p.locator('#circleAddLink').inputValue()) === '');

  await p.locator('#circleAddLink').fill('#v=' + englisch.id + '.' + englisch.keyStr);
  await p.locator('#circleAddLink').press('Tab');
  ok('nach dem Linkfeld kommt der Name', await p.evaluate(() => document.activeElement.id === 'circleAddName'));
  await p.keyboard.press('Tab');
  ok('dann Aufnehmen', await p.evaluate(() => document.activeElement.id === 'btnCircleAdd'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);

  await p.locator('#circleAddLink').fill('#v=' + voll.id + '.' + voll.keyStr);
  await p.locator('#circleAddName').fill('Benno');
  await p.locator('#circleAddName').press('Enter');
  await p.waitForTimeout(1000);
  ok('Enter im Namensfeld nimmt mit Namen auf', (await namen()).some((n) => n.includes('Benno')), (await namen()).join(' | '));
}

console.log('· Der Standardtitel ist kein Name');
{
  const n = await namen();
  ok('keine gesammelte Liste heisst "Meine Leihliste"', !n.some((x) => /Meine Leihliste/.test(x)), n.join(' | '));
  ok('auch nicht "My lending list"', !n.some((x) => /My lending list/.test(x)));
  ok('beide heissen "Ohne Namen"', n.filter((x) => /Ohne Namen/.test(x)).length === 2, n.join(' | '));
}

console.log('· Spaeter benennen');
{
  const stift = p.locator('#circleFriends [data-kreis-act="rename"]').first();
  ok('der Stift traegt den Namen im Namen', /Namen ändern: Ohne Namen/.test(await stift.getAttribute('aria-label')));
  await stift.click();
  await p.waitForTimeout(200);
  ok('ein Feld erscheint, mit dem Fokus darin', await p.evaluate(() => !!document.activeElement && document.activeElement.hasAttribute('data-kreis-name')));
  await p.keyboard.type('Anna');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  ok('Enter uebernimmt', (await namen())[0].includes('Anna'), (await namen()).join(' | '));
  ok('der Fokus steht wieder auf dem Stift', await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-kreis-act') === 'rename'));
  ok('und gespeichert ist es auch', (await liesListe(p, kreisIdKey)).doc.friends[0].label === 'Anna');

  await p.locator('#circleFriends [data-kreis-act="rename"]').first().click();
  await p.waitForTimeout(200);
  await p.keyboard.type('XYZ');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('Escape bricht ab', (await namen())[0].includes('Anna') && !(await namen())[0].includes('XYZ'));

  await p.locator('#circleFriends [data-kreis-act="rename"]').first().click();
  await p.waitForTimeout(200);
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  ok('leer heisst wieder der Name aus der Liste', (await namen())[0].includes('Ohne Namen'), (await namen()).join(' | '));
}

console.log('· Ein Treffer fuehrt zum Gegenstand');
{
  await p.locator('#kreisTab2').click();
  await p.locator('#circleQ').fill('zollstock');
  await p.waitForTimeout(300);
  const treffer = p.locator('#circleItems .item:not([hidden]) a.itemrow');
  ok('genau ein Treffer', (await treffer.count()) === 1);
  await treffer.first().click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 10000 });
  await p.waitForTimeout(600);
  const lage = await p.evaluate(() => {
    const li = Array.from(document.querySelectorAll('#itemList .item')).find((x) => x.getAttribute('data-id') === 'zoll');
    const r = li.getBoundingClientRect();
    return { sichtbar: r.top >= 0 && r.bottom <= innerHeight, fokus: li.contains(document.activeElement), knopf: document.activeElement && document.activeElement.getAttribute('data-act') };
  });
  ok('die Zeile steht im Bild', lage.sichtbar);
  ok('der Fokus liegt darin', lage.fokus);
  ok('und zwar auf "Anfragen"', lage.knopf === 'ask', lage.knopf);
}

console.log('· Ein gewoehnlicher Ansehen-Link springt nicht');
{
  await p.goto(BASE + '/?x=1#v=' + voll.id + '.' + voll.keyStr, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);
  ok('oben, wie bisher', await p.evaluate(() => scrollY === 0));
}

ok('keine Ausnahme', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
