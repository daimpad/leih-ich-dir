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
  await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'create',id,proof,payload:{iv:enc(iv),ct:enc(ct)}})});
  return { id, keyStr, token };
}, doc);
const L=(t,n,items)=>({v:1,title:t,contact:{name:n,email:'',phone:''},showBorrower:false,items:items||[]});
const lies = async (frag) => p.evaluate(async (arg) => {
  const dec=(s)=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s);const o=new Uint8Array(b.length);for(let i=0;i<b.length;i++)o[i]=b.charCodeAt(i);return o;};
  const [id,keyStr]=arg.split('.');
  const r=await (await fetch('api.php?a=read&id='+id)).json();
  const key=await crypto.subtle.importKey('raw',dec(keyStr),{name:'AES-GCM'},true,['decrypt']);
  const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:dec(r.payload.iv),additionalData:new TextEncoder().encode(id),tagLength:128},key,dec(r.payload.ct));
  return { rev:r.rev, doc: JSON.parse(new TextDecoder().decode(buf)) };
}, frag.replace(/^#[evk]=/,'').split('.').slice(0,2).join('.'));

await p.goto(BASE + '/',{waitUntil:'networkidle'});
await p.evaluate(()=>{localStorage.clear();localStorage.setItem('lid.lang','de');});
await p.reload({waitUntil:'networkidle'});
const a = await mach(L('Annas Keller','Anna',[{id:'1',name:'Bohrmaschine',note:'',status:'available',borrower:'',since:''}]));
const b = await mach(L('Bernds Werkstatt','Bernd',[{id:'1',name:'Hobel',note:'',status:'available',borrower:'',since:''}]));

console.log('· Fund 2: Entfernen, dann Aktualisieren innerhalb der Frist');
await p.locator('#btnStartCircle').click();
await p.waitForSelector('#viewCircle:not([hidden])'); await p.waitForTimeout(500);
const kh = await p.evaluate(()=>location.hash);
await p.evaluate(()=>{document.querySelector('#circleManage').open=true;});
for (const l of [a,b]) {
  await p.locator('#circleAddLink').fill('#v='+l.id+'.'+l.keyStr);
  await p.locator('#btnCircleAdd').click(); await p.waitForTimeout(700);
}
await p.waitForTimeout(500);
await p.locator('#circleFriends [data-kreis-act="remove"]').first().click();
await p.waitForTimeout(200);
await p.locator('#btnCircleRefresh').click();
await p.waitForTimeout(2500);
{
  const st = await lies(kh);
  ok('das Entfernen ist geschrieben', st.doc.friends.length === 1, JSON.stringify(st.doc.friends.map(f=>f.id)));
  ok('kein doppelter Eintrag', new Set(st.doc.friends.map(f=>f.id)).size === st.doc.friends.length);
  const n = await p.evaluate(()=>document.querySelectorAll('#circleFriends li').length);
  ok('der Aufklapper zeigt einen Freund', n === 1, String(n));
  ok('die Ruecknahme ist weg', await p.locator('#toast').isHidden());
  ok('keine Ausnahme', fehler.length===0, fehler.join(' | '));
}

console.log('· Fund 4: Gegenstand loeschen, dann zur Startseite');
await p.goto(BASE + '/#e='+a.id+'.'+a.keyStr+'.'+a.token,{waitUntil:'networkidle'});
await p.waitForSelector('#viewList:not([hidden])'); await p.waitForTimeout(700);
await p.locator('#itemList .itemrow').first().click(); await p.waitForTimeout(400);
await p.locator('#modalFoot .btn--danger').click(); await p.waitForTimeout(400);
ok('die Ruecknahme steht', await p.locator('#toastAct').isVisible());
fehler.length = 0;
await p.evaluate(()=>{location.hash='';});
await p.waitForTimeout(1500);
ok('die Meldung ist weg', await p.locator('#toast').isHidden());
await p.evaluate(()=>{const n=document.querySelector('#toastAct'); if (n && n.onclick) { n.onclick(); }});
await p.waitForTimeout(400);
ok('kein TypeError beim spaeten Ruecknehmen', fehler.length===0, fehler.join(' | '));
{
  const st = await lies('#e='+a.id+'.'+a.keyStr);
  ok('das Loeschen ist geschrieben', st.doc.items.length === 0, JSON.stringify(st.doc.items.map(i=>i.name)));
}

console.log('· Fund 9: kein Listentitel im Reiter');
await p.goto(BASE + '/#e='+b.id+'.'+b.keyStr+'.'+b.token,{waitUntil:'networkidle'});
await p.waitForTimeout(800);
{
  const t = await p.title();
  ok('der Reiter nennt nur die Art', t === 'Deine Leihliste · LeihIchDir', t);
  ok('und nicht den Titel der Liste', !t.includes('Bernds'), t);
}
await p.goto(BASE + '/#v='+b.id+'.'+b.keyStr,{waitUntil:'networkidle'});
await p.waitForTimeout(800);
ok('im Ansehen-Modus ebenso', (await p.title()) === 'Eine Leihliste · LeihIchDir', await p.title());

console.log('· Fund 7: der Loeschkasten der Superliste spricht von ihr');
await p.goto(BASE + '/einstellungen.html'+kh,{waitUntil:'networkidle'});
await p.waitForTimeout(900);
{
  const m = await p.evaluate(()=>({
    kopf: document.querySelector('#dangerBox .card__title').textContent,
    hint: document.querySelector('#dangerBox .hint').textContent.trim(),
    knopf: document.querySelector('#btnDeleteList span[data-i18n]').textContent,
    sichtbar: !document.querySelector('#dangerBox').hidden }));
  ok('der Kasten steht da', m.sichtbar);
  ok('Ueberschrift nennt die Superliste', /Superliste/.test(m.kopf), m.kopf);
  ok('kein "beide Links" mehr', !/[Bb]eide Links/.test(m.hint), m.hint.slice(0,90));
  ok('der Knopf ebenso', /Superliste/.test(m.knopf), m.knopf);
  // Und der Sprachwechsel darf es nicht zurueckdrehen
  await p.locator('#btnLang').click(); await p.waitForTimeout(500);
  const en = await p.evaluate(()=>document.querySelector('#dangerBox .card__title').textContent);
  ok('auch nach dem Sprachwechsel', /super list/i.test(en), en);
}
{
  // Nur das Fragment zu wechseln laedt die Seite nicht neu, und
  // initSettings laeuft je Ladevorgang genau einmal. Also ausdruecklich neu.
  await p.goto(BASE + '/einstellungen.html#e='+a.id+'.'+a.keyStr+'.'+a.token,{waitUntil:'networkidle'});
  await p.reload({waitUntil:'networkidle'});
  await p.waitForTimeout(900);
  const kopf = await p.evaluate(()=>document.querySelector('#dangerBox .card__title').textContent);
  ok('bei einer Leihliste bleibt es die Leihliste', /Liste|list/i.test(kopf) && !/Superliste|super list/i.test(kopf), kopf);
}

console.log('· Fund 5 und 6: die Aufnehmen-Zeile bei 320 Punkten');
{
  const c2 = await br.newContext({ viewport:{width:320,height:800}, locale:'de-DE', hasTouch:true, isMobile:true });
  const q = await c2.newPage();
  await q.goto(BASE + '/'+kh,{waitUntil:'networkidle'});
  await q.waitForSelector('#viewCircle:not([hidden])'); await q.waitForTimeout(1500);
  await q.evaluate(()=>{document.querySelector('#circleManage').open=true;});
  await q.waitForTimeout(300);
  const m = await q.evaluate(()=>{
    const k=document.querySelector('#btnCircleAdd'), f=document.querySelector('#circleAddLink');
    const rk=k.getBoundingClientRect(), rf=f.getBoundingClientRect();
    return { knopf:{b:Math.round(rk.width),h:Math.round(rk.height),x:Math.round(rk.left),r:Math.round(rk.right)},
             feld:{b:Math.round(rf.width),x:Math.round(rf.left),r:Math.round(rf.right)},
             text:k.textContent.trim(), ueberlauf: k.scrollWidth > rk.width + 1,
             seite: document.documentElement.scrollWidth, fenster: window.innerWidth };
  });
  console.log('    ' + JSON.stringify(m));
  ok('der Knopf traegt sein Wort', !m.ueberlauf, 'scrollWidth > Breite');
  ok('der Knopf ist breit genug', m.knopf.b >= 70, String(m.knopf.b));
  ok('Feld und Knopf ueberlappen nicht', m.feld.r <= m.knopf.x + 1, m.feld.r + ' / ' + m.knopf.x);
  ok('kein waagerechter Ueberlauf', m.seite <= m.fenster, m.seite + ' / ' + m.fenster);
  // Gegenprobe: im Inventar bleibt der Knopf schmal mit Zeichen
  await q.goto(BASE + '/#e='+b.id+'.'+b.keyStr+'.'+b.token,{waitUntil:'networkidle'});
  await q.waitForTimeout(900);
  const inv = await q.evaluate(()=>{
    const k=document.querySelector('#addForm .addrow .btn[type="submit"], #addForm .addrow button:last-of-type');
    const r=k.getBoundingClientRect();
    return { b: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('im Inventar bleibt der Knopf das schmale Zeichen', inv.b <= 50, JSON.stringify(inv));
  await c2.close();
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
if (fehler.length) console.log('Meldungen: ' + fehler.join(' | '));
await br.close();
process.exit(fail ? 1 : 0);
