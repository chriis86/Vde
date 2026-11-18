// Lokaler Speicher (IndexedDB) – die App läuft komplett offline auf dem Handy.
// `api()` stellt alle Datenfunktionen bereit – kein Server nötig.
const Speicher = (() => {
  // Hauptspeicher IndexedDB; klappt das nicht (z. B. in manchen WebViews), Ersatz: localStorage
  let dbp = null, ersatz = false;
  const oeffneDB = () => dbp ??= new Promise((ok, fehler) => {
    if (!window.indexedDB) return fehler(new Error("kein IndexedDB"));
    const timer = setTimeout(() => fehler(new Error("IndexedDB antwortet nicht")), 3000);
    const r = indexedDB.open("vde-pruefung", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("geraete", { keyPath: "nr" });
    r.onsuccess = () => { clearTimeout(timer); ok(r.result); };
    r.onerror = () => { clearTimeout(timer); fehler(r.error); };
    r.onblocked = () => { clearTimeout(timer); fehler(new Error("IndexedDB blockiert")); };
  }).catch(e => { console.warn("Ersatzspeicher:", e); ersatz = true; return null; });

  const LS = "vde_geraete";
  const lsLesen = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } };
  const lsSchreiben = o => localStorage.setItem(LS, JSON.stringify(o));

  const req = r => new Promise((ok, f) => { r.onsuccess = () => ok(r.result); r.onerror = () => f(r.error); });
  async function store(modus) {
    const db = await oeffneDB();
    return db ? db.transaction("geraete", modus).objectStore("geraete") : null;
  }
  async function alle() {
    const s = await store("readonly");
    return s ? req(s.getAll()) : Object.values(lsLesen());
  }
  async function hole(nr) {
    const s = await store("readonly");
    return s ? req(s.get(nr)) : lsLesen()[nr];
  }
  async function lege(g) {
    const s = await store("readwrite");
    if (s) return req(s.put(g));
    const o = lsLesen(); o[g.nr] = g; lsSchreiben(o);
  }
  async function weg(nr) {
    const s = await store("readwrite");
    if (s) return req(s.delete(nr));
    const o = lsLesen(); delete o[nr]; lsSchreiben(o);
  }

  // Wenn der Browser es erlaubt: Daten vor automatischem Löschen schützen
  navigator.storage?.persist?.();

  function addMonate(iso, n) {
    const d = new Date(iso + "T12:00:00"), tag = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(tag, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d.toISOString().slice(0, 10);
  }
  function mitStatus(g) {
    const p = [...(g.pruefungen || [])].filter(x => !x.geloescht)
      .sort((a, b) => (b.datum + b.uid).localeCompare(a.datum + a.uid));
    const last = p[0];
    const d = { ...g, pruefungen: p, letzte_pruefung: last?.datum || null, letztes_ergebnis: last ? !!last.bestanden : null };
    if (last) {
      d.naechste_pruefung = addMonate(last.datum, parseInt(g.intervall_monate) || 12);
      const tage = (new Date(d.naechste_pruefung) - new Date(new Date().toISOString().slice(0, 10))) / 864e5;
      d.status = !last.bestanden ? "gesperrt" : tage < 0 ? "faellig" : tage <= 30 ? "bald" : "ok";
    } else { d.naechste_pruefung = null; d.status = "neu"; }
    return d;
  }
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const jetzt = () => new Date().toISOString();

  // ---- lokale "API" ----
  async function api(url, opt = {}) {
    const m = (opt.method || "GET").toUpperCase(), body = opt.body ? JSON.parse(opt.body) : null;
    const pfad = url.replace(/^\/api\//, "");
    if (pfad === "naechste-nr") {
      const praefix = einst("praefix") || "VDE-";
      let max = 0;
      for (const g of await alle()) if (g.nr.startsWith(praefix)) {
        const r = g.nr.slice(praefix.length); if (/^\d+$/.test(r)) max = Math.max(max, +r);
      }
      return { status: 200, data: { nr: praefix + String(max + 1).padStart(5, "0") } };
    }
    if (pfad === "geraete") {
      return { status: 200, data: (await alle()).filter(g => !g.geloescht).map(mitStatus) };
    }
    // einzelne Prüfung löschen: geraete/<nr>/pruefungen/<uid>
    let mt = pfad.match(/^geraete\/(.+)\/pruefungen\/([^/]+)$/);
    if (mt && m === "DELETE") {
      const g = await hole(decodeURIComponent(mt[1]));
      if (g) { g.pruefungen = (g.pruefungen || []).filter(p => p.uid !== decodeURIComponent(mt[2])); g.geaendert = jetzt(); await lege(g); }
      return { status: 200, data: g ? mitStatus(g) : {} };
    }
    mt = pfad.match(/^geraete\/(.+)\/pruefungen$/);
    if (mt) {
      const nr = decodeURIComponent(mt[1]), g = await hole(nr);
      if (!g || g.geloescht) throw new Error("Gerät erst anlegen");
      const zahl = v => v === "" || v == null ? null : parseFloat(String(v).replace(",", "."));
      g.pruefungen = g.pruefungen || [];
      g.pruefungen.push({ uid: uid(), datum: body.datum || jetzt().slice(0, 10), pruefer: body.pruefer || "",
        sichtpruefung: body.sichtpruefung == null ? null : body.sichtpruefung ? 1 : 0,
        funktion: body.funktion == null ? null : body.funktion ? 1 : 0,
        rpe: zahl(body.rpe), riso: zahl(body.riso), ipe: zahl(body.ipe), ib: zahl(body.ib),
        bestanden: body.bestanden ? 1 : 0, bemerkung: body.bemerkung || "",
        nachgetragen: body.nachgetragen ? 1 : 0, foto: body.foto || null,
        grund: body.grund || "wiederholung", verfahren: body.verfahren || "",
        messgeraet: body.messgeraet || null });
      g.geaendert = jetzt();
      await lege(g); return { status: 200, data: mitStatus(g) };
    }
    mt = pfad.match(/^geraete\/(.+)$/);
    if (mt) {
      const nr = decodeURIComponent(mt[1]);
      let g = await hole(nr);
      if (m === "GET") return g && !g.geloescht ? { status: 200, data: mitStatus(g) } : { status: 404, data: {} };
      if (m === "DELETE") {
        if (g) { g.geloescht = true; g.geaendert = jetzt(); await lege(g); }
        return { status: 200, data: { ok: true } };
      }
      if (m === "PUT") {
        if (!body.bezeichnung) throw new Error("Bezeichnung fehlt");
        g = { pruefungen: [], angelegt: jetzt(), ...(g || {}), ...body, nr, geaendert: jetzt() };
        await lege(g); return { status: 200, data: mitStatus(g) };
      }
    }
    throw new Error("Unbekannte Aktion");
  }

  // ---- Einstellungen ----
  function einst(k, v) {
    try { if (v === undefined) return localStorage.getItem("e_" + k) || ""; localStorage.setItem("e_" + k, v); }
    catch { return ""; }
  }

  // ---- Register: Kunden mit Standorten, aktueller Einsatz, Prüfer ----
  const REG = "vde_register";
  function reg() {
    try { const r = JSON.parse(localStorage.getItem(REG) || "{}"); r.kunden ??= {}; return r; }
    catch { return { kunden: {} }; }
  }
  const regSpeichern = r => localStorage.setItem(REG, JSON.stringify(r));
  const Register = {
    kunden: () => Object.keys(reg().kunden).sort((a, b) => a.localeCompare(b, "de")),
    standorte: k => [...((reg().kunden[k] || {}).standorte || [])].sort((a, b) => a.localeCompare(b, "de")),
    kundeHinzu(k) { k = (k || "").trim(); if (!k) return; const r = reg(); r.kunden[k] ??= { standorte: [] }; regSpeichern(r); },
    standortHinzu(k, o) {
      k = (k || "").trim(); o = (o || "").trim(); if (!k || !o) return;
      const r = reg(); r.kunden[k] ??= { standorte: [] };
      if (!r.kunden[k].standorte.includes(o)) r.kunden[k].standorte.push(o);
      regSpeichern(r);
    },
    kundeLoeschen(k) { const r = reg(); delete r.kunden[k]; regSpeichern(r); if (Register.einsatz().kunde === k) Register.setzeEinsatz("", ""); },
    standortLoeschen(k, o) { const r = reg(); if (r.kunden[k]) r.kunden[k].standorte = r.kunden[k].standorte.filter(x => x !== o); regSpeichern(r); },
    merke(k, o) { if (k) { Register.kundeHinzu(k); if (o) Register.standortHinzu(k, o); } },
    einsatz: () => reg().einsatz || { kunde: "", standort: "" },
    setzeEinsatz(k, o) { const r = reg(); r.einsatz = { kunde: k || "", standort: o || "" }; regSpeichern(r); },
    pruefer: () => reg().pruefer || einst("pruefer_alt") || "",
    setzePruefer(n) { const r = reg(); r.pruefer = (n || "").trim(); regSpeichern(r); },
    // Firma / Prüfer-Angaben fürs Protokoll
    firma: () => reg().firma || {},
    setzeFirma(f) { const r = reg(); r.firma = { ...(r.firma || {}), ...f }; regSpeichern(r); },
    // Messgeräte
    messgeraete: () => reg().messgeraete || [],
    standardMG: () => reg().standardMG || (reg().messgeraete || [])[0]?.id || "",
    messgeraetHinzu(mg) {
      const r = reg(); r.messgeraete ??= [];
      mg.id = Date.now().toString(36); r.messgeraete.push(mg);
      if (!r.standardMG) r.standardMG = mg.id;
      regSpeichern(r); return mg.id;
    },
    messgeraetLoeschen(id) {
      const r = reg(); r.messgeraete = (r.messgeraete || []).filter(m => m.id !== id);
      if (r.standardMG === id) r.standardMG = r.messgeraete[0]?.id || ""; regSpeichern(r);
    },
    setzeStandardMG(id) { const r = reg(); r.standardMG = id; regSpeichern(r); },
    alles: () => reg(),
    einspielen(neu) {                                   // zusammenführen, nichts überschreiben
      if (!neu || !neu.kunden) return;
      const r = reg();
      for (const [k, v] of Object.entries(neu.kunden)) {
        r.kunden[k] ??= { standorte: [] };
        for (const o of v.standorte || []) if (!r.kunden[k].standorte.includes(o)) r.kunden[k].standorte.push(o);
      }
      if (!r.pruefer && neu.pruefer) r.pruefer = neu.pruefer;
      if (!r.firma && neu.firma) r.firma = neu.firma;
      for (const m of neu.messgeraete || [])
        if (!(r.messgeraete ||= []).some(x => x.id === m.id)) r.messgeraete.push(m);
      if (!r.standardMG && neu.standardMG) r.standardMG = neu.standardMG;
      regSpeichern(r);
    },
  };

  // ---- Export ----
  async function csv(nurKunde) {
    const ja = v => v == null ? "" : v ? "ja" : "nein";
    const zeilen = [["Nr", "Bezeichnung", "Hersteller", "Typ", "Seriennr", "Standort", "Kunde", "SK", "Datum",
      "Prüfer", "Sicht", "RPE Ω", "RISO MΩ", "IPE mA", "IB mA", "Funktion", "Bestanden", "Bemerkung", "Nachgetragen"]];
    for (const g of (await alle()).filter(g => !g.geloescht && (!nurKunde || g.kunde === nurKunde))
                                  .sort((a, b) => a.nr.localeCompare(b.nr)))
      for (const p of mitStatus(g).pruefungen.reverse())
        zeilen.push([g.nr, g.bezeichnung, g.hersteller, g.typ, g.seriennr, g.standort, g.kunde, g.schutzklasse,
          p.datum, p.pruefer, ja(p.sichtpruefung), p.rpe, p.riso, p.ipe, p.ib, ja(p.funktion), ja(p.bestanden), p.bemerkung, p.nachgetragen ? "ja" : ""]);
    const text = "﻿" + zeilen.map(z => z.map(v => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\r\n");
    const teil = nurKunde ? "_" + nurKunde.replace(/[^\wäöüÄÖÜß-]+/g, "_") : "";
    return new File([text], "vde_pruefungen" + teil + "_" + jetzt().slice(0, 10) + ".csv", { type: "text/csv" });
  }
  async function sicherung() {
    const daten = JSON.stringify({ version: 2, erstellt: jetzt(), geraete: await alle(), register: Register.alles() }, null, 1);
    return new File([daten], "vde_sicherung_" + jetzt().slice(0, 10) + ".json", { type: "application/json" });
  }
  async function wiederherstellen(file) {
    const { geraete, register } = JSON.parse(await file.text());
    for (const g of geraete) { await lege(g); Register.merke(g.kunde, g.standort); }
    Register.einspielen(register);
    return geraete.length;
  }

  return { api, einst, Register, csv, sicherung, wiederherstellen, art: async () => (await oeffneDB(), ersatz ? "Ersatzspeicher" : "IndexedDB") };
})();
const api = Speicher.api;
