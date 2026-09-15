import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport: { width: 1000, height: 900 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error') fehler.push(m.text()); });
await p.goto(BASE + '/');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });
await p.reload({ waitUntil: 'networkidle' });
await p.locator('#btnCreateHero').click();
await p.waitForSelector('#viewList:not([hidden])', { timeout: 15000 });
await p.waitForTimeout(900);

console.log('· Ueberschrift im Bearbeiten-Modus');
{
  const m = await p.evaluate(() => {
    const h = document.querySelector('#listTitleRead');
    return { da: !h.hidden, nurVorgelesen: h.classList.contains('sr-only'), text: h.textContent.trim(),
             anzahlH1: Array.from(document.querySelectorAll('h1')).filter(n => n.offsetParent !== null || n.classList.contains('sr-only')).length };
  });
  ok('das h1 steht im Dokument', m.da);
  ok('sichtbar nur fuer Hilfsmittel', m.nurVorgelesen);
  ok('und traegt den Titel', m.text.length > 0, JSON.stringify(m.text));
}

console.log('· Fokusrahmen auf Eingabefeldern');
{
  await p.locator('#addName').focus();
  const m = await p.locator('#addName').evaluate(n => {
    const s = getComputedStyle(n);
    return { stil: s.outlineStyle, breite: s.outlineWidth, versatz: s.outlineOffset, ring: s.boxShadow.slice(0, 40) };
  });
  ok('outline ist gesetzt', m.stil !== 'none' && parseFloat(m.breite) >= 2, JSON.stringify(m));
  ok('mit Abstand', parseFloat(m.versatz) > 0, m.versatz);
}

console.log('· Ansehen-Modus sagt, was frei ist');
{
  await p.locator('#addName').fill('Bohrmaschine');
  await p.locator('#addForm button[type=submit]').click();
  await p.waitForTimeout(600);
  await p.locator('#addName').fill('Leiter');
  await p.locator('#addForm button[type=submit]').click();
  await p.waitForTimeout(900);
  const ansehen = await p.locator('#linkView').inputValue();
  await p.goto(ansehen, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const m = await p.evaluate(() => {
    const zeilen = Array.from(document.querySelectorAll('#itemList .itemrow'));
    const knoepfe = Array.from(document.querySelectorAll('.item-ask'));
    return { zeilen: zeilen.length,
             mitStatus: zeilen.filter(z => z.querySelector('.sr-only')).length,
             namen: knoepfe.map(b => b.textContent.replace(/\s+/g,' ').trim()) };
  });
  ok('es stehen Zeilen da', m.zeilen >= 2, String(m.zeilen));
  ok('jede sagt frei oder verliehen', m.mitStatus === m.zeilen, m.mitStatus + ' von ' + m.zeilen);
  ok('die Anfragen-Knoepfe heissen verschieden', new Set(m.namen).size === m.namen.length, JSON.stringify(m.namen));
  ok('und nennen den Gegenstand', m.namen.every(n => /Bohrmaschine|Leiter/.test(n)), JSON.stringify(m.namen));
}

console.log('· Konsole');
ok('keine Fehler', fehler.length === 0, fehler.slice(0,2).join(' | '));
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
