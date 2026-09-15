import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const p = await br.newPage();
const fehler = [], schlecht = [];
p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });
p.on('response', r => { if (r.status() >= 400) schlecht.push(r.status()+' '+r.url()); });

console.log('· Der Zeichensatz steht in allen sechs Seiten');
for (const s of ['/', '/ueber.html', '/impressum.html', '/datenschutz.html', '/einstellungen.html', '/check.html']) {
  await p.goto(BASE + ''+s, { waitUntil: 'networkidle' });
  const m = await p.evaluate(() => {
    const l = sel => { const e = document.querySelector(sel); return e && e.getAttribute('href'); };
    return { png96: l('link[rel="icon"][sizes="96x96"]'), svg: l('link[rel="icon"][type="image/svg+xml"]'),
             ico: l('link[rel="shortcut icon"]'), apple: l('link[rel="apple-touch-icon"]'),
             manifest: l('link[rel="manifest"]'),
             absolut: Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="manifest"]'))
                        .some(e => e.getAttribute('href').startsWith('/')) };
  });
  ok(s + ': alle fünf Verweise', !!(m.png96 && m.svg && m.ico && m.apple && m.manifest), JSON.stringify(m));
  ok(s + ': keine absoluten Pfade', !m.absolut, 'sonst bricht die Pages-Vorschau');
}

console.log('· Die Dateien liegen da');
for (const [f, typ] of [['/assets/favicon/favicon.svg','image/svg+xml'],
                        ['/assets/favicon/favicon-96x96.png','image/png'],
                        ['/assets/favicon/apple-touch-icon.png','image/png'],
                        ['/assets/favicon/web-app-manifest-192x192.png','image/png'],
                        ['/assets/favicon/web-app-manifest-512x512.png','image/png'],
                        ['/favicon.ico','image'], ['/site.webmanifest',''],
                        ['/assets/pics/logo.svg','image/svg+xml']]) {
  const r = await p.request.get(BASE + ''+f);
  ok(f + ' erreichbar', r.status() === 200, 'Status ' + r.status());
  if (typ) ok('  Typ ' + typ, (r.headers()['content-type']||'').includes(typ), r.headers()['content-type']);
}

console.log('· Das Manifest');
{
  const r = await p.request.get(BASE + '/site.webmanifest');
  const d = JSON.parse(await r.text());
  ok('gueltiges JSON mit Namen', d.name === 'LeihIchDir');
  ok('oeffnet im Browser, nicht ohne Adresszeile', d.display === 'browser',
     'die Adresse traegt den Schluessel, sie darf nicht verschwinden');
  ok('kein share_target', !('share_target' in d), 'das bekaeme geteilte Links samt Schluessel');
  ok('kein protocol_handlers', !('protocol_handlers' in d));
  ok('relative Pfade', d.start_url === './' && d.icons.every(i => !i.src.startsWith('/')));
  // Der gelieferte Satz fuellt den Rahmen bis zum Rand. Android garantiert nur
  // die inneren achtzig Prozent und wuerde den Ring beschneiden — also darf
  // kein Symbol maskable behaupten zu sein.
  ok('kein Symbol behauptet maskable zu sein', d.icons.every(i => !i.purpose));
}

console.log('· Die Bildmarke neben der Wortmarke');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
{
  const m = await p.evaluate(() => {
    const s = document.querySelector('.brand-mark'), w = document.querySelector('.brand-word');
    if (!s) return null;
    const rs = s.getBoundingClientRect(), rw = w.getBoundingClientRect();
    return { links: rs.x < rw.x, mittig: Math.abs((rs.y+rs.height/2) - (rw.y+rw.height/2)) <= 2,
             quelle: s.getAttribute('src') || '', geladen: s.complete && s.naturalWidth > 0,
             versteckt: s.getAttribute('aria-hidden') === 'true',
             breite: Math.round(rs.width) };
  });
  ok('sie steht links vom Namen', m && m.links);
  ok('auf gleicher Mitte', m && m.mittig);
  ok('es ist das gelieferte Logo', m && /assets\/pics\/logo\.svg$/.test(m.quelle), m && m.quelle);
  ok('und es laedt', m && m.geladen);
  ok('fuer Hilfsmittel verborgen', m && m.versteckt, 'der Name steht daneben');
  ok('gross genug', m && m.breite >= 24, m && m.breite);
}
console.log('· Konsole');
ok('keine Fehler', fehler.length === 0, fehler.slice(0,2).join(' | '));
ok('keine fehlenden Anforderungen', schlecht.length === 0, schlecht.slice(0,3).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
