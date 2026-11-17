// Brücke zur echten Android-App (Capacitor). Im Browser bleibt alles wie gehabt.
const Nativ = (() => {
  const ist = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const cache = {};
  const plugin = name => cache[name] ??=
    (window.capacitorExports ? capacitorExports.registerPlugin(name) : Capacitor.Plugins[name]);

  // Datei (CSV, Sicherung, Etikett) über das Android-Teilen-Menü weitergeben
  async function teilen(file) {
    const b64 = await new Promise((ok, fehler) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(",")[1]);
      fr.onerror = fehler; fr.readAsDataURL(file);
    });
    const { uri } = await plugin("Filesystem").writeFile({ path: file.name, data: b64, directory: "CACHE" });
    try { await plugin("Share").share({ title: file.name, files: [uri] }); } catch {}   // Abbrechen ist ok
  }

  // Zurück-Taste: erst zur Liste, dann App schließen
  function zurueckTaste(handler) {
    if (ist) plugin("App").addListener("backButton", handler);
  }
  return { ist, plugin, teilen, zurueckTaste, beenden: () => plugin("App").exitApp() };
})();
