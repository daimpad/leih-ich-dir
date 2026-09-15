import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };

console.log('· Deutsch bleibt die Standardsprache');
for (const [locale, name] of [['en-US','englischer Browser'], ['fr-FR','franzoesischer Browser'], ['de-DE','deutscher Browser']]) {
  const ctx = await br.newContext({ locale });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({ lang: document.documentElement.lang,
    h1: document.querySelector('#viewStart h1').innerText.replace(/\s+/g,' ').trim(),
    schalter: document.querySelector('#btnLang').textContent.trim() }));
  ok(name + ': deutsch', m.lang === 'de' && /Leih ich Dir/.test(m.h1), JSON.stringify(m));
  ok(name + ': Schalter bietet EN an', m.schalter === 'EN', m.schalter);
  await ctx.close();
}
{
  const ctx = await br.newContext({ locale: 'en-US' });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('#btnLang').click();
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({ lang: document.documentElement.lang, gemerkt: localStorage.getItem('lid.lang') }));
  ok('die ausdrueckliche Wahl greift weiterhin', m.lang === 'en' && m.gemerkt === 'en', JSON.stringify(m));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  ok('und ueberlebt das Neuladen', await p.evaluate(() => document.documentElement.lang) === 'en');
  await ctx.close();
}

console.log('· Das leere Fenster steht nicht mehr unter der Fusszeile');
{
  const ctx = await br.newContext({ viewport: { width: 900, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  for (const s of ['/', '/einstellungen.html']) {
    await p.goto(BASE + '' + s, { waitUntil: 'networkidle' });
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => Array.from(document.querySelectorAll('dialog')).map(d => {
      const r = d.getBoundingClientRect();
      return { id: d.id, offen: d.open, sichtbar: r.width > 0 && r.height > 0 };
    }));
    ok(s + ': kein sichtbares geschlossenes Fenster', m.every(d => d.offen || !d.sichtbar), JSON.stringify(m));
  }
  await ctx.close();
}

console.log('· Details ergaenzen steht in der Zeile');
{
  const ctx = await br.newContext({ viewport: { width: 900, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const fehler = [];
  p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });
  await p.goto(BASE + '/');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });
  await p.reload({ waitUntil: 'networkidle' });
  await p.locator('#btnCreateHero').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(700);
  await p.locator('#addName').fill('Bohrmaschine');
  await p.locator('#addForm button[type=submit]').click();
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const zeile = document.querySelector('#itemList .itemrow');
    const mehr = zeile && zeile.querySelector('.item-more');
    const chev = zeile && zeile.querySelector('.item-chev');
    const r = mehr && mehr.getBoundingClientRect(), rz = zeile.getBoundingClientRect();
    return { text: mehr && mehr.textContent, sichtbar: !!(r && r.width > 0),
             rechts: !!(r && r.x > rz.x + rz.width / 2), vorDemPfeil: !!(chev && r && r.x < chev.getBoundingClientRect().x) };
  });
  ok('die Beschriftung steht da', m.text === 'Details ergänzen', JSON.stringify(m.text));
  ok('sichtbar', m.sichtbar);
  ok('rechts in der Zeile', m.rechts);
  ok('vor dem Pfeil', m.vorDemPfeil);
  // Oeffnet die Zeile weiterhin das Fenster?
  await p.locator('#itemList .itemrow').first().click();
  await p.waitForTimeout(400);
  ok('die Zeile oeffnet weiterhin das Fenster', await p.evaluate(() => document.querySelector('#itemModal').open));
  ok('und das Fenster rollt im Rumpf', await p.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#itemModal'));
    return s.display === 'flex' && s.flexDirection === 'column';
  }));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  // Englisch
  await p.evaluate(() => localStorage.setItem('lid.lang','en'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  ok('auf Englisch Add details', await p.evaluate(() => {
    const m = document.querySelector('#itemList .item-more'); return m && m.textContent; }) === 'Add details');
  // Schmal
  await p.setViewportSize({ width: 380, height: 800 });
  await p.waitForTimeout(250);
  ok('schmal entfaellt sie', await p.evaluate(() =>
    getComputedStyle(document.querySelector('#itemList .item-more')).display) === 'none');
  ok('kein Ueberlauf schmal', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('keine Konsolenfehler', fehler.length === 0, fehler.slice(0,2).join(' | '));
  await ctx.close();
}
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
