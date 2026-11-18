// Prüfprotokolle als PDF (jsPDF).
// Einzelprotokoll je Prüfung und Prüfbericht je Kunde (Übersicht + Einzelprotokolle).
// Norm je nach Prüfgrund/Datum: DIN EN 50699 (VDE 0702), DIN EN 50678 (VDE 0701),
// für Prüfungen vor dem 22.09.2023 DIN VDE 0701-0702.
const Protokoll = (() => {
  const A4 = { w: 210, h: 297 }, R = 15;          // Seite und Rand in mm
  const GRUEN = [30, 138, 76], ROT = [192, 57, 43], BLAU = [31, 58, 95], GRAU = [110, 110, 110];

  const fmtD = d => d ? d.split("-").reverse().join(".") : "–";
  const fmtM = m => m ? m.split("-").reverse().join("/") : "–";
  const zahl = v => v == null || v === "" ? null : Number(v);
  const de = v => String(v).replace(".", ",");
  function addMonate(iso, n) {
    const d = new Date(iso + "T12:00:00"), t = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(t, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d.toISOString().slice(0, 10);
  }

  function norm(p) {
    if (p.datum < "2023-09-22") return { kurz: "DIN VDE 0701-0702", lang: "DIN VDE 0701-0702:2008-06", art: p.grund === "reparatur" ? "Prüfung nach Instandsetzung" : "Wiederholungsprüfung" };
    return p.grund === "reparatur"
      ? { kurz: "DIN EN 50678 (VDE 0701)", lang: "DIN EN 50678 (VDE 0701):2021-02", art: "Prüfung nach Reparatur" }
      : { kurz: "DIN EN 50699 (VDE 0702)", lang: "DIN EN 50699 (VDE 0702):2021-06", art: "Wiederholungsprüfung" };
  }

  // Prüfschritte mit Grenzwert und Bewertung
  function schritte(g, p) {
    const sk = g.schutzklasse || "I", jaNein = (v, t) => v == null ? ["–", "nicht dokumentiert"] : v ? ["i. O.", t] : ["n. i. O.", t];
    const bew = (wert, ok) => wert == null ? "–" : ok ? "i. O." : "n. i. O.";
    const rpe = zahl(p.rpe), riso = zahl(p.riso), ipe = zahl(p.ipe), ib = zahl(p.ib);
    const isoMin = sk === "I" ? 1 : sk === "II" ? 2 : 0.25;
    const z = [];
    const s1 = jaNein(p.sichtpruefung, "");
    z.push(["Sichtprüfung", s1[0] === "–" ? "–" : "", "ohne Mangel", s1[0]]);
    if (sk === "I") z.push(["Schutzleiterwiderstand R(PE)", rpe == null ? "–" : de(rpe) + " Ohm",
      "max. 0,3 Ohm *", bew(rpe, rpe <= 0.3)]);
    else z.push(["Schutzleiterwiderstand R(PE)", "", "entfällt (SK " + sk + ")", "–"]);
    z.push(["Isolationswiderstand R(ISO)", riso == null ? "–" : de(riso) + " MOhm",
      "min. " + de(isoMin) + " MOhm", bew(riso, riso >= isoMin)]);
    if (sk === "I") z.push(["Schutzleiterstrom I(PE)", ipe == null ? "–" : de(ipe) + " mA",
      "max. 3,5 mA **", bew(ipe, ipe <= 3.5)]);
    else z.push(["Schutzleiterstrom I(PE)", "", "entfällt (SK " + sk + ")", "–"]);
    if (sk !== "III") z.push(["Berührungsstrom I(B)", ib == null ? "–" : de(ib) + " mA", "max. 0,5 mA", bew(ib, ib <= 0.5)]);
    const f = jaNein(p.funktion, "");
    z.push(["Funktionsprüfung", f[0] === "–" ? "–" : "", "ordnungsgemäß", f[0]]);
    return z;
  }

  // ---------- Bausteine ----------
  function kopf(doc, F, titel, unter) {
    doc.setFillColor(...BLAU); doc.rect(0, 0, A4.w, 26, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text(titel, R, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(unter, R, 19);
    if (F.firma) { doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(F.firma, A4.w - R, 11, { align: "right" }); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    [F.anschrift, F.kontakt].filter(Boolean).forEach((t, i) => doc.text(t, A4.w - R, 16 + i * 4, { align: "right" }));
    doc.setTextColor(0);
    return 34;
  }
  function abschnitt(doc, y, t) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...BLAU);
    doc.text(t, R, y); doc.setDrawColor(...BLAU); doc.setLineWidth(0.4); doc.line(R, y + 1.5, A4.w - R, y + 1.5);
    doc.setTextColor(0); return y + 7;
  }
  // Raster aus Feldern [Bezeichnung, Wert] in 2 Spalten
  function felder(doc, y, liste) {
    const sp = (A4.w - 2 * R) / 2;
    doc.setFontSize(9);
    for (let i = 0; i < liste.length; i += 2) {
      for (let k = 0; k < 2 && i + k < liste.length; k++) {
        const [l, w] = liste[i + k], x = R + k * sp;
        doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAU); doc.text(l, x, y);
        doc.setFont("helvetica", "bold"); doc.setTextColor(0);
        doc.text(doc.splitTextToSize(String(w || "–"), sp - 34)[0], x + 32, y);
      }
      y += 5.5;
    }
    return y + 1;
  }
  function tabelle(doc, y, kopfzeile, zeilen, breiten, farbeLetzte) {
    const x0 = R; let x;
    doc.setFillColor(235, 239, 245); doc.rect(x0, y - 4.2, A4.w - 2 * R, 6.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.8);
    x = x0 + 2; kopfzeile.forEach((t, i) => { doc.text(t, x, y); x += breiten[i]; });
    y += 6.5; doc.setFont("helvetica", "normal");
    for (const z of zeilen) {
      if (y > A4.h - 25) { doc.addPage(); y = 20; }
      x = x0 + 2;
      z.forEach((t, i) => {
        const letzte = i === z.length - 1;
        if (letzte && farbeLetzte) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(...(/n\. i\. O\.|nicht|überfällig/i.test(t) ? ROT : /i\. O\.|bestanden/i.test(t) ? GRUEN : [0, 0, 0]));
        }
        doc.text(doc.splitTextToSize(String(t ?? ""), breiten[i] - 2)[0] || "", x, y);
        doc.setTextColor(0); doc.setFont("helvetica", "normal"); x += breiten[i];
      });
      doc.setDrawColor(220); doc.setLineWidth(0.2); doc.line(x0, y + 2, A4.w - R, y + 2);
      y += 6.3;
    }
    return y + 2;
  }
  function fuss(doc) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...GRAU);
      doc.text("Erstellt mit VDE-Prüfung · " + new Date().toLocaleDateString("de-DE"), R, A4.h - 8);
      doc.text("Seite " + i + " von " + n, A4.w - R, A4.h - 8, { align: "right" });
      doc.setTextColor(0);
    }
  }

  // ---------- Eine Seite: Protokoll einer Prüfung ----------
  function seite(doc, g, p) {
    const F = Speicher.Register.firma(), N = norm(p);
    let y = kopf(doc, F, "Prüfprotokoll", "Prüfung elektrischer Geräte nach " + N.lang);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text("Protokoll-Nr.: " + g.nr + "-" + p.datum.replace(/-/g, ""), R, y);
    doc.text("Prüfdatum: " + fmtD(p.datum) + "   ·   Prüfart: " + N.art, A4.w - R, y, { align: "right" });
    y += 8;

    y = abschnitt(doc, y, "Auftraggeber");
    y = felder(doc, y, [["Kunde", g.kunde], ["Standort", g.standort]]);

    y = abschnitt(doc, y, "Prüfling");
    y = felder(doc, y, [["Inventar-Nr.", g.nr], ["Bezeichnung", g.bezeichnung], ["Hersteller", g.hersteller],
      ["Typ", g.typ], ["Seriennummer", g.seriennr], ["Nenndaten", g.nenndaten],
      ["Schutzklasse", "SK " + (g.schutzklasse || "I")], ["Prüfintervall", (g.intervall_monate || 12) + " Monate"]]);

    y = abschnitt(doc, y, "Messgerät");
    const mg = p.messgeraet;
    y = felder(doc, y, mg ? [["Hersteller / Typ", mg.hersteller + " " + mg.typ], ["Seriennummer", mg.seriennr],
      ["Kalibriert bis", fmtM(mg.kalibriert_bis)], ["Messverfahren", p.verfahren ? p.verfahren + "verfahren" : "–"]]
      : [["Messgerät", "nicht angegeben"], ["Messverfahren", p.verfahren ? p.verfahren + "verfahren" : "–"]]);

    y = abschnitt(doc, y, "Prüfungen und Messungen");
    y = tabelle(doc, y, ["Prüfschritt", "Messwert", "Grenzwert", "Ergebnis"], schritte(g, p), [62, 36, 52, 30], true);
    doc.setFontSize(7.2); doc.setTextColor(...GRAU);
    if ((g.schutzklasse || "I") === "I") {
      doc.text("* bis 5 m Leitungslänge; je weitere 7,5 m + 0,1 Ohm, höchstens 1 Ohm.", R, y);
      doc.text("** Geräte mit Heizelementen > 3,5 kW: 1 mA je kW, höchstens 10 mA.", R, y + 3.5); y += 7;
    }
    doc.setTextColor(0);

    if (p.bemerkung) {
      y = abschnitt(doc, y + 2, "Bemerkung");
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); const t = doc.splitTextToSize(p.bemerkung, A4.w - 2 * R);
      doc.text(t, R, y); y += t.length * 4.5 + 2;
    }

    // Gesamtergebnis
    y += 2;
    const ok = !!p.bestanden, naechste = addMonate(p.datum, parseInt(g.intervall_monate) || 12);
    doc.setFillColor(...(ok ? GRUEN : ROT)); doc.roundedRect(R, y, A4.w - 2 * R, 17, 2, 2, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(ok ? "Prüfung BESTANDEN" : "Prüfung NICHT BESTANDEN", R + 5, y + 7.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(ok ? "Das Gerät entspricht den Anforderungen. Nächste Prüfung: " + fmtM(naechste.slice(0, 7))
                : "Das Gerät darf bis zur Instandsetzung und erneuten Prüfung nicht verwendet werden.", R + 5, y + 13);
    doc.setTextColor(0); y += 24;
    if (p.nachgetragen) {
      doc.setFontSize(8); doc.setTextColor(...GRAU);
      doc.text("Nachgetragen aus einem vorhandenen Prüfprotokoll vom " + fmtD(p.datum) + ".", R, y); doc.setTextColor(0); y += 6;
    }

    // Unterschrift
    y = Math.max(y + 4, A4.h - 58);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text("Ort, Datum", R, y + 22); doc.line(R, y + 18, R + 70, y + 18);
    doc.text(fmtD(p.datum), R, y + 15);
    const xU = A4.w - R - 80;
    if (F.unterschrift && (p.pruefer || "") === (Speicher.Register.pruefer() || p.pruefer)) {
      try { doc.addImage(F.unterschrift, "PNG", xU, y - 2, 60, 20); } catch {}
    }
    doc.line(xU, y + 18, A4.w - R, y + 18);
    doc.text("Prüfer: " + (p.pruefer || "–"), xU, y + 22);
    doc.setFontSize(7.5); doc.setTextColor(...GRAU);
    doc.text(doc.splitTextToSize(F.quali || "Elektrofachkraft", 80), xU, y + 26); doc.setTextColor(0);
  }

  function datei(doc, name) {
    return new File([doc.output("blob")], name.replace(/[^\wäöüÄÖÜß.-]+/g, "_"), { type: "application/pdf" });
  }
  const neuesDoc = () => new window.jspdf.jsPDF({ unit: "mm", format: "a4" });

  // ---------- öffentlich ----------
  async function einzeln(g, p) {
    const doc = neuesDoc(); seite(doc, g, p); fuss(doc);
    return datei(doc, "Pruefprotokoll_" + g.nr + "_" + p.datum + ".pdf");
  }

  async function bericht(geraete, kunde) {
    const doc = neuesDoc(), F = Speicher.Register.firma();
    geraete.sort((a, b) => (a.standort || "").localeCompare(b.standort || "", "de") || a.nr.localeCompare(b.nr));
    const zaehl = { ok: 0, nicht: 0, faellig: 0, neu: 0 };
    geraete.forEach(g => g.status === "neu" ? zaehl.neu++ : g.status === "gesperrt" ? zaehl.nicht++ : g.status === "faellig" ? zaehl.faellig++ : zaehl.ok++);

    let y = kopf(doc, F, "Prüfbericht", "Prüfung elektrischer Geräte · DIN EN 50699 (VDE 0702) / DIN EN 50678 (VDE 0701)");
    y = abschnitt(doc, y, "Übersicht");
    y = felder(doc, y, [["Kunde", kunde || "alle Kunden"], ["Erstellt am", new Date().toLocaleDateString("de-DE")],
      ["Geräte gesamt", String(geraete.length)], ["Prüfer", Speicher.Register.pruefer() || "–"],
      ["in Ordnung", String(zaehl.ok)], ["nicht bestanden", String(zaehl.nicht)],
      ["Prüfung überfällig", String(zaehl.faellig)], ["noch ungeprüft", String(zaehl.neu)]]);
    y = abschnitt(doc, y + 2, "Geräteliste");
    const ST = { ok: "bestanden", bald: "bestanden", faellig: "überfällig", gesperrt: "nicht bestanden", neu: "ungeprüft" };
    y = tabelle(doc, y, ["Inv.-Nr.", "Bezeichnung", "Standort", "Geprüft", "Nächste", "Ergebnis"],
      geraete.map(g => [g.nr, g.bezeichnung, g.standort || "", fmtD(g.letzte_pruefung),
        g.status === "gesperrt" ? "gesperrt" : g.naechste_pruefung ? fmtM(g.naechste_pruefung.slice(0, 7)) : "–", ST[g.status]]),
      [24, 50, 34, 22, 20, 30], true);
    doc.setFontSize(8); doc.setTextColor(...GRAU);
    doc.text("Auf den folgenden Seiten: Prüfprotokoll der jeweils letzten Prüfung je Gerät.", R, y + 2);
    doc.setTextColor(0);

    for (const g of geraete) {
      const p = (g.pruefungen || [])[0];         // neueste zuerst
      if (!p) continue;
      doc.addPage(); seite(doc, g, p);
    }
    fuss(doc);
    return datei(doc, "Pruefbericht_" + (kunde || "alle") + "_" + new Date().toISOString().slice(0, 10) + ".pdf");
  }

  return { einzeln, bericht };
})();
