'use strict';

// Gedeeld door pool/cover/light device.js en write-guard.js: bij een kapotte
// credential (401, of pool's 403 zonder enige leesscope) wordt het device al
// bij elke mislukte poll opnieuw onbeschikbaar gezet — dat gebeurt elke paar
// minuten zolang de credential kapot blijft. Zonder deze vlag zou de gebruiker
// dus net zo vaak een pushmelding krijgen.
//
// De vlag zit in de device-store (niet in een instance-property): de app
// herstart wel eens (update, Homey-reboot), en dan zou een instance-property
// stilletjes terugvallen op "nog niet gemeld", met een nieuwe melding voor
// dezelfde lopende uitval tot gevolg. resetNotified() zet hem weer open zodra
// de gebruiker via Repair een nieuwe credential invoert, of zodra een poll
// weer lukt na eerder onbeschikbaar te zijn geweest (zie onPoolData in de
// drie device.js-bestanden).
//
// getStoreValue() is in de Homey Apps SDK synchroon (zie ook getStoreValue-
// gebruik in drivers/cover/driver.js en drivers/light/driver.js) — alleen
// setStoreValue() persisteert async en geeft een Promise terug.
const STORE_KEY = 'authNotified';

async function notifyOnce(device, excerpt) {
  if (device.getStoreValue(STORE_KEY)) return;
  // Schrijfactie en gedeelde poller kunnen zo goed als tegelijk op dezelfde
  // afgewezen credential stuiten, en de store-vlag wordt pas ná de (async)
  // createNotification-aanroep gezet. Zonder deze in-memory grendel zouden
  // beide de bovenstaande sync-check nog "niet gemeld" zien en dus allebei
  // een melding sturen. De grendel bestaat alleen tijdens deze aanroep en
  // hoeft dus niet te overleven (in tegenstelling tot de store-vlag hierboven).
  if (device._notifyInFlight) return;
  device._notifyInFlight = true;
  try {
    await device.homey.notifications.createNotification({ excerpt });
  } catch (err) {
    // Niet gelukt: laat de vlag ongezet zodat de eerstvolgende mislukte poll
    // het opnieuw probeert, in plaats van deze uitval permanent stil te
    // houden.
    device.error(`Failed to create notification: ${err.message}`);
    return;
  } finally {
    device._notifyInFlight = false;
  }
  await device.setStoreValue(STORE_KEY, true).catch((err) => device.error(`Failed to persist notification state: ${err.message}`));
}

async function resetNotified(device) {
  await device.setStoreValue(STORE_KEY, false).catch((err) => device.error(`Failed to reset notification state: ${err.message}`));
}

module.exports = { notifyOnce, resetNotified };
