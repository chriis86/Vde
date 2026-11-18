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
    let mt = pfad.match(/^geraete\/(.+)\/pruefungen$/);
    if (mt) {
      const nr = decodeURIComponent(mt[1]), g = await hole(nr);
      if (!g || g.geloescht) throw new Error("Gerät erst anlegen");
      const zahl = v => v === "" || v == null ? null : parseFloat(String(v).replace(",", "."));
      g.pruefungen = g.pruefungen || [];
      g.pruefungen.push({ uid: uid(), datum: body.datum || jetzt().slice(0, 10), pruefer: body.pruefer || "",
        sichtpruefung: body.sichtpruefung ? 1 : 0, funktion: body.funktion ? 1 : 0,
        rpe: zahl(body.rpe), riso: zahl(body.riso), ipe: zahl(body.ipe), ib: zahl(body.ib),
        bestanden: body.bestanden ? 1 : 0, bemerkung: body.bemerkung || "" });
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

  // ---- Export ----
  async function csv() {
    const ja = v => v == null ? "" : v ? "ja" : "nein";
    const zeilen = [["Nr", "Bezeichnung", "Hersteller", "Typ", "Seriennr", "Standort", "Kunde", "SK", "Datum",
      "Prüfer", "Sicht", "RPE Ω", "RISO MΩ", "IPE mA", "IB mA", "Funktion", "Bestanden", "Bemerkung"]];
    for (const g of (await alle()).filter(g => !g.geloescht).sort((a, b) => a.nr.localeCompare(b.nr)))
      for (const p of mitStatus(g).pruefungen.reverse())
        zeilen.push([g.nr, g.bezeichnung, g.hersteller, g.typ, g.seriennr, g.standort, g.kunde, g.schutzklasse,
          p.datum, p.pruefer, ja(p.sichtpruefung), p.rpe, p.riso, p.ipe, p.ib, ja(p.funktion), ja(p.bestanden), p.bemerkung]);
    const text = "﻿" + zeilen.map(z => z.map(v => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\r\n");
    return new File([text], "vde_pruefungen_" + jetzt().slice(0, 10) + ".csv", { type: "text/csv" });
  }
  async function sicherung() {
    const daten = JSON.stringify({ version: 1, erstellt: jetzt(), geraete: await alle() }, null, 1);
    return new File([daten], "vde_sicherung_" + jetzt().slice(0, 10) + ".json", { type: "application/json" });
  }
  async function wiederherstellen(file) {
    const { geraete } = JSON.parse(await file.text());
    for (const g of geraete) await lege(g);
    return geraete.length;
  }

  return { api, einst, csv, sicherung, wiederherstellen, art: async () => (await oeffneDB(), ersatz ? "Ersatzspeicher" : "IndexedDB") };
})();
const api = Speicher.api;
