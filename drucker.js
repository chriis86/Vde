// Bluetooth-Etikettendruck.
// - In der Android-App: über das Capacitor-Plugin "BluetoothLe"
// - Im Browser (Chrome auf Android, https): über Web Bluetooth
// Zwei Drucksprachen:
// - "p22":    Olympia P22 / Nelko P21 (Labelnize-Familie): TSPL über BLE-Dienst FF00, Kanal FF02.
//             96 Punkte Kopf, Bild wird um 90° im Uhrzeigersinn gedreht, Bit 0 = schwarz.
//             (nach dem offenen Projekt p21studio, auf echten P21 erprobt)
// - "escpos": Rasterbild ESC/POS (GS v 0) für viele andere günstige Thermodrucker.
const Drucker = (() => {
  // Bekannte BLE-Dienste günstiger Thermodrucker
  const DIENSTE = [
    0xff00, 0x18f0, 0xae30, 0xfee7, 0xae3a, 0xe0ff, 0xffe0,
    "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  ];
  const voll = u => typeof u === "number"
    ? "0000" + u.toString(16).padStart(4, "0") + "-0000-1000-8000-00805f9b34fb" : u.toLowerCase();

  let geraet = null, kanal = null, verbundenFlag = false, modus = "escpos", stueck = 128;
  const P22_DIENST = voll(0xff00), P22_KANAL = voll(0xff02);
  // Diagnose: was wurde gefunden/gesendet, was hat der Drucker geantwortet
  const diag = { dienste: [], kanal: "", mtu: 0, stueck: 0, gesendet: 0, antworten: [], schritte: [] };
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, "0")).join(" ");
  const hexZuBytes = h => new Uint8Array((h.replace(/[^0-9a-f]/gi, "").match(/../g) || []).map(x => parseInt(x, 16)));
  let wartende = [];                                   // Promises, die auf eine Antwort warten
  function antwort(bytes) {
    const txt = Array.from(bytes, b => b >= 32 && b < 127 ? String.fromCharCode(b) : ".").join("");
    diag.antworten.push(hex(bytes) + "  |" + txt + "|");
    if (diag.antworten.length > 30) diag.antworten.shift();
    const w = wartende; wartende = []; w.forEach(f => f(bytes));
  }
  const warteAufAntwort = ms => new Promise(ok => {
    const t = setTimeout(() => { wartende = wartende.filter(f => f !== fn); ok(null); }, ms);
    const fn = b => { clearTimeout(t); ok(b); };
    wartende.push(fn);
  });
  const wunsch = () => { try { return localStorage.getItem("druckmodus") || "auto"; } catch { return "auto"; } };
  const kurz = u => { u = String(u).toLowerCase(); return /^0000....-0000-1000-8000-00805f9b34fb$/.test(u) ? u.slice(4, 8) : u; };
  const nativ = () => typeof Nativ !== "undefined" && Nativ.ist;
  const BLE = () => Nativ.plugin("BluetoothLe");

  // ---------- Verbinden ----------
  async function verbinden() {
    if (nativ()) {
      await BLE().initialize();
      const d = await BLE().requestDevice({ optionalServices: DIENSTE.map(voll) });
      geraet = { name: d.name || d.deviceId, id: d.deviceId };
      try { localStorage.setItem("drucker", JSON.stringify(geraet)); } catch {}
    } else {
      if (!navigator.bluetooth)
        throw new Error("Bluetooth geht hier nicht – Chrome auf Android und HTTPS nötig");
      geraet = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: DIENSTE });
      geraet.addEventListener("gattserverdisconnected", () => { kanal = null; });
    }
    await koppeln();
  }

  async function koppeln() {
    if (nativ()) {
      await BLE().connect({ deviceId: geraet.id }, () => { verbundenFlag = false; kanal = null; });
      const { services } = await BLE().getServices({ deviceId: geraet.id });
      let mtu = 23;
      try { mtu = (await BLE().getMtu({ deviceId: geraet.id })).value || 23; } catch {}
      const kandidaten = [];
      diag.dienste = []; diag.mtu = mtu;
      for (const s of services) for (const c of s.characteristics) {
        const pr = Object.keys(c.properties || {}).filter(k => c.properties[k]).join(",");
        diag.dienste.push(kurz(s.uuid) + " / " + kurz(c.uuid) + "  [" + pr + "]");
        if (c.properties.writeWithoutResponse || c.properties.write)
          kandidaten.push({ service: s.uuid.toLowerCase(), characteristic: c.uuid.toLowerCase(),
                            ohneAntwort: !!c.properties.writeWithoutResponse });
        // Antworten des Druckers mitlesen (FF01 o. ä.)
        if ((c.properties.notify || c.properties.indicate) && !/^0000(2a|18)/.test(c.uuid.toLowerCase())) {
          try {
            const key = `notification|${geraet.id}|${s.uuid.toLowerCase()}|${c.uuid.toLowerCase()}`;
            await BLE().addListener(key, ev => antwort(hexZuBytes(ev?.value || "")));
            await BLE().startNotifications({ deviceId: geraet.id, service: s.uuid.toLowerCase(), characteristic: c.uuid.toLowerCase() });
          } catch (e) { diag.schritte.push("Abo " + kurz(c.uuid) + " fehlgeschlagen: " + e.message); }
        }
      }
      const p22 = kandidaten.find(k => k.service === P22_DIENST && k.characteristic === P22_KANAL);
      kanal = (wunsch() !== "escpos" && p22) || kandidaten[0];
      if (kanal) {
        modus = wunsch() === "auto" ? (kanal === p22 ? "p22" : "escpos") : wunsch();
        stueck = modus === "p22" ? Math.max(20, Math.min(mtu - 3, 200)) : Math.max(20, Math.min(mtu - 3, 128));
        diag.kanal = kurz(kanal.service) + " / " + kurz(kanal.characteristic) + (kanal.ohneAntwort ? " (ohne Antwort)" : " (mit Antwort)");
        diag.stueck = stueck;
        verbundenFlag = true; return;
      }
    } else {
      const server = await geraet.gatt.connect();
      const kandidaten = [];
      for (const dienst of await server.getPrimaryServices())
        for (const c of await dienst.getCharacteristics())
          if (c.properties.writeWithoutResponse || c.properties.write) kandidaten.push(c);
      const p22 = kandidaten.find(c => c.service.uuid === P22_DIENST && c.uuid === P22_KANAL);
      kanal = (wunsch() !== "escpos" && p22) || kandidaten[0];
      if (kanal) {
        modus = wunsch() === "auto" ? (kanal === p22 ? "p22" : "escpos") : wunsch();
        stueck = modus === "p22" ? 180 : 128;
        diag.kanal = kurz(kanal.service.uuid) + " / " + kurz(kanal.uuid); diag.stueck = stueck;
        try {
          for (const c of await kanal.service.getCharacteristics())
            if (c.properties.notify) { c.addEventListener("characteristicvaluechanged",
              e => antwort(new Uint8Array(e.target.value.buffer))); await c.startNotifications(); }
        } catch {}
        return;
      }
    }
    throw new Error("Kein Druckkanal gefunden – Druckermodell nicht unterstützt");
  }

  // ---------- Olympia P22 / Nelko P21: TSPL ----------
  // Querformat-Canvas (Länge x 96) -> 90° im Uhrzeigersinn -> 96 breit, Bit 0 = schwarz
  function befehleP22(canvas) {
    const W = canvas.width, H = canvas.height;
    if (H !== 96) throw new Error("Für den P22 eine P22-Etikettengröße wählen");
    const px = canvas.getContext("2d").getImageData(0, 0, W, H).data;
    const bpr = 12, rows = W, bild = new Uint8Array(bpr * rows).fill(0xff);
    for (let y2 = 0; y2 < rows; y2++)          // Zeile nach Drehung = Spalte im Querformat
      for (let x2 = 0; x2 < 96; x2++) {
        const x = y2, y = H - 1 - x2, i = (y * W + x) * 4;
        const dunkel = (px[i] + px[i + 1] + px[i + 2]) / 3 < 128 && px[i + 3] > 128;
        if (dunkel) bild[y2 * bpr + (x2 >> 3)] &= ~(0x80 >> (x2 & 7));
      }
    const laenge = (canvas.dataset.laenge || (rows / 7.1).toFixed(1));
    const enc = s => new TextEncoder().encode(s);
    const kopf = enc("\x1b!o\r\n" +
      `SIZE 14.0 mm,${Number(laenge).toFixed(1)} mm\r\n` +
      "GAP 5.0 mm,0 mm\r\nDIRECTION 1,1\r\nDENSITY 15\r\nCLS\r\n" +
      `BITMAP 0,0,${bpr},${rows},1,`);
    const ende = enc("\r\nPRINT 1\r\n");
    const job = new Uint8Array(kopf.length + bild.length + ende.length);
    job.set(kopf); job.set(bild, kopf.length); job.set(ende, kopf.length + bild.length);
    return job;
  }

  // ---------- Eigene Suche in der App (nur Android-App) ----------
  let suchListener = null, suchTimer = null;
  async function suchen(gefunden, fertig, sekunden = 10) {
    if (!nativ()) throw new Error("nur in der App");
    await stopSuche();
    await BLE().initialize();
    suchListener = await BLE().addListener("onScanResult", r => {
      const name = r.localName || r.device?.name || "";
      gefunden({ id: r.device.deviceId, name: name || "(ohne Namen)", rssi: r.rssi ?? -100 });
    });
    await BLE().requestLEScan({ allowDuplicates: false });
    suchTimer = setTimeout(async () => { await stopSuche(); fertig && fertig(); }, sekunden * 1000);
  }
  async function stopSuche() {
    clearTimeout(suchTimer); suchTimer = null;
    try { await suchListener?.remove(); } catch {}
    suchListener = null;
    try { if (nativ()) await BLE().stopLEScan(); } catch {}
  }
  async function verbindenMit(id, name) {
    await stopSuche();
    try { if (geraet && nativ()) await BLE().disconnect({ deviceId: geraet.id }); } catch {}
    geraet = { id, name }; kanal = null; verbundenFlag = false;
    await BLE().initialize();
    await koppeln();
    try { localStorage.setItem("drucker", JSON.stringify({ id, name })); } catch {}
  }
  // zuletzt benutzten Drucker merken
  function gemerkt() {
    try { return JSON.parse(localStorage.getItem("drucker") || "null"); } catch { return null; }
  }
  if (nativ()) { const g = gemerkt(); if (g) geraet = g; }

  // ---------- Canvas -> 1-Bit-Raster -> ESC/POS ----------
  function befehle(canvas) {
    if (modus === "p22") return befehleP22(canvas);
    const w = canvas.width, h = canvas.height, bpr = w / 8;
    const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const raster = new Uint8Array(bpr * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, hell = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (hell < 128 && px[i + 3] > 128) raster[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
      }
    const kopf = [0x1b, 0x40,                                   // ESC @  Reset
                  0x1d, 0x76, 0x30, 0x00,                       // GS v 0 Rasterbild
                  bpr & 0xff, bpr >> 8, h & 0xff, h >> 8];
    const ende = [0x1b, 0x64, 0x02,                              // 2 Zeilen vorschieben
                  0x1d, 0x0c];                                   // zum nächsten Etikett (Lückenpapier)
    return new Uint8Array([...kopf, ...raster, ...ende]);
  }

  // P22: erst Bereitschaft fragen, dann Kopf, ggf. auf Freigabe (f0 00 HI LO) warten, dann Bild
  async function sendenP22(job) {
    diag.schritte = []; diag.gesendet = 0;
    const enc = s => new TextEncoder().encode(s);
    await senden(enc("\x1b!?\r\n"));
    const bereit = await warteAufAntwort(800);
    diag.schritte.push("Bereitschaft: " + (bereit ? hex(bereit) : "keine Antwort"));
    // Job aufteilen: Kopf bis einschließlich "BITMAP ...,"
    const txt = new TextDecoder("latin1").decode(job.slice(0, 200));
    const k = txt.indexOf("BITMAP"), kommaEnde = txt.indexOf(",1,", k) + 3;
    const kopf = job.slice(0, kommaEnde), rest = job.slice(kommaEnde);
    await senden(kopf);
    let frei = await warteAufAntwort(600);
    let pos = 0;
    while (pos < rest.length) {
      let menge = rest.length - pos;
      if (frei && frei[0] === 0xf0 && frei.length >= 4) {          // Drucker teilt Kontingent zu
        menge = Math.min(menge, (frei[2] << 8) | frei[3]);
        diag.schritte.push("Freigabe " + ((frei[2] << 8) | frei[3]) + " Bytes");
        await new Promise(r => setTimeout(r, 300));
      }
      await senden(rest.slice(pos, pos + menge));
      pos += menge;
      if (pos < rest.length) frei = await warteAufAntwort(3000);
    }
    const fertig = await warteAufAntwort(4000);
    diag.schritte.push("Nach dem Druck: " + (fertig ? hex(fertig) : "keine Antwort"));
  }

  async function senden(daten) {
    diag.gesendet += daten.length;
    const STUECK = stueck, pause = () => new Promise(r => setTimeout(r, modus === "p22" ? 15 : 20));
    for (let i = 0; i < daten.length; i += STUECK) {
      const teil = daten.slice(i, i + STUECK);
      if (nativ()) {
        const hex = Array.from(teil, b => b.toString(16).padStart(2, "0")).join("");
        const p = { deviceId: geraet.id, service: kanal.service, characteristic: kanal.characteristic, value: hex };
        if (kanal.ohneAntwort) { await BLE().writeWithoutResponse(p); await pause(); }
        else await BLE().write(p);
      } else if (kanal.properties.writeWithoutResponse) {
        await kanal.writeValueWithoutResponse(teil); await pause();
      } else {
        await kanal.writeValueWithResponse(teil);
      }
    }
  }

  return {
    verbinden,
    verbunden: () => nativ() ? !!(kanal && verbundenFlag) : !!(kanal && geraet?.gatt.connected),
    name: () => geraet?.name || null,
    modus: () => modus,
    diagnose: () => [
      "Drucker: " + (geraet?.name || "–") + "   Modus: " + modus,
      "Kanal: " + diag.kanal + "   MTU: " + diag.mtu + "   Stück: " + diag.stueck,
      "Gesendet: " + diag.gesendet + " Bytes",
      ...diag.schritte,
      "— Antworten des Druckers —", ...(diag.antworten.length ? diag.antworten : ["(keine)"]),
      "— Dienste / Kanäle —", ...diag.dienste,
    ].join("\n"),
    befehle,
    befehleP22,
    suchen, stopSuche, verbindenMit, kannSuchen: () => nativ(),
    async sicherVerbunden() {
      if (!geraet) return;
      if (nativ() && !kanal) await BLE().initialize();
      if (!this.verbunden()) await koppeln();
    },
    trennen() {
      try { localStorage.removeItem("drucker"); } catch {}
      try { nativ() ? BLE().disconnect({ deviceId: geraet.id }) : geraet?.gatt.disconnect(); } catch {}
      geraet = kanal = null; verbundenFlag = false;
    },
    async drucken(canvas) {
      if (!geraet) throw new Error("Erst Drucker suchen und auswählen");
      if (nativ() && !kanal) await BLE().initialize();
      if (!this.verbunden()) await koppeln();
      const job = befehle(canvas);
      if (modus === "p22") await sendenP22(job);
      else { diag.schritte = []; diag.gesendet = 0; await senden(job); const a = await warteAufAntwort(2000);
             diag.schritte.push("Antwort: " + (a ? hex(a) : "keine")); }
    },
  };
})();
