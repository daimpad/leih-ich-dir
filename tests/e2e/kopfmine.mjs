/*
 * Die Wege zu den eigenen Listen, an beiden Orten.
 *
 * Breit stehen sie in der Kopfleiste: je ein Zeichen und ein Wort, Leihliste
 * und Superliste getrennt. Schmal treten sie dort ab, und ein Listen-Knopf in
 * derselben Zeile oeffnet sie als kleine Wahl. Bis November 2026 schwebte
 * dieser Knopf unten rechts am Fenster und lag beim Rollen ueber dem Inhalt;
 * die Zusicherungen dazu sind nachgezogen. Im Kopf steht seither ausserdem
 * die Sprache als Wort, English oder Deutsch, und kein Mond mehr fuer das
 * Erscheinungsbild; unter 375 Punkten steht die Bildmarke ohne Wort.
 */
import { chromium, BROWSER, BASE } from './hilfe.mjs';
const B = BROWSER;
const URL = BASE + '/';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };
const browser = await chromium.launch({ executablePath: B });
const problems = [];

const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto(URL);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
await page.reload({ waitUntil: 'networkidle' });

console.log('· Ohne Listen steht kein Weg da');
ok('kein Block in der Kopfleiste', await page.locator('#barMine').isHidden());
ok('kein Listen-Knopf', !(await page.locator('.fab__btn').isVisible()));

// Je eine Liste beider Arten anlegen, damit beide Wege erscheinen.
await page.locator('#btnCreate').click();
await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(900);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('#btnStartCircle').click();
await page.waitForSelector('#viewCircle:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(900);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('\n· Schmal: der Listen-Knopf in der Kopfzeile');
for (const w of [430, 390, 375, 374, 360, 320]) {
  await page.setViewportSize({ width: w, height: 780 });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const knopf = document.querySelector('.fab__btn').getBoundingClientRect();
    const lang = document.querySelector('#btnLang').getBoundingClientRect();
    const zahn = document.querySelector('#lnkSettings').getBoundingClientRect();
    const marke = document.querySelector('.brand-mark').getBoundingClientRect();
    const wort = document.querySelector('.brand-word').getBoundingClientRect();
    return { kopf: getComputedStyle(document.querySelector('#barMine')).display,
             fab: getComputedStyle(document.querySelector('#fab')).display,
             knopf, lang, zahn, marke, wortBreite: wort.width,
             sprache: document.querySelector('#btnLang').textContent.trim(),
             mond: !!document.querySelector('[data-theme-toggle]'),
             ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  ok(w + 'px: die Kopfleiste traegt keinen Weg mehr', m.kopf === 'none', m.kopf);
  ok(w + 'px: der Listen-Knopf steht da', m.fab === 'block', m.fab);
  ok(w + 'px: in einer Zeile mit Marke, Sprache und Zahnrad',
     [m.knopf, m.lang, m.zahn].every((r) => Math.abs(r.top - m.knopf.top) < 2) && Math.abs(m.marke.top + m.marke.height / 2 - (m.knopf.top + m.knopf.height / 2)) < 8,
     JSON.stringify({ k: Math.round(m.knopf.top), l: Math.round(m.lang.top), z: Math.round(m.zahn.top), m: Math.round(m.marke.top) }));
  ok(w + 'px: links von der Sprache', m.knopf.right <= m.lang.left + 1, Math.round(m.knopf.right) + ' / ' + Math.round(m.lang.left));
  ok(w + 'px: gut treffbar', m.knopf.width >= 38 && m.knopf.height >= 38,
     Math.round(m.knopf.width) + 'x' + Math.round(m.knopf.height));
  ok(w + 'px: die Sprache als Wort, kein Mond', m.sprache === 'English' && !m.mond, m.sprache + ' / ' + m.mond);
  ok(w + 'px: ' + (w < 375 ? 'die Bildmarke ohne Wort' : 'Bildmarke und Wort'), w < 375 ? m.wortBreite <= 1 : m.wortBreite > 50, String(m.wortBreite));
  ok(w + 'px: kein Ueberlauf', !m.ueberlauf);
}
/* Der Knopf liegt im Fluss und nicht mehr am Fenster: Beim Rollen bleibt er
   oben und liegt ueber nichts. */
{
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200);
  const lage = await page.evaluate(() => ({ pos: getComputedStyle(document.querySelector('.fab__btn')).position,
    oben: document.querySelector('.fab__btn').getBoundingClientRect().top }));
  ok('der Knopf rollt mit der Kopfzeile weg, statt ueber dem Inhalt zu schweben', lage.pos !== 'fixed' && lage.oben < 0, JSON.stringify(lage));
  await page.evaluate(() => window.scrollTo(0, 0));
}

console.log('\n· Die Wahl dahinter');
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(200);
ok('zu ist zu', await page.locator('#fabMine').isHidden() && await page.locator('#fabCircle').isHidden());
await page.locator('.fab__btn').click();
await page.waitForTimeout(250);
{
  const m = await page.evaluate(() => {
    const a = document.querySelector('#fabMine'), b = document.querySelector('#fabCircle');
    return { a: { t: a.innerText.trim(), r: a.getBoundingClientRect(), z: a.querySelector('use').getAttribute('href') },
             b: { t: b.innerText.trim(), r: b.getBoundingClientRect(), z: b.querySelector('use').getAttribute('href') },
             knopf: document.querySelector('.fab__btn').getBoundingClientRect() };
  });
  ok('beide Wege stehen da', m.a.t === 'Leihliste' && m.b.t === 'Superliste', m.a.t + ' / ' + m.b.t);
  ok('jeder mit seinem Zeichen', m.a.z === '#i-leihliste' && m.b.z === '#i-kreis', m.a.z + ' / ' + m.b.z);
  ok('unter dem Knopf', m.a.r.top >= m.knopf.bottom - 1,
     Math.round(m.a.r.top) + ' / ' + Math.round(m.knopf.bottom));
  ok('und im Fenster', m.a.r.left >= 0 && m.b.r.left >= 0, Math.round(m.a.r.left) + ' / ' + Math.round(m.b.r.left));
  ok('beide gut treffbar', m.a.r.height >= 44 && m.b.r.height >= 44,
     Math.round(m.a.r.height) + '/' + Math.round(m.b.r.height));
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('Escape nimmt die Wahl zurueck', !(await page.evaluate(() => document.querySelector('#fab').open)));
await page.locator('.fab__btn').click();
await page.waitForTimeout(200);
await page.mouse.click(40, 300);
await page.waitForTimeout(200);
ok('ein Tipper daneben ebenso', !(await page.evaluate(() => document.querySelector('#fab').open)));

console.log('\n· Breit: beide Wege neben den Schaltern');
for (const w of [900, 1280]) {
  await page.setViewportSize({ width: w, height: 780 });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const a = document.querySelector('#lnkMine'), b = document.querySelector('#lnkCircle');
    const lang = document.querySelector('#btnLang');
    return { a: { r: a.getBoundingClientRect(), t: a.innerText.trim(), z: a.querySelector('use').getAttribute('href') },
             b: { r: b.getBoundingClientRect(), t: b.innerText.trim(), z: b.querySelector('use').getAttribute('href') },
             lang: lang.getBoundingClientRect(),
             marke: document.querySelector('.brand').getBoundingClientRect(),
             fab: getComputedStyle(document.querySelector('#fab')).display,
             strich: getComputedStyle(a.querySelector('.ctl-label')).textDecorationLine };
  });
  ok(w + 'px: in einer Zeile mit den Schaltern',
     Math.abs(m.a.r.top - m.lang.top) < 2 && Math.abs(m.b.r.top - m.lang.top) < 2);
  ok(w + 'px: links von der Sprache', m.b.r.right <= m.lang.left + 1,
     'Verweis endet ' + Math.round(m.b.r.right) + ', Sprache ab ' + Math.round(m.lang.left));
  ok(w + 'px: rechts von der Marke', m.a.r.left > m.marke.right);
  ok(w + 'px: Leihliste vor Superliste', m.a.r.right <= m.b.r.left + 1);
  ok(w + 'px: beide ausgeschrieben', m.a.t === 'Leihliste' && m.b.t === 'Superliste', m.a.t + ' / ' + m.b.t);
  ok(w + 'px: jeder mit seinem Zeichen', m.a.z === '#i-leihliste' && m.b.z === '#i-kreis', m.a.z + ' / ' + m.b.z);
  ok(w + 'px: ohne Unterstrich', m.strich === 'none', m.strich);
  ok(w + 'px: kein Listen-Knopf', m.fab === 'none', m.fab);
}

/*
 * Die Schwelle selbst, in beiden Sprachen.
 *
 * Bei 42rem wechselt die Kopfleiste zum Listen-Knopf, und die Zahl ist
 * gemessen und nicht gegriffen: Marke, beide Wege, die Sprache und das
 * Zahnrad muessen darueber in eine Zeile passen. Bis November 2026 stand
 * dort statt English EN und daneben ein Mond; beides wiegt sich ungefaehr
 * auf. Genau ueber der Schwelle muss die Zeile auch auf Englisch halten —
 * andernfalls rutschten die Schalter unter die Marke und schoeben den Inhalt
 * nach unten, und zwar nur fuer die eine Sprache, in der niemand nachsieht.
 * Knapp darunter muss umgekehrt der Listen-Knopf uebernehmen.
 */
console.log('\n· Die Schwelle bei 42rem, deutsch und englisch');
for (const sprache of ['de', 'en']) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate((l) => { localStorage.setItem('lid.lang', l); }, sprache);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  /* Schmal haelt die eine Zeile in beiden Sprachen; auf Englisch steht
     dort "Deutsch", das breiter laeuft als "English". */
  for (const w of [375, 374]) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(250);
    const z = await page.evaluate(() => ({ k: document.querySelector('.fab__btn').getBoundingClientRect().top,
      l: document.querySelector('#btnLang').getBoundingClientRect().top, text: document.querySelector('#btnLang').textContent.trim(),
      ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1 }));
    ok(w + 'px [' + sprache + ']: Listen-Knopf und ' + z.text + ' in einer Zeile', Math.abs(z.k - z.l) < 2 && !z.ueberlauf, JSON.stringify(z));
  }

  await page.setViewportSize({ width: 672, height: 780 });
  await page.waitForTimeout(250);
  {
    const m = await page.evaluate(() => ({
      kopf: getComputedStyle(document.querySelector('#barMine')).display,
      fab: getComputedStyle(document.querySelector('#fab')).display
    }));
    ok('672px [' + sprache + ']: der Listen-Knopf traegt', m.fab === 'block' && m.kopf === 'none',
       m.fab + ' / ' + m.kopf);
  }

  await page.setViewportSize({ width: 680, height: 780 });
  await page.waitForTimeout(250);
  {
    const m = await page.evaluate(() => {
      const a = document.querySelector('#lnkMine'), b = document.querySelector('#lnkCircle');
      return { a: a.getBoundingClientRect(), b: b.getBoundingClientRect(),
               ctl: document.querySelector('.bar-controls').getBoundingClientRect(),
               marke: document.querySelector('.brand').getBoundingClientRect(),
               fab: getComputedStyle(document.querySelector('#fab')).display,
               worte: a.innerText.trim() + ' / ' + b.innerText.trim(),
               ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    ok('680px [' + sprache + ']: die Kopfleiste traegt', m.fab === 'none', m.fab);
    ok('680px [' + sprache + ']: eine Zeile, kein Umbruch',
       Math.abs(m.a.top - m.ctl.top) < 2 && Math.abs(m.b.top - m.ctl.top) < 2 &&
       Math.abs(m.marke.top - m.ctl.top) < 14,
       'Marke ' + Math.round(m.marke.top) + ', Wege ' + Math.round(m.a.top) +
       '/' + Math.round(m.b.top) + ', Schalter ' + Math.round(m.ctl.top));
    ok('680px [' + sprache + ']: die Wege stehen links von den Schaltern',
       m.b.right <= m.ctl.left + 1,
       'Weg endet ' + Math.round(m.b.right) + ', Schalter ab ' + Math.round(m.ctl.left));
    ok('680px [' + sprache + ']: kein waagerechter Ueberlauf', !m.ueberlauf);
    ok('680px [' + sprache + ']: beide ausgeschrieben',
       sprache === 'de' ? m.worte === 'Leihliste / Superliste'
                        : m.worte === 'Lending list / Super list', m.worte);
  }
}
await page.evaluate(() => { localStorage.setItem('lid.lang', 'de'); });

console.log('\n· Der Weg fuehrt hinein');
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(200);
ok('bei einer Leihliste direkt in sie', /#e=/.test(await page.locator('#lnkMine').getAttribute('href')),
   await page.locator('#lnkMine').getAttribute('href'));
ok('bei einer Superliste direkt in sie', /#k=/.test(await page.locator('#lnkCircle').getAttribute('href')),
   await page.locator('#lnkCircle').getAttribute('href'));
await page.locator('.fab__btn').click();
await page.waitForTimeout(200);
await page.locator('#fabMine').click();
await page.waitForTimeout(800);
ok('und die Leihliste steht offen', await page.locator('#viewList').isVisible());
ok('die Wahl ist danach zu', !(await page.evaluate(() => document.querySelector('#fab').open)));

console.log('\n· Einstellungsseite traegt beides ebenso');
await page.goto(URL + 'einstellungen.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
{
  const m = await page.evaluate(() => ({
    kopf: getComputedStyle(document.querySelector('#barMine')).display,
    fab: getComputedStyle(document.querySelector('#fab')).display,
    a: document.querySelector('#lnkMine').innerText.trim(),
    b: document.querySelector('#lnkCircle').innerText.trim()
  }));
  ok('schmal traegt der Listen-Knopf', m.fab === 'block' && m.kopf === 'none', m.fab + ' / ' + m.kopf);
  ok('die Verweise sind trotzdem gesetzt', m.a === 'Leihliste' && m.b === 'Superliste', m.a + ' / ' + m.b);
}
/* Die Einstellungsseite hat einen eigenen Einstieg und erreicht bindEvents()
   nie. Ohne eigene Schaltung bliebe die Wahl hier offen stehen. */
await page.locator('.fab__btn').click();
await page.waitForTimeout(250);
ok('die Wahl geht auch hier auf', await page.evaluate(() => document.querySelector('#fab').open));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('und Escape nimmt sie auch hier zurueck', !(await page.evaluate(() => document.querySelector('#fab').open)));
await page.setViewportSize({ width: 1280, height: 780 });
await page.waitForTimeout(200);
{
  const m = await page.evaluate(() => ({
    unter: document.querySelector('#barMine').getBoundingClientRect().top,
    ctl: document.querySelector('.bar-controls').getBoundingClientRect().top
  }));
  ok('breit stehen sie in derselben Zeile', Math.abs(m.unter - m.ctl) < 2, m.unter + ' / ' + m.ctl);
}

/* Die Textseiten trugen im Kopf nur den Mond fuer das Erscheinungsbild.
   Seit November 2026 steht dort allein die Marke. */
console.log('\n· Seiten ohne die Wege tragen nur die Marke');
await page.setViewportSize({ width: 390, height: 780 });
for (const datei of ['so-gehts.html', 'ueber.html', 'impressum.html', 'datenschutz.html']) {
  await page.goto(URL + datei, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => ({
    marke: !!document.querySelector('.brand'),
    knoepfe: document.querySelectorAll('header .ctl-square, header [data-theme-toggle]').length,
    mine: !!document.querySelector('#lnkMine'),
    fab: !!document.querySelector('#fab')
  }));
  ok(datei + ': die Marke, kein Knopf, kein Weg', m.marke && m.knoepfe === 0 && !m.mine && !m.fab, JSON.stringify(m));
}

console.log('\n· Zurueck zu den gemerkten Listen, ohne neu zu laden');
{
  /* Nach dem Anlegen blieben beide Knoepfe zum Anlegen gesperrt und trugen
     "Leihliste wird angelegt …". Wer danach mit zwei Listen ueber die
     Kopfleiste zu den gemerkten Listen ging — ein Wechsel des Fragments,
     kein Neuladen —, fand sie so vor und konnte erst nach dem Neuladen eine
     weitere Liste anlegen. */
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
  const p = await ctx2.newPage();
  p.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
  await p.reload({ waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.locator('#btnCreate').click();
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(500);
  ok('mit zwei Listen fuehrt der Weg zu den gemerkten', await p.locator('#lnkMine').getAttribute('href') === './#meine',
     await p.locator('#lnkMine').getAttribute('href'));
  await p.locator('#lnkMine').click();
  await p.waitForSelector('#viewStart:not([hidden])');
  await p.waitForTimeout(300);
  ok('ohne neu zu laden', await p.evaluate(() => performance.getEntriesByType('navigation').length === 1 &&
     location.hash === '#meine'));
  const knoepfe = await p.evaluate(() => [...document.querySelectorAll('[data-create]')]
    .map(b => (b.disabled ? 'gesperrt: ' : '') + b.textContent.trim()));
  /* Seit Oktober 2026 gibt es nur noch einen Knopf zum Anlegen; der im
     Hero ist fort. */
  ok('der Knopf zum Anlegen ist wieder frei und heisst wieder so',
     knoepfe.length === 1 && knoepfe[0] === 'Leihliste anlegen', knoepfe.join(' | '));
  await ctx2.close();
}

console.log('\n· Konsole');
ok('keine Fehler', problems.length === 0, problems.slice(0, 3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
