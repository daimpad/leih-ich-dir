/*
 * Die Seite So geht's.
 *
 * Seit Oktober 2026 erklaert eine eigene Seite, wie eine Leihliste und eine
 * Superliste entstehen, je in den drei Schritten, in denen die Anwendung sie
 * zeigt, und was es mit den Links auf sich hat. Sie steht im Fuss jeder
 * Seite an erster Stelle. Festgehalten wird: Sie ist von ueberall
 * erreichbar, ihre Schritte heissen wie die Reiter, sie laedt ohne Fehler
 * und laeuft schmal nicht ueber.
 */
import { starteBrowser, BASE, pruefer } from './hilfe.mjs';

const { ok, bilanz } = pruefer();
const br = await starteBrowser();
const probleme = [];

const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
await ctx.addInitScript(() => { if (!localStorage.getItem('lid.lang')) { localStorage.setItem('lid.lang', 'de'); } });
const p = await ctx.newPage();
p.on('pageerror', e => probleme.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') { probleme.push(m.text()); } });

console.log('· Im Fuss jeder Seite');
for (const seite of ['/', '/so-gehts.html', '/ueber.html', '/impressum.html', '/datenschutz.html', '/einstellungen.html']) {
  await p.goto(BASE + seite, { waitUntil: 'networkidle' });
  const v = await p.evaluate(() => {
    const a = document.querySelector('.footer-nav a');
    return a && { href: a.getAttribute('href'), text: a.textContent.trim() };
  });
  ok(seite + ': der erste Verweis fuehrt zu So geht’s', v && v.href === 'so-gehts.html' && v.text === 'So geht’s', JSON.stringify(v));
}
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.locator('#btnLang').click();
await p.waitForTimeout(200);
ok('auf Englisch heisst er How it works',
   (await p.locator('.footer-nav a[href="so-gehts.html"]').textContent()).trim() === 'How it works');
await p.locator('#btnLang').click();

console.log('· Die Seite');
await p.goto(BASE + '/so-gehts.html', { waitUntil: 'networkidle' });
const s = await p.evaluate(() => ({
  titel: document.title,
  h1: document.querySelector('h1').textContent.trim(),
  kanonisch: document.querySelector('link[rel="canonical"]').getAttribute('href'),
  folgen: [...document.querySelectorAll('ol.folge')].map(ol =>
    [...ol.querySelectorAll(':scope > li > h3')].map(h => h.textContent.replace(/\s+/g, ' ').trim())),
  text: document.querySelector('main').innerText.replace(/\s+/g, ' '),
  ueber: !!document.querySelector('main a[href="ueber.html"]'),
  start: !!document.querySelector('main a[href="./"]')
}));
ok('Titel und Ueberschrift', s.titel === 'So geht’s · LeihIchDir' && s.h1 === 'So geht’s', s.titel + ' / ' + s.h1);
ok('mit eigener kanonischer Adresse', s.kanonisch === 'https://leihichdir.de/so-gehts.html', s.kanonisch);
/* Die Schritte heissen wie die Reiter in der Anwendung, damit man sie dort
   wiederfindet. */
ok('die Leihliste in drei Schritten, benannt wie ihre Reiter',
   (s.folgen[0] || []).join('|') === '1 Inventar|2 Kontakt|3 Link teilen', JSON.stringify(s.folgen[0]));
ok('die Superliste ebenso',
   (s.folgen[1] || []).join('|') === '1 Listen sammeln|2 Was es gibt|3 Weitergeben', JSON.stringify(s.folgen[1]));
ok('die drei Links sind erklaert', /Bearbeiten-Link/.test(s.text) && /Ansehen-Link/.test(s.text) &&
   /Zugangs-Link der Superliste/.test(s.text));
ok('mit Verweis auf Über und zur Startseite', s.ueber && s.start);
ok('ohne Ausrufezeichen', !/!/.test(s.text));

console.log('· Die Reiter der Anwendung heissen so');
{
  const reiter = await p.evaluate(async () => {
    const html = await (await fetch('index.html')).text();
    const d = new DOMParser().parseFromString(html, 'text/html');
    const namen = (id) => [...d.querySelectorAll('#' + id + ' .tab')].map(t => t.textContent.replace(/\s+/g, ' ').trim());
    return { liste: namen('schritte'), kreis: namen('kreisSchritte') };
  });
  ok('Leihliste: gleiche Namen wie in index.html', reiter.liste.join('|') === (s.folgen[0] || []).join('|'), JSON.stringify(reiter.liste));
  ok('Superliste: gleiche Namen wie in index.html', reiter.kreis.join('|') === (s.folgen[1] || []).join('|'), JSON.stringify(reiter.kreis));
}

console.log('· In der Sitemap');
{
  const sitemap = await p.evaluate(async () => (await fetch('sitemap.xml')).text());
  ok('die Seite steht in der Sitemap', sitemap.includes('<loc>https://leihichdir.de/so-gehts.html</loc>'));
}

console.log('· Schmal');
for (const breite of [390, 320]) {
  const c = await br.newContext({ viewport: { width: breite, height: 800 } });
  const q = await c.newPage();
  q.on('pageerror', e => probleme.push('pageerror: ' + e.message));
  await q.goto(BASE + '/so-gehts.html', { waitUntil: 'networkidle' });
  const ueber = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(breite + 'px: kein waagerechter Ueberlauf', ueber <= 0, String(ueber));
  await c.close();
}

ok('keine Ausnahme und keine Fehlermeldung in der Konsole', probleme.length === 0, probleme.join(' | '));
await br.close();
process.exit(bilanz());
