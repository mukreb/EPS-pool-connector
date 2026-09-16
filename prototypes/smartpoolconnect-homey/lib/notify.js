'use strict';

// Gedeeld door pool/cover/light device.js en write-guard.js: bij een kapotte
// credential (401, of pool's 403 zonder enige leesscope) wordt het device al
// bij elke mislukte poll opnieuw onbeschikbaar gezet — dat gebeurt elke paar
// minuten zolang de credential kapot blijft. Zonder deze vlag zou de gebruiker
// dus net zo vaak een pushmelding krijgen. `device._authNotified` zorgt voor
// één melding per uitval; resetNotified() zet hem weer open zodra de
// gebruiker via Repair een nieuwe credential invoert (setNewCredential).
async function notifyOnce(device, excerpt) {
  if (device._authNotified) return;
  device._authNotified = true;
  try {
    await device.homey.notifications.createNotification({ excerpt });
  } catch (err) {
    device.error(`Failed to create notification: ${err.message}`);
  }
}

function resetNotified(device) {
  device._authNotified = false;
}

module.exports = { notifyOnce, resetNotified };
