# VDE-Prüfung – App fürs Android-Handy

Alles läuft in der App: Geräte, Prüfungen, QR-Etiketten, Bluetooth-Druck.
Die Daten liegen nur auf dem Handy (kein Server). Sicherung/Export über ☰.

## Einmalig: App aufs Handy bringen (kostenlos, ~10 Min.)
Die Dateien müssen einmal über https erreichbar sein, damit Chrome die App installiert.
Danach läuft sie offline. Einfachster Weg: GitHub Pages.

1. Konto auf github.com anlegen → „New repository" → Name z. B. `vde-app`, Public → Create
2. „uploading an existing file" → ALLE Dateien aus diesem Ordner hochladen → Commit
3. Settings → Pages → Branch: `main` / Ordner `/ (root)` → Save
4. Nach 1–2 Min. am Handy in Chrome öffnen: https://DEINNAME.github.io/vde-app/
5. Chrome-Menü ⋮ → „App installieren" bzw. „Zum Startbildschirm hinzufügen"

Fertig – Icon „VDE-Prüfung" auf dem Startbildschirm, startet im Vollbild, auch ohne Internet.

## Wichtig
- Daten liegen nur in der App auf diesem Handy. App deinstallieren oder Chrome-Daten
  löschen = Daten weg → regelmäßig ☰ → „Sicherung erstellen" (z. B. nach Google Drive).
- Bluetooth-Druck: Etikett → „Drucker per Bluetooth hinzufügen".
  Druckbefehle (ESC/POS) in drucker.js → befehle() – ggf. ans Druckermodell anpassen.
- Updates: geänderte Dateien wieder bei GitHub hochladen, in sw.js VERSION hochzählen.

## Echte Android-App (APK)
GitHub baut die APK automatisch bei jedem Hochladen (Datei .github/workflows/apk.yml).
Download: https://github.com/chriis86/Vde-app/releases/latest → VDE-Pruefung.apk
debug.keystore nicht löschen – sonst lassen sich Updates nicht über die alte App installieren.
