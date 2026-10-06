import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const B = BROWSER;
const browser = await chromium.launch({ executablePath: B });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  ok    ' + n)) : (fail++, console.log('  FEHLT ' + n + (d ? '  — ' + d : ''))); };

for (const w of [1440, 1280, 900, 740, 600, 430, 360]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang', 'de'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#wortmarke .buchstabe').length > 0, null, { timeout: 8000 })
    .catch(() => {});
  const m = await page.evaluate(() => {
    const h1 = document.querySelector('.hero h1');
    const cs = getComputedStyle(h1);
    const main = document.querySelector('#main').getBoundingClientRect();
    const kopf = document.querySelector('header.site .shell').getBoundingClientRect();
    const li = document.querySelectorAll('.steps li');
    const spalten = new Set(Array.from(li).map(n => Math.round(n.getBoundingClientRect().top))).size === 1 ? 3 : 1;
    return {
      breite: Math.round(main.width),
      kopfBreite: Math.round(kopf.width),
      bündig: Math.round(kopf.x) === Math.round(main.x),
      /* Seit der Knete ist die sichtbare Ueberschrift die Wortmarke, ein SVG
         in einer Zeile; der Titel steht nur noch fuer Vorleseprogramme im
         Dokument. Gemessen wird deshalb, was zu sehen ist: Eine Zeile heisst
         hier, die Marke steht und ist breiter als dreimal so hoch. */
      h1Zeilen: (() => {
        const marke = document.getElementById('wortmarke');
        if (!document.documentElement.classList.contains('wortmarke-da') || !marke) {
          return Math.round(h1.getBoundingClientRect().height / parseFloat(cs.lineHeight));
        }
        const r = marke.getBoundingClientRect();
        return r.width > 200 && r.height * 3 < r.width ? 1 : 2;
      })(),
      spalten,
      ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  console.log(String(w).padStart(5) + 'px  Inhalt ' + String(m.breite).padStart(3) +
    '  Kopf ' + String(m.kopfBreite).padStart(3) + (m.bündig ? ' bündig' : ' VERSETZT') +
    '  h1 ' + m.h1Zeilen + 'z  Schritte ' + m.spalten + (m.ueberlauf ? '  ÜBERLAUF' : ''));
  ok(w + 'px: kein waagerechter Überlauf', !m.ueberlauf);
  ok(w + 'px: Kopf bündig mit dem Inhalt', m.bündig);
  ok(w + 'px: Inhalt höchstens 660', m.breite <= 660, String(m.breite));
  ok(w + 'px: Überschrift auf einer Zeile', m.h1Zeilen === 1, String(m.h1Zeilen));
  await page.close();
}

console.log('\n· Listenansicht bei 1280');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#btnCreateHero').click();
  await page.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
  const b = await page.evaluate(() => Math.round(document.querySelector('#main').getBoundingClientRect().width));
  ok('Liste ebenfalls 660', b === 660, String(b));
  await page.close();
}
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await browser.close();
process.exit(fail ? 1 : 0);
