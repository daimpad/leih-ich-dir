import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };

console.log('· Ohne Systemvorgabe');
{
  const ctx = await br.newContext({ locale: 'de-DE', reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  await p.goto(BASE + '/einstellungen.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  ok('Schalter ist da', await p.locator('#cfgRuhig').count() === 1);
  ok('nicht gesetzt', !(await p.locator('#cfgRuhig').isChecked()));
  ok('bedienbar', !(await p.locator('#cfgRuhig').isDisabled()));
  ok('Vorgabe-Hinweis verborgen', await p.locator('#ruhigVorgabe').isHidden());
  await p.locator('#cfgRuhig').check();
  await p.waitForTimeout(150);
  ok('merkt sich die Wahl', await p.evaluate(() => localStorage.getItem('lid.ruhig')) === '1');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  ok('nach dem Neuladen noch gesetzt', await p.locator('#cfgRuhig').isChecked());
  // Wirkt er auch?
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  ok('die Anwendung haelt sich fuer ruhiggestellt', await p.evaluate(() => localStorage.getItem('lid.ruhig') === '1'));
  await ctx.close();
}
console.log('· Mit Systemvorgabe');
{
  const ctx = await br.newContext({ locale: 'de-DE', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(BASE + '/einstellungen.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  ok('gesetzt', await p.locator('#cfgRuhig').isChecked());
  ok('und unveraenderlich', await p.locator('#cfgRuhig').isDisabled());
  ok('Hinweis steht', await p.locator('#ruhigVorgabe').isVisible());
  await ctx.close();
}
console.log('\n' + pass + ' erfüllt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
