import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };
const browser = await chromium.launch({ executablePath: B });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));

const neueListe = async (titel) => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').click();
  await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await page.locator('#chkKeyDone').check();
  await page.waitForTimeout(2300);
  await page.locator('#listTitleInput').fill(titel);
  await page.waitForTimeout(1300);
  return page.url();
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
await page.reload({ waitUntil: 'networkidle' });

console.log('\n· Wortmarke');
ok('Schreibweise LeihIchDir', (await page.locator('.brand-word').innerText()).replace(/\s/g, '') === 'LeihIchDir',
   await page.locator('.brand-word').innerText());
ok('die mittlere Silbe bleibt farbig', (await page.locator('.brand-ich').innerText()) === 'Ich');

console.log('\n· Eine Liste: direkt hin');
const l1 = await neueListe('Werkstatt');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const href1 = await page.locator('#lnkMine').getAttribute('href');
ok('der Verweis trägt den Zugangslink', /#e=/.test(href1), href1);
await page.locator('#lnkMine').click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(400);
ok('ein Klick führt in die Liste', await page.locator('#viewList').isVisible());
ok('und zwar in die richtige', (await page.locator('#listTitleInput').inputValue()) === 'Werkstatt',
   await page.locator('#listTitleInput').inputValue());

console.log('\n· Mehrere Listen: zum Kasten');
await neueListe('Küche');
await neueListe('Garten');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const href2 = await page.locator('#lnkMine').getAttribute('href');
ok('der Verweis führt zum Kasten', href2 === './#meine', href2);
const vorher = await page.evaluate(() => window.scrollY);
await page.locator('#lnkMine').click();
await page.waitForTimeout(900);
const nachher = await page.evaluate(() => window.scrollY);
ok('die Seite springt nach unten', nachher > vorher + 100, vorher + ' → ' + nachher);
const sichtbar = await page.evaluate(() => {
  const b = document.getElementById('mineBox').getBoundingClientRect();
  return b.top >= -4 && b.top < window.innerHeight / 2;
});
ok('der Kasten steht im Bild', sichtbar);
ok('drei Listen darin', await page.locator('#mineList li').count() === 3,
   String(await page.locator('#mineList li').count()));
ok('die Tastatur steht auf dem ersten Eintrag', await page.evaluate(() =>
  document.activeElement === document.querySelector('#mineList a')));

console.log('\n· Zweiter Klick bei stehendem Fragment');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.locator('#lnkMine').click();
await page.waitForTimeout(900);
ok('springt wieder nach unten', await page.evaluate(() => window.scrollY) > 100,
   String(await page.evaluate(() => window.scrollY)));

console.log('\n· Aus der Liste heraus');
await page.goto(l1, { waitUntil: 'networkidle' });
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(300);
await page.locator('#lnkMine').click();
await page.waitForTimeout(900);
ok('die Startseite erscheint', await page.locator('#viewStart').isVisible());
ok('und der Kasten steht im Bild', await page.evaluate(() => {
  const b = document.getElementById('mineBox').getBoundingClientRect();
  return b.top >= -4 && b.top < window.innerHeight / 2;
}));

console.log('\n· Von der Einstellungsseite');
await page.goto(URL + 'einstellungen.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
ok('der Verweis ist da', await page.locator('#lnkMine').isVisible());
ok('und führt zum Kasten', (await page.locator('#lnkMine').getAttribute('href')) === './#meine',
   await page.locator('#lnkMine').getAttribute('href'));
await page.locator('#lnkMine').click();
await page.waitForTimeout(900);
ok('landet im Kasten', await page.evaluate(() => {
  const b = document.getElementById('mineBox').getBoundingClientRect();
  return b.top >= -4 && b.top < window.innerHeight / 2;
}));

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
