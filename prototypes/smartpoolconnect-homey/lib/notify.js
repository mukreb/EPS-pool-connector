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

// Zonder geslaagde poll in dit tijdvenster gaat het device alsnog onbeschikbaar
// en volgt er een melding, ook als de fout zelf niet als credential-probleem
// herkend wordt. Ruim boven een normale haper van de cloud of de wifi, maar
// kort genoeg om een stille storing dezelfde dag nog op te merken.
const STALE_AFTER_MS = 60 * 60 * 1000;

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
  // Flow-trigger los van de tijdlijnmelding: die laatste komt alleen als
  // pushbericht op de telefoon als de gebruiker dat per app heeft aangezet,
  // een flow kan zelf kiezen (push, e-mail, spraak). De app ontdubbelt per
  // zwembad, zodat een uitval op drie devices één keer triggert.
  try {
    await device.homey.app?.reportConnectionLost?.(device.pid, device.getName?.(), excerpt);
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
  // Altijd doorgeven, niet alleen als STORE_KEY gezet is: de app-vlag voor de
  // flow kan gezet zijn terwijl de tijdlijnmelding mislukte (en STORE_KEY dus
  // open bleef). De app ontdubbelt zelf per zwembad.
  await device.homey.app?.reportConnectionRestored?.(device.pid, device.getName?.());
  await device.setStoreValue(STORE_KEY, false).catch((err) => device.error(`Failed to reset notification state: ${err.message}`));
}

// Vangnet voor poll-fouten die geen herkende credential- of scopefout zijn:
// pas na STALE_AFTER_MS zonder één geslaagde ronde onbeschikbaar + melding.
// Geeft true terug als het device als storing gemeld is.
async function reportIfStale(device, poller, err) {
  if (poller.msSinceLastSuccess() < STALE_AFTER_MS) return false;
  const message = device.homey.__('errors.no_data', { error: err.message });
  await device.setUnavailable(message).catch(device.error);
  await notifyOnce(device, `${device.getName()}: ${device.homey.__('notifications.no_data')}`);
  return true;
}

module.exports = { notifyOnce, resetNotified, reportIfStale, STALE_AFTER_MS };
