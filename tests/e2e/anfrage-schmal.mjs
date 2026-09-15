import { chromium, BROWSER, BASE, BILDER } from './hilfe.mjs';
const br = await chromium.launch({ executablePath: BROWSER });
let pass = 0, fail = 0;
const ok = (n, c, d='') => { c ? (pass++, console.log('  ok    '+n)) : (fail++, console.log('  FEHLT '+n+(d?'  — '+d:''))); };

/* Ein Telefon: grober Zeiger, Beruehrung, navigator.share vorhanden. */
async function telefon(breite) {
  const ctx = await br.newContext({
    viewport: { width: breite, height: 760 }, locale: 'de-DE',
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
  });
  await ctx.addInitScript(() => {
    /* navigator.share gibt es im Kopflos-Chromium nicht. Untergeschoben,
       damit der dritte Knopf im Fuss ueberhaupt entsteht. */
    Object.defineProperty(navigator, 'share', { value: function () { return Promise.resolve(); }, configurable: true });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  ERR ' + e.message));
  return { ctx, p };
}

const daten = { id: null, keyStr: null };

{
  const { ctx, p } = await telefon(390);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const r = await p.evaluate(async () => {
    const enc=(b)=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
    const hex=(n)=>Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');
    const id=hex(16), token=enc(crypto.getRandomValues(new Uint8Array(24)));
    const proof=enc(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    const keyStr=enc(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const doc={v:1,title:'Annas Keller',contact:{name:'Anna Beispiel',email:'anna+leih@beispiel.invalid',phone:'0221 / 12 34 56'},
      showBorrower:false,items:[{id:'i1',name:'Bohrmaschine',note:'mit Koffer',status:'available',borrower:'',since:''}]};
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id),tagLength:128},key,new TextEncoder().encode(JSON.stringify(doc))));
    const res=await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'create',id,proof,payload:{iv:enc(iv),ct:enc(ct)}})});
    return { id, keyStr, status: res.status };
  });
  daten.id = r.id; daten.keyStr = r.keyStr;
  ok('Testliste mit E-Mail und Telefon angelegt', r.status === 200, String(r.status));
  await ctx.close();
}

for (const breite of [320, 360, 390, 430, 500, 600, 768, 1024]) {
  console.log('· ' + breite + ' Punkte');
  const { ctx, p } = await telefon(breite);
  await p.goto(BASE + '/#v=' + daten.id + '.' + daten.keyStr, { waitUntil: 'networkidle' });
  await p.waitForSelector('#viewList:not([hidden])', { timeout: 10000 });
  await p.waitForTimeout(500);

  const seiteBreit = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok('Liste ohne waagerechten Ueberlauf', seiteBreit.doc <= seiteBreit.win, JSON.stringify(seiteBreit));

  await p.locator('#itemList .item-ask').first().click();
  await p.waitForTimeout(400);

  const m = await p.evaluate(() => {
    const dlg = document.querySelector('#itemModal');
    const foot = document.querySelector('#modalFoot');
    const knoepfe = Array.from(foot.children).filter(n => !n.classList.contains('spacer'));
    const fr = foot.getBoundingClientRect();
    const cs = getComputedStyle(foot);
    return {
      offen: dlg.open,
      dialogBreite: Math.round(dlg.getBoundingClientRect().width),
      fussBreite: Math.round(fr.width),
      fussScroll: foot.scrollWidth,
      wrap: cs.flexWrap,
      anzahl: knoepfe.length,
      knoepfe: knoepfe.map(n => {
        const r = n.getBoundingClientRect();
        return { text: n.textContent.trim(), x: Math.round(r.left), rechts: Math.round(r.right),
                 y: Math.round(r.top), unten: Math.round(r.bottom),
                 b: Math.round(r.width), h: Math.round(r.height), tag: n.tagName,
                 href: n.getAttribute('href') || '' };
      }),
      dialogUnten: Math.round(dlg.getBoundingClientRect().bottom),
      schirm: window.innerHeight,
      seite: document.documentElement.scrollWidth
    };
  });
  console.log('    ' + JSON.stringify(m.knoepfe.map(k => k.text + ' ' + k.b + 'x' + k.h + ' @' + k.x + '..' + k.rechts)));
  ok('der Dialog ist offen', m.offen);
  ok('vier Elemente im Fuss (Schliessen, E-Mail, Anrufen, Teilen)', m.anzahl === 4, String(m.anzahl));
  ok('der Fuss laeuft nicht ueber seine eigene Breite hinaus', m.fussScroll <= m.fussBreite + 1,
     'scrollWidth ' + m.fussScroll + ' > ' + m.fussBreite);
  ok('kein Knopf ragt rechts aus dem Dialog', m.knoepfe.every(k => k.rechts <= m.dialogBreite + Math.round((seiteBreit.win - m.dialogBreite)/2) + 1),
     JSON.stringify(m.knoepfe.map(k => k.rechts)) + ' bei Dialogbreite ' + m.dialogBreite);
  ok('kein Knopf beginnt links ausserhalb', m.knoepfe.every(k => k.x >= 0), JSON.stringify(m.knoepfe.map(k => k.x)));
  ok('jeder Knopf mindestens 44 Punkte hoch (grober Zeiger)', m.knoepfe.every(k => k.h >= 44),
     JSON.stringify(m.knoepfe.map(k => k.text + ':' + k.h)));
  ok('jeder Knopf breiter als 44 Punkte', m.knoepfe.every(k => k.b >= 44),
     JSON.stringify(m.knoepfe.map(k => k.text + ':' + k.b)));
  ok('die Seite bleibt ohne waagerechten Ueberlauf', m.seite <= seiteBreit.win, String(m.seite));
  ok('der Dialog passt in die Hoehe', m.dialogUnten <= m.schirm + 1, m.dialogUnten + ' von ' + m.schirm);

  /* Ueberlappen sich zwei Knoepfe wirklich? Zwei Rechtecke ueberlappen nur,
     wenn sie sich waagerecht UND senkrecht schneiden. In der Spalte teilen
     sich alle dieselbe x-Achse und stehen trotzdem sauber untereinander. */
  let ueberlapp = null;
  for (let i = 0; i < m.knoepfe.length; i++) {
    for (let j = i + 1; j < m.knoepfe.length; j++) {
      const a = m.knoepfe[i], b = m.knoepfe[j];
      const waag = a.x < b.rechts - 1 && b.x < a.rechts - 1;
      const senk = a.y < b.unten - 1 && b.y < a.unten - 1;
      if (waag && senk) { ueberlapp = a.text + ' / ' + b.text; }
    }
  }
  ok('keine zwei Knoepfe ueberlappen', !ueberlapp, ueberlapp || '');

  /* Trefferprobe: laesst sich jeder Knopf wirklich beruehren? */
  for (const k of m.knoepfe) {
    const treffer = await p.evaluate((k) => {
      const dlg = document.querySelector('#modalFoot');
      const el = Array.from(dlg.children).filter(n => n.textContent.trim() === k.text)[0];
      if (!el) { return 'nicht gefunden'; }
      const r = el.getBoundingClientRect();
      const oben = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
      return (oben && el.contains(oben)) ? 'ok' : 'verdeckt von ' + (oben ? oben.className || oben.tagName : 'nichts');
    }, k);
    ok('"' + k.text + '" ist in seiner Mitte anfassbar', treffer === 'ok', treffer);
  }

  if (breite === 360) { await p.screenshot({ path: BILDER + 'anfrage-360.png' }); }
  await ctx.close();
}

console.log('\n' + pass + ' erfuellt, ' + fail + ' offen');
await br.close();
process.exit(fail ? 1 : 0);
