import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };

const mach = async (p, doc) => p.evaluate(async (doc) => {
  const enc=(b)=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  const hex=(n)=>Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');
  const id=hex(16), token=enc(crypto.getRandomValues(new Uint8Array(24)));
  const proof=enc(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const keyStr=enc(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id),tagLength:128},key,new TextEncoder().encode(JSON.stringify(doc))));
  const r=await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'create',id,proof,payload:{iv:enc(iv),ct:enc(ct)}})});
  return { id, keyStr, token, status: r.status };
}, doc);

/* Ein Messsatz je Ansicht. */
const MESSUNG = `(() => {
  const w = window.innerWidth;
  const sicht = (n) => { const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden' && n.offsetParent !== null; };
  const anfassbar = Array.from(document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([type=hidden]), textarea, select, summary, [tabindex]:not([tabindex="-1"])'
  )).filter(sicht).filter(n => !n.closest('[hidden]'));
  const imFliesstext = (n) => {
    if (n.tagName !== 'A') { return false; }
    const e = n.parentElement;
    if (!e) { return false; }
    /* Ein Verweis mitten in einem Absatz oder Listeneintrag: Die Richtlinie
       nimmt ihn ausdruecklich aus, seine Groesse folgt der Zeile. */
    return /^(P|LI|SMALL|SPAN|EM|STRONG|TD)$/.test(e.tagName);
  };
  const ueberLabel = (n) => n.tagName === 'INPUT'
    && (n.type === 'checkbox' || n.type === 'radio') && !!n.closest('label');
  const klein = [], raus = [];
  anfassbar.forEach(n => {
    if (imFliesstext(n) || ueberLabel(n)) { return; }
    const r = n.getBoundingClientRect();
    /* Die Trefferflaeche kann groesser sein als der Kasten: ::after in der
       Regel fuer grobe Zeiger. Deshalb den groesseren von beiden messen. */
    const nach = getComputedStyle(n, '::after');
    let bb = r.width, hh = r.height;
    if (nach && nach.content !== 'none' && nach.position === 'absolute') {
      const pw = parseFloat(nach.width), ph = parseFloat(nach.height);
      if (!isNaN(pw)) bb = Math.max(bb, pw);
      if (!isNaN(ph)) hh = Math.max(hh, ph);
    }
    const mark = (n.id ? '#'+n.id : (n.className ? '.'+String(n.className).split(' ')[0] : n.tagName))
      + ' "' + (n.textContent||'').trim().slice(0,22) + '"';
    /* Auf ganze Punkte gerundet verglichen: Ein Kasten von 43,98 Punkten ist
       44 Punkte gross, und der Unterschied entsteht allein aus rem-Rechnung. */
    if (Math.round(bb) < 44 || Math.round(hh) < 44) { klein.push(mark + ' ' + Math.round(bb) + 'x' + Math.round(hh)); }
    if (r.right > w + 1 || r.left < -1) { raus.push(mark + ' @' + Math.round(r.left) + '..' + Math.round(r.right)); }
  });
  /* Und die Gegenprobe: Ist die Mitte jedes Elements wirklich es selbst?
     Eine zu grosse Ueberlagerung des Nachbarn stiehlt sonst den Griff. */
  const gestohlen = [];
  /* Steht ein Fenster offen, liegt sein Hintergrund ueber der ganzen Seite.
     Dass dort nichts mehr anklickbar ist, ist der Zweck eines <dialog> und
     kein Fund. Gemessen wird dann nur noch im Fenster selbst. */
  const offenesFenster = document.querySelector('dialog[open]');
  anfassbar.forEach(n => {
    if (ueberLabel(n)) { return; }
    if (offenesFenster && !offenesFenster.contains(n)) { return; }
    const r = n.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    if (x < 0 || y < 0 || x > w || y > window.innerHeight) { return; }
    const oben = document.elementFromPoint(x, y);
    if (!oben) { return; }
    if (n.contains(oben) || oben.contains(n)) { return; }
    gestohlen.push((n.id ? '#'+n.id : n.tagName) + ' "' + (n.textContent||'').trim().slice(0,18)
      + '" -> ' + (oben.id ? '#'+oben.id : (oben.className ? '.'+String(oben.className).split(' ')[0] : oben.tagName)));
  });
  return {
    seite: document.documentElement.scrollWidth, fenster: w,
    klein: klein, raus: raus, gestohlen: gestohlen, anzahl: anfassbar.length
  };
})()`;

async function pruefe(p, name, breite) {
  await p.waitForTimeout(350);
  const m = await p.evaluate(MESSUNG);
  ok(name + ' @' + breite + ': kein waagerechter Ueberlauf', m.seite <= m.fenster,
     'scrollWidth ' + m.seite + ' > ' + m.fenster);
  ok(name + ' @' + breite + ': nichts ragt seitlich heraus', m.raus.length === 0, m.raus.join(' | '));
  ok(name + ' @' + breite + ': alle Trefferflaechen >= 44', m.klein.length === 0, m.klein.join(' | '));
  ok(name + ' @' + breite + ': niemand stiehlt den Griff des Nachbarn', m.gestohlen.length === 0, m.gestohlen.join(' | '));
  return m;
}

for (const breite of [320, 390]) {
  console.log('=== ' + breite + ' Punkte ===');
  const ctx = await br.newContext({ viewport:{width:breite, height:800}, locale:'de-DE',
    hasTouch:true, isMobile:true, deviceScaleFactor:2,
    userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator,'share',{value:function(){return Promise.resolve();},configurable:true}); });
  const p = await ctx.newPage();
  const fehler = [];
  p.on('pageerror', e => fehler.push(e.message));

  await p.goto(BASE + '/', { waitUntil:'networkidle' });
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lid.lang','de'); });
  await p.reload({ waitUntil:'networkidle' });

  const anna = await mach(p, { v:1, title:'Annas sehr langer Listenname zum Ausprobieren', 
    contact:{name:'Anna Beispiel-Langname', email:'anna@beispiel.invalid', phone:'0221 123456'},
    showBorrower:true, items:[
      {id:'i1',name:'Bohrmaschine mit ausgesprochen langem Namen',note:'mit Koffer und vielen Bits',status:'available',borrower:'',since:''},
      {id:'i2',name:'Rasenmäher',note:'',status:'lent',borrower:'Carla Musterfrau',since:'2026-08-01'}]});

  console.log('· Startseite');
  await pruefe(p, 'Start', breite);

  console.log('· Liste ansehen');
  await p.goto(BASE + '/#v='+anna.id+'.'+anna.keyStr, { waitUntil:'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await pruefe(p, 'Ansehen', breite);

  console.log('· Anfrage-Dialog');
  await p.locator('#itemList .item-ask').first().click();
  await pruefe(p, 'Anfrage', breite);
  await p.locator('#modalClose').click();
  await p.waitForTimeout(250);

  console.log('· Liste bearbeiten');
  await p.goto(BASE + '/#e='+anna.id+'.'+anna.keyStr+'.'+anna.token, { waitUntil:'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])');
  await p.waitForTimeout(500);
  await pruefe(p, 'Bearbeiten', breite);

  console.log('· Gegenstand-Dialog');
  await p.locator('#itemList .itemrow').first().click();
  await pruefe(p, 'Gegenstand', breite);
  await p.locator('#modalClose').click();
  await p.waitForTimeout(250);

  console.log('· Kontakt und Teilen aufgeklappt');
  await p.locator('#contactBox summary').click();
  await pruefe(p, 'Kontakt', breite);

  console.log('· Superliste');
  await p.goto(BASE + '/', { waitUntil:'networkidle' });
  await p.waitForTimeout(400);
  await p.locator('#btnStartCircle').click();
  await p.waitForSelector('#viewCircle:not([hidden])');
  await p.waitForTimeout(600);
  const kh = await p.evaluate(() => location.hash);
  await p.evaluate(() => { document.querySelector('#circleManage').open = true; });
  await p.locator('#circleAddLink').fill('#v='+anna.id+'.'+anna.keyStr);
  await p.locator('#btnCircleAdd').click();
  await p.waitForTimeout(900);
  await pruefe(p, 'Superliste', breite);

  console.log('· Einstellungen');
  await p.goto(BASE + '/einstellungen.html'+kh, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await pruefe(p, 'Einstellungen', breite);

  console.log('· Fehleransicht');
  await p.goto(BASE + '/#v=00112233445566778899aabbccddeeff.' + 'A'.repeat(43), { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await pruefe(p, 'Fehler', breite);

  console.log('· Rechtstexte');
  for (const seite of ['ueber.html','datenschutz.html','impressum.html']) {
    await p.goto(BASE + '/'+seite, { waitUntil:'networkidle' });
    await pruefe(p, seite, breite);
  }

  ok('keine unbehandelte Ausnahme im ganzen Rundgang @'+breite, fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
