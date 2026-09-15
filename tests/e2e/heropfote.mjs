import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };
const browser = await chromium.launch({ executablePath: B });
const problems = [];

console.log('\n· Im Hero, rechts, in voller Farbe');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const b = page.locator('.hero-bild');
  ok('das Bild steht im Hero', await page.evaluate(() =>
    document.querySelector('.hero-panel').contains(document.querySelector('.hero-bild'))));
  // Die Zeichnung steht jetzt im Dokument, nicht in einem <img>: nur so
  // erreicht sie das Stylesheet der Seite.
  ok('die Zeichnung steht im Dokument', await b.evaluate(n =>
    n.tagName.toLowerCase() === 'svg' && n.querySelectorAll('path').length > 10));
  ok('und ist gezeichnet', await b.evaluate(n => n.getBoundingClientRect().width > 0));
  ok('kein nachgeladenes Bild mehr', await page.locator('img.hero-bild').count() === 0);
  ok('in voller Deckkraft', await b.evaluate(n => parseFloat(getComputedStyle(n).opacity)) === 1,
     await b.evaluate(n => getComputedStyle(n).opacity));
  ok('ohne Filter', await b.evaluate(n => getComputedStyle(n).filter) === 'none',
     await b.evaluate(n => getComputedStyle(n).filter));
  const m = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    return { bild: r('.hero-bild'), body: r('.hero-sagt'), panel: r('.hero-panel'),
             h1: r('.hero h1'), lead: r('.hero .lead'), btn: r('#btnCreateHero') };
  });
  ok('rechts vom Text', m.bild.x > m.body.x + m.body.width - 4,
     'Bild x=' + Math.round(m.bild.x) + ' Text endet ' + Math.round(m.body.x + m.body.width));
  ok('innerhalb des Rahmens', m.bild.x + m.bild.width <= m.panel.x + m.panel.width + 1);
  ok('gross genug, um erkennbar zu sein', m.bild.width >= 130, Math.round(m.bild.width) + 'px');
  ok('es liegt nicht mehr fest am Fenster', await b.evaluate(n => getComputedStyle(n).position) !== 'fixed');

  console.log('\n· Kein Zusammenstoss mit dem Text');
  const stoesst = (a, c) => !(a.x + a.width <= c.x + 1 || c.x + c.width <= a.x + 1 ||
                              a.y + a.height <= c.y + 1 || c.y + c.height <= a.y + 1);
  const txt = await page.evaluate(() => {
    const t = document.querySelector('.hero h1');
    const r = document.createRange(); r.selectNodeContents(t);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  ok('die Überschrift stösst nicht ans Bild', !stoesst(txt, m.bild),
     'Text bis ' + Math.round(txt.x + txt.width) + ', Bild ab ' + Math.round(m.bild.x));
  ok('der Satz stösst nicht ans Bild', !stoesst(m.lead, m.bild));
  // Der Aufruf steht in der Textspalte neben dem Bild, nicht darunter:
  // sonst bliebe neben dem Bild eine leere Flaeche.
  ok('der Aufruf steht links neben dem Bild', m.btn.x + m.btn.width <= m.bild.x + 1,
     'Aufruf endet ' + Math.round(m.btn.x + m.btn.width) + ', Bild ab ' + Math.round(m.bild.x));
  ok('und stoesst nicht ans Bild', !stoesst(m.btn, m.bild));
  ok('unter dem Rahmen bleibt kein Loch', m.panel.y + m.panel.height - (m.bild.y + m.bild.height) < 60,
     'Rahmen endet ' + Math.round(m.panel.y + m.panel.height) + ', Bild endet ' + Math.round(m.bild.y + m.bild.height));
ok('die Auszeichnungen stehen in einer Reihe', await page.evaluate(() =>
  new Set(Array.from(document.querySelectorAll('.trust li')).map(n => Math.round(n.getBoundingClientRect().top))).size === 1));

  console.log('\n· Nirgends mehr im Hintergrund');
  ok('kein festes Schmuckbild mehr', await page.locator('.deko').count() === 0);
  await page.close();
}

console.log('\n· Das Blatt folgt Hell und Dunkel');
for (const [name, scheme, erwartet] of [['hell', 'light', 'rgb(255, 255, 255)'],
                                        ['dunkel', 'dark', 'rgb(33, 29, 23)']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  const blatt = await page.locator('.hero-bild .cls-3').first().evaluate(n => getComputedStyle(n).fill);
  const strich = await page.locator('.hero-bild .cls-1').first().evaluate(n => getComputedStyle(n).fill);
  ok(name + ': das Blatt nimmt die Farbe der Karte', blatt === erwartet, blatt);
  ok(name + ': der Strich bleibt beige', strich === 'rgb(199, 172, 145)', strich);
  await ctx.close();
}

// Der Fall, den eine nachgeladene Datei nicht koennte: System hell, Wahl dunkel.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const blatt = await page.locator('.hero-bild .cls-3').first().evaluate(n => getComputedStyle(n).fill);
  ok('auch bei ausdruecklicher Wahl dunkel', blatt === 'rgb(33, 29, 23)', blatt);
  await ctx.close();
}

console.log('\n· Englisch, längere Überschrift');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('lid.lang', 'en'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const t = document.querySelector('.hero h1');
    const r = document.createRange(); r.selectNodeContents(t);
    const a = r.getBoundingClientRect(), b = document.querySelector('.hero-bild').getBoundingClientRect();
    return { text: Math.round(a.x + a.width), bild: Math.round(b.x), titel: t.textContent };
  });
  ok('auch auf Englisch kein Zusammenstoss', m.text <= m.bild, JSON.stringify(m));
  await page.close();
}

console.log('\n· Über die Breiten');
for (const w of [1400, 1100, 760, 700, 600, 430]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const sichtbar = await page.locator('.hero-bild').isVisible();
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(String(w).padStart(5) + 'px  Bild ' + (sichtbar ? 'sichtbar' : 'verborgen') + (ueberlauf ? '  ÜBERLAUF' : ''));
  ok(w + 'px: Sichtbarkeit wie erwartet', sichtbar === (w > 736), sichtbar ? 'sichtbar' : 'verborgen');
  ok(w + 'px: kein Überlauf', !ueberlauf);
  await page.close();
}

console.log('\n· Zeichen bei Kontakt');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => problems.push('kontakt: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').click();
  await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await page.locator('#chkKeyDone').check();
  await page.waitForTimeout(2300);
  ok('kein Zeichen mehr in der Überschrift', await page.locator('#contactBox summary .ico').count() === 0);
  ok('die Überschrift steht weiterhin', /Kontakt/.test(await page.locator('#contactBox summary').innerText()));
  ok('der Zusatz ebenfalls', /Telefon/.test(await page.locator('#contactBox summary').innerText()));
  ok('das ungenutzte Zeichen ist aus dem Satz', await page.locator('#i-user').count() === 0);
  const kartenMitZeichen = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.card__title, .fold > summary'))
      .filter(n => n.querySelector('svg.ico')).length);
  ok('keine Überschrift trägt ein Zeichen', kartenMitZeichen === 0, String(kartenMitZeichen));
  await page.close();
}

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
