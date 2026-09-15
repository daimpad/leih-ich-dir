import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };
const browser = await chromium.launch({ executablePath: B });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
await page.reload({ waitUntil: 'networkidle' });

await page.locator('#btnCreateHero').click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(2200);

console.log('\n· Übernehmen und Hinweiszeile');
await page.locator('#btnBulk').click();
await page.waitForTimeout(150);
const apply = page.locator('#btnVoiceApply');
ok('Übernehmen trägt die Fläche', (await apply.getAttribute('class')).includes('btn--primary'),
   await apply.getAttribute('class'));
const bg = await apply.evaluate(n => getComputedStyle(n).backgroundColor);
ok('und ist grün gefüllt', bg === 'rgb(15, 122, 85)', bg);
ok('keine Hinweiszeile ohne Übertragung', await page.locator('#voiceHint').isHidden());
const alleTexte = await page.evaluate(() => document.body.innerText);
ok('Satz über fehlende Spracherkennung ist weg', !/kennt keine Spracherkennung/.test(alleTexte));
ok('Satz über die Zerlegung im Browser ist weg', !/Zerlegung findet im Browser/.test(alleTexte));

console.log('\n· Telefonfeld');
await page.locator('#btnBulk').click();
await page.locator('#addName').fill('Bohrmaschine');
await page.locator('#addForm button[type=submit]').click();
await page.waitForTimeout(2200);
await page.locator('#contactBox summary').click();
await page.waitForTimeout(150);
ok('Feld ist da', await page.locator('#cfgPhone').isVisible());
ok('als Telefonfeld ausgezeichnet', await page.locator('#cfgPhone').getAttribute('type') === 'tel');
await page.locator('#cfgName').fill('Damian');
await page.locator('#cfgPhone').fill('0228 / 123 45-67');
await page.waitForTimeout(1400);

console.log('\n· Die Nummer reist mitverschlüsselt');
const gespeichert = await page.evaluate(() => window.__doc ? null : null);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.locator('#contactBox summary').click();
await page.waitForTimeout(200);
ok('nach dem Neuladen noch da', (await page.locator('#cfgPhone').inputValue()) === '0228 / 123 45-67',
   await page.locator('#cfgPhone').inputValue());

console.log('\n· Beim Freund');
const viewLink = await page.locator('#linkView').inputValue();
const gast = await browser.newPage({ viewport: { width: 1280, height: 900 } });
gast.on('pageerror', e => problems.push('gast: ' + e.message));
await gast.goto(viewLink, { waitUntil: 'networkidle' });
await gast.waitForSelector('.item', { timeout: 10000 });
await gast.locator('.item-ask').first().click();
await gast.waitForSelector('#itemModal[open]');
await gast.waitForTimeout(200);
const anruf = gast.locator('#modalFoot a[href^="tel:"]');
ok('Anrufen-Schaltfläche erscheint', await anruf.count() === 1);
ok('Nummer ist für tel: bereinigt', (await anruf.getAttribute('href')) === 'tel:02281234567',
   await anruf.getAttribute('href'));
ok('Beschriftung Anrufen bzw. Call', /Anrufen|Call/.test(await anruf.innerText()), await anruf.innerText());
ok('Hörer-Zeichen vorhanden', await gast.locator('#modalFoot a[href^="tel:"] use[href="#i-phone"]').count() === 1);
ok('ohne E-Mail führt das Telefon', (await anruf.getAttribute('class')).includes('btn--primary'),
   await anruf.getAttribute('class'));
await gast.close();

console.log('\n· Mit E-Mail führt die E-Mail');
await page.locator('#cfgEmail').fill('damian@example.org');
await page.waitForTimeout(1400);
const link2 = await page.locator('#linkView').inputValue();
const gast2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
gast2.on('pageerror', e => problems.push('gast2: ' + e.message));
await gast2.goto(link2, { waitUntil: 'networkidle' });
await gast2.waitForSelector('.item', { timeout: 10000 });
await gast2.locator('.item-ask').first().click();
await gast2.waitForSelector('#itemModal[open]');
await gast2.waitForTimeout(200);
ok('E-Mail trägt die Fläche', (await gast2.locator('#modalFoot a[href^="mailto:"]').getAttribute('class')).includes('btn--primary'));
ok('Anrufen steht daneben, ohne Fläche', !(await gast2.locator('#modalFoot a[href^="tel:"]').getAttribute('class')).includes('btn--primary'));
await gast2.close();

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
