import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };

const bau = async (ctx, doc) => {
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const r = await p.evaluate(async (doc) => {
    const enc=(b)=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
    const hex=(n)=>Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');
    const id=hex(16), token=enc(crypto.getRandomValues(new Uint8Array(24)));
    const proof=enc(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    const keyStr=enc(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id),tagLength:128},key,new TextEncoder().encode(JSON.stringify(doc))));
    await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'create',id,proof,payload:{iv:enc(iv),ct:enc(ct)}})});
    return { id, keyStr, token };
  }, doc);
  await p.close();
  return r;
};

const L = (contact) => ({ v:1, title:'Annas Keller', contact, showBorrower:false,
  items:[{id:'i1',name:'Bohrmaschine',note:'mit Koffer',status:'available',borrower:'',since:''}] });

const ctx0 = await br.newContext({ locale: 'de-DE' });
const voll  = await bau(ctx0, L({name:'Anna Beispiel', email:'anna@beispiel.invalid', phone:'0221 123456'}));
const nurMail = await bau(ctx0, L({name:'Anna Beispiel', email:'anna@beispiel.invalid', phone:''}));
const nichts = await bau(ctx0, L({name:'', email:'', phone:''}));
await ctx0.close();

async function zeige(name, liste, breite, share) {
  const ctx = await br.newContext({ viewport:{width:breite, height:820}, locale:'de-DE',
    hasTouch: breite < 500, isMobile: breite < 500, deviceScaleFactor: 2 });
  if (share) {
    await ctx.addInitScript(() => { Object.defineProperty(navigator,'share',{value:function(){return Promise.resolve();},configurable:true}); });
  }
  const p = await ctx.newPage();
  await p.goto(BASE + '/#v='+liste.id+'.'+liste.keyStr, { waitUntil:'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(400);
  await p.locator('#itemList .item-ask').first().click();
  await p.waitForTimeout(350);
  await p.screenshot({ path: BILDER + 'anfrage-' + name + '.png' });
  const m = await p.evaluate(() => {
    const f = document.querySelector('#modalFoot');
    return { klasse: f.className, hoch: Math.round(f.getBoundingClientRect().height),
      kinder: Array.from(f.children).map(n => n.textContent.trim() || '(Abstand)'),
      ueberlauf: f.scrollWidth > f.getBoundingClientRect().width + 1 };
  });
  await ctx.close();
  return m;
}

console.log('· Anfrage, alle drei Wege');
{
  const m = await zeige('voll-390', voll, 390, true);
  ok('Fuss traegt die Stapelklasse', /modal__foot--stack/.test(m.klasse), m.klasse);
  ok('kein Ueberlauf', !m.ueberlauf);
  console.log('    ' + JSON.stringify(m.kinder) + ' Hoehe ' + m.hoch);
}
{
  const m = await zeige('voll-1024', voll, 1024, true);
  ok('am grossen Schirm ebenso gestapelt', !m.ueberlauf && /stack/.test(m.klasse));
  console.log('    Hoehe ' + m.hoch);
}
console.log('· Nur E-Mail');
{
  const m = await zeige('mail-390', nurMail, 390, false);
  ok('zwei Elemente, kein Ueberlauf', !m.ueberlauf, JSON.stringify(m.kinder));
  console.log('    ' + JSON.stringify(m.kinder));
}
console.log('· Weder E-Mail noch Telefon noch Teilen: Zwischenablage');
{
  const m = await zeige('kopie-390', nichts, 390, false);
  ok('Kopieren steht da', m.kinder.some(x => /Kopieren|kopieren/.test(x)), JSON.stringify(m.kinder));
  ok('kein Ueberlauf', !m.ueberlauf);
}

console.log('· Der Bearbeiten-Dialog bleibt eine Reihe');
{
  const ctx = await br.newContext({ viewport:{width:390, height:820}, locale:'de-DE', hasTouch:true, isMobile:true });
  const p = await ctx.newPage();
  await p.goto(BASE + '/#e='+voll.id+'.'+voll.keyStr+'.'+voll.token, { waitUntil:'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(500);
  await p.locator('#itemList .itemrow').first().click();
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => {
    const f = document.querySelector('#modalFoot');
    const r = f.getBoundingClientRect();
    return { klasse: f.className, ueberlauf: f.scrollWidth > r.width + 1,
      kinder: Array.from(f.children).map(n => { const b = n.getBoundingClientRect();
        return { t: n.textContent.trim(), b: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.top) }; }) };
  });
  ok('keine Stapelklasse im Bearbeiten-Fuss', !/stack/.test(m.klasse), m.klasse);
  ok('beide nebeneinander', m.kinder.length === 2 && m.kinder[0].y === m.kinder[1].y, JSON.stringify(m.kinder));
  ok('kein Ueberlauf', !m.ueberlauf, JSON.stringify(m.kinder));
  ok('beide mindestens 44 hoch', m.kinder.every(k => k.h >= 44), JSON.stringify(m.kinder.map(k=>k.h)));
  await p.screenshot({ path: BILDER + 'bearbeiten-390.png' });
  await ctx.close();
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
