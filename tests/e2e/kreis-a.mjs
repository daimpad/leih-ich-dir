import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport: { width: 1000, height: 900 }, locale: 'de-DE' });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('pageerror: ' + e.message));

const ID = '00112233445566778899aabbccddeeff';
const K43 = 'A'.repeat(43);

async function lage(hash) {
  fehler.length = 0;
  await p.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  return await p.evaluate(() => ({
    start: !document.getElementById('viewStart').hidden,
    liste: !document.getElementById('viewList').hidden,
    fehleransicht: !document.getElementById('viewError').hidden,
    text: (document.getElementById('errorText')||{}).textContent || ''
  }));
}

console.log('· Schritt 1 — beschaedigter Schluessel wirft nicht mehr synchron');
for (const [name, hash] of [
  ['fuenf Zeichen (Laenge % 4 == 1)', '#v=' + ID + '.abcde'],
  ['unzulaessiges Zeichen',           '#v=' + ID + '.' + 'A'.repeat(42) + '*'],
  ['zu kurz, aber gueltiges Base64',  '#v=' + ID + '.kurz'],
]) {
  const m = await lage(hash);
  ok(name + ': Fehleransicht statt weisser Seite', m.fehleransicht, JSON.stringify(m));
  ok(name + ': keine unbehandelte Ausnahme', fehler.length === 0, fehler.join(' | '));
}

console.log('· Schritt 5 — das Praefix k wird erkannt, e und v bleiben');
{
  const m = await lage('#k=' + ID + '.' + K43 + '.tok');
  // Es gibt diese Liste nicht: die Fehleransicht ist die richtige Antwort.
  ok('#k= erreicht oeffneKreis und meldet "gibt es nicht"', m.fehleransicht && /gibt es nicht/i.test(m.text), JSON.stringify(m));
  ok('kein Absturz dabei', fehler.length === 0, fehler.join(' | '));
}
{
  const m = await lage('#k=' + ID + '.' + K43);   // dritter Teil fehlt
  ok('#k= ohne Token ist beschaedigt', m.fehleransicht && /unvollst|beschaedigt|beschädigt/i.test(m.text), JSON.stringify(m)+' '+m.text);
}
{
  const m = await lage('#e=' + ID + '.' + K43 + '.tok');
  ok('#e= bleibt ein Bearbeiten-Link', m.fehleransicht && /gibt es nicht/i.test(m.text), JSON.stringify(m));
}
{
  const m = await lage('#v=' + ID + '.' + K43);
  ok('#v= bleibt ein Ansehen-Link', m.fehleransicht && /gibt es nicht/i.test(m.text), JSON.stringify(m));
}
{
  const m = await lage('#main');
  ok('#main ist kein Zugangslink', m.start, JSON.stringify(m));
}
{
  const m = await lage('#meine');
  ok('#meine ist kein Zugangslink', m.start, JSON.stringify(m));
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
