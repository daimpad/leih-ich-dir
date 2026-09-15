import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };
const ctx = await br.newContext({ viewport:{width:1000,height:1100}, locale:'de-DE' });
const p = await ctx.newPage();
const fehler=[]; p.on('pageerror',e=>fehler.push(e.message));

const mach = async (doc) => p.evaluate(async (doc) => {
  const enc=(b)=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  const hex=(n)=>Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');
  const id=hex(16), token=enc(crypto.getRandomValues(new Uint8Array(24)));
  const proof=enc(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const keyStr=enc(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id),tagLength:128},key,new TextEncoder().encode(JSON.stringify(doc))));
  const r=await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'create',id,proof,payload:{iv:enc(iv),ct:enc(ct)}})});
  return { id, keyStr, token, status:r.status };
}, doc);
const L=(t,n,items)=>({v:1,title:t,contact:{name:n,email:'',phone:''},showBorrower:false,items:items||[]});
const lies = async (hash) => p.evaluate(async (arg) => {
  const dec=(s)=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s);const o=new Uint8Array(b.length);for(let i=0;i<b.length;i++)o[i]=b.charCodeAt(i);return o;};
  const [id,keyStr]=arg.split('.');
  const r=await (await fetch('api.php?a=read&id='+id)).json();
  const key=await crypto.subtle.importKey('raw',dec(keyStr),{name:'AES-GCM'},true,['decrypt']);
  const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:dec(r.payload.iv),additionalData:new TextEncoder().encode(id),tagLength:128},key,dec(r.payload.ct));
  return { rev: r.rev, doc: JSON.parse(new TextDecoder().decode(buf)) };
}, hash.replace(/^#k=/,''));

await p.goto(BASE + '/',{waitUntil:'networkidle'});
await p.evaluate(()=>{localStorage.clear();localStorage.setItem('lid.lang','de');});
await p.reload({waitUntil:'networkidle'});

const a = await mach(L('Annas Keller','Anna',[{id:'1',name:'Bohrmaschine',note:'',status:'available',borrower:'',since:''}]));
const b = await mach(L('Bernds Werkstatt','Bernd',[{id:'1',name:'Hobel',note:'',status:'available',borrower:'',since:''}]));

console.log('· Entfernen wird eingeloest, wenn man die Uebersicht verlaesst');
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])'); await p.waitForTimeout(500);
const kh = await p.evaluate(()=>location.hash);
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
for (const l of [a,b]) {
  await p.locator('#circleAddLink').fill('#v='+l.id+'.'+l.keyStr);
  await p.locator('#btnCircleAdd').click(); await p.waitForTimeout(700);
}
await p.waitForTimeout(600);
ok('zwei Freunde drin', (await lies(kh)).doc.friends.length === 2);
// Entfernen und SOFORT die Uebersicht verlassen, lange vor UNDO_MS
await p.locator('#circleFriends [data-kreis-act="remove"]').first().click();
await p.waitForTimeout(150);
await p.evaluate((h)=>{location.hash=h;}, '#v='+a.id+'.'+a.keyStr);
await p.waitForSelector('#viewList:not([hidden])'); await p.waitForTimeout(1500);
{
  const st = await lies(kh);
  ok('das Entfernen ist geschrieben, obwohl die Frist noch lief', st.doc.friends.length === 1,
     JSON.stringify(st.doc.friends.map(f=>f.id)));
  ok('die Meldung mit der Ruecknahme ist weg', await p.locator('#toast').isHidden());
}
ok('keine Ausnahme', fehler.length===0, fehler.join(' | '));

console.log('· Die Ruecknahme wirft nach einem Ortswechsel nicht');
await p.evaluate((h)=>{location.hash=h;}, kh);
await p.waitForSelector('#viewCircle:not([hidden])'); await p.waitForTimeout(1500);
await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
await p.locator('#circleFriends [data-kreis-act="remove"]').first().click();
await p.waitForTimeout(150);
await p.evaluate((h)=>{location.hash=h;}, '#v='+a.id+'.'+a.keyStr);
await p.waitForSelector('#viewList:not([hidden])'); await p.waitForTimeout(900);
fehler.length = 0;
// Die Meldung ist weg; ein Klick auf den Knopf darf trotzdem nichts werfen
await p.evaluate(()=>{ const n=document.querySelector('#toastAct'); if (n && n.onclick) { n.onclick(); } });
await p.waitForTimeout(400);
ok('kein TypeError beim spaeten Ruecknehmen', fehler.length===0, fehler.join(' | '));

console.log('· #circleFriends wird beim Verlassen geraeumt');
{
  const rest = await p.evaluate(()=>document.querySelector('#circleFriends').children.length);
  ok('der Aufklapper ist leer', rest === 0, String(rest));
  ok('und kein fremder Name steht mehr im Dokument', !(await p.content()).includes('Bernds Werkstatt'));
}

console.log('· Aufnehmen waehrend des Ladens geht nicht verloren');
{
  // Die Abrufe kuenstlich verlangsamen, damit das Zeitfenster gross wird
  await p.route('**/api.php?a=read*', async (r) => { await new Promise(s=>setTimeout(s,900)); r.continue(); });
  const c = await mach(L('Cs Schuppen','C',[{id:'1',name:'Leiter',note:'',status:'available',borrower:'',since:''}]));
  await p.evaluate((h)=>{location.hash='#main';location.hash=h;}, kh);
  await p.goto(BASE + '/'+kh, {waitUntil:'domcontentloaded'});
  await p.waitForSelector('#viewCircle:not([hidden])', {timeout:15000});
  await p.waitForTimeout(400);                       // mitten im Laden
  await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
  await p.locator('#circleAddLink').fill('#v='+c.id+'.'+c.keyStr);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(4000);
  const st = await lies(kh);
  ok('der neue Freund steht im Dokument', st.doc.friends.some(f=>f.id===c.id), JSON.stringify(st.doc.friends.map(f=>f.id)));
  const namen = await p.evaluate(()=>Array.from(document.querySelectorAll('#circleItems .item-name')).map(n=>n.textContent));
  ok('und seine Sache steht in der Uebersicht', namen.includes('Leiter'), JSON.stringify(namen));
  await p.unroute('**/api.php?a=read*');
}

console.log('· Der Kontaktname wandert nicht ins Chiffrat');
{
  const d = await mach(L('Ds Regal','Dora Beispiel',[{id:'1',name:'Zange',note:'',status:'available',borrower:'',since:''}]));
  await p.goto(BASE + '/#v='+d.id+'.'+d.keyStr, {waitUntil:'networkidle'});
  await p.waitForTimeout(700);
  await p.locator('#btnCircleAddHere').click();
  await p.waitForTimeout(2500);
  const st = await lies(kh);
  const e = st.doc.friends.filter(f=>f.id===d.id)[0];
  ok('aufgenommen', !!e, JSON.stringify(st.doc.friends.map(f=>f.id)));
  ok('aber ohne abgeschriebenen Namen', e && e.label === '', JSON.stringify(e));
  // Angezeigt steht trotzdem der Name
  await p.goto(BASE + '/'+kh, {waitUntil:'networkidle'});
  await p.waitForTimeout(2500);
  const wer = await p.evaluate(()=>Array.from(document.querySelectorAll('#circleItems .item-who')).map(n=>n.textContent));
  ok('und wird zur Laufzeit aufgeloest', wer.includes('Dora Beispiel'), JSON.stringify(wer));
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
if (fehler.length) console.log('Meldungen: ' + fehler.join(' | '));
await br.close();
process.exit(fail ? 1 : 0);
