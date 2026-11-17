// Bluetooth-Etikettendruck über Web Bluetooth (Chrome auf Android, HTTPS nötig).
// Sendet das Etikett als Rasterbild im ESC/POS-Format (GS v 0) – das verstehen viele
// günstige Thermo-Etikettendrucker (Phomemo-Familie u. ä.). Für Drucker mit eigenem
// Protokoll muss nur die Funktion `befehle()` angepasst werden.
const Drucker = (() => {
  // Bekannte BLE-Dienste günstiger Thermodrucker
  const DIENSTE = [
    0xff00, 0x18f0, 0xae30, 0xfee7, 0xae3a, 0xe0ff, 0xffe0,
    "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    "000018f0-0000-1000-8000-00805f9b34fb",
  ];
  let geraet = null, kanal = null;

  async function verbinden() {
    if (!navigator.bluetooth)
      throw new Error("Bluetooth geht hier nicht – Chrome auf Android und HTTPS nötig");
    geraet = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: DIENSTE });
    geraet.addEventListener("gattserverdisconnected", () => { kanal = null; });
    await koppeln();
  }

  async function koppeln() {
    const server = await geraet.gatt.connect();
    for (const dienst of await server.getPrimaryServices()) {
      for (const c of await dienst.getCharacteristics()) {
        if (c.properties.writeWithoutResponse || c.properties.write) { kanal = c; return; }
      }
    }
    throw new Error("Kein Druckkanal gefunden – Druckermodell nicht unterstützt");
  }

  // Canvas -> 1-Bit-Raster -> ESC/POS
  function befehle(canvas) {
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

  async function senden(daten) {
    const STUECK = 128;
    for (let i = 0; i < daten.length; i += STUECK) {
      const teil = daten.slice(i, i + STUECK);
      if (kanal.properties.writeWithoutResponse) {
        await kanal.writeValueWithoutResponse(teil);
        await new Promise(r => setTimeout(r, 20));              // Drucker nicht überfluten
      } else {
        await kanal.writeValueWithResponse(teil);
      }
    }
  }

  return {
    verbinden,
    verbunden: () => !!(kanal && geraet?.gatt.connected),
    name: () => geraet?.name || null,
    trennen() { try { geraet?.gatt.disconnect(); } catch {} geraet = kanal = null; },
    async drucken(canvas) {
      if (!kanal) {
        if (!geraet) throw new Error("Erst Drucker hinzufügen");
        await koppeln();
      }
      await senden(befehle(canvas));
    },
  };
})();
