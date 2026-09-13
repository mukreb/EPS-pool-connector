'use strict';

// Codes en afgeleide waarden op één plek, met de meting erbij die ze rechtvaardigt.
// Zie docs/homey-app-voorstel.md §10.4 voor de onderbouwing.

// Gemeten op 13-09-2026 door de afdekking volledig te laten bewegen. Niet
// gedocumenteerd door de API.
const COVER_STATES = new Map([
  [1, 'open'],
  [2, 'closed'],
  [3, 'opening'],
  [4, 'closing'],
  [5, 'stopped'],
]);

function mapCoverStatus(raw) {
  return COVER_STATES.get(raw) || 'unknown';
}

// filter.status.pump_status, zie de tabel in §2.3 van het voorstel.
const PUMP_STATUS_LABELS = new Map([
  [-1, 'off_disabled'],
  [0, 'off'],
  [1, 'schedule_1'],
  [2, 'schedule_2'],
  [3, 'schedule_3'],
  [4, 'heating'],
  [5, 'solar'],
  [6, 'backwash'],
  [7, 'cooling'],
  [8, 'manual'],
  [9, 'frost_protection'],
  [10, 'active'],
  [11, 'cover'],
  [12, 'valve_fault'],
  [13, 'cover_low'],
  [14, 'too_hot'],
  [15, 'invalid'],
]);

function mapPumpStatus(raw) {
  return PUMP_STATUS_LABELS.get(raw) || 'unknown';
}

// 12 (klepfout) en 15 (ongeldig) zijn storingen. 13 (afdekking laag) is expliciet
// als normaal gedocumenteerd en mag nooit een alarm geven.
function isPumpFault(pumpStatus) {
  return pumpStatus === 12 || pumpStatus === 15;
}

// filter_speed / FilterConfig.pump_speed: tekstwaarden, geen getallen — zie de
// documentatiefout in §3.2 van het voorstel.
const FILTER_SPEED_VALUES = ['off', 'low', 'medium', 'high', 'max'];

// filter.metrics.pump_speed en pump_current stonden op de gemeten installatie in
// elke sample op 0, ook terwijl filter.status een draaiende pomp op schema 3
// meldde. Doe daarom feature-detectie per pool in plaats van één bron hard te
// kiezen: zodra metrics.pump_current ooit van nul afwijkt, is dat de betere
// (verse) bron; blijft hij altijd 0, val terug op status (kan achterlopen).
function pumpRunning(pool, metricsEverNonZero) {
  const metricsSpeed = pool?.filter?.metrics?.pump_speed;
  const statusSpeed = pool?.filter?.status?.pump_speed;
  const statusStatus = pool?.filter?.status?.pump_status;
  if (metricsEverNonZero) {
    return typeof metricsSpeed === 'number' && metricsSpeed > 0;
  }
  return typeof statusSpeed === 'number' && statusSpeed > 0
    && typeof statusStatus === 'number' && statusStatus > 0;
}

function metricsLooksLive(pool) {
  const current = pool?.filter?.metrics?.pump_current;
  return typeof current === 'number' && current > 0;
}

// Droogloopdetectie, zie §2.4. NO_FLOW-codes: 201 = v1/v2 "No Flow", -28 = v3
// "Off: No flow". 201/-28 op zichzelf is normaal bij stilstaande pomp — alleen de
// combinatie met een draaiende pomp is een risico.
const NO_FLOW_CODES = new Set([201, -28]);

function dryRunRisk(pool, metricsEverNonZero) {
  const noFlow = NO_FLOW_CODES.has(pool?.ph?.status?.status)
    || NO_FLOW_CODES.has(pool?.cl?.status?.status);
  return pumpRunning(pool, metricsEverNonZero) && noFlow;
}

// lighting.status.status draagt geen aan/uit-betekenis (2 kwam voor met licht aan
// én uit). config.always_active is de enige betrouwbare bron, in beide richtingen
// getest.
function lightingOn(pool) {
  return pool?.lighting?.config?.always_active === true;
}

// main_temp en imx_temp lijken op temperaturen maar zijn dat niet (ruwe
// sensorwaarde resp. printtemperatuur). Alleen deze twee velden zijn
// zwembadtemperaturen.
function waterTemp(pool) {
  return pool?.temperature?.metrics?.water_temp;
}

function ambientTemp(pool) {
  return pool?.temperature?.metrics?.ambient_temp;
}

// cl.metrics.actual is redox (mV), geen chloor — zie de correctie in §2.1.
function redox(pool) {
  return pool?.cl?.metrics?.actual;
}

function chlorinePpm(pool) {
  return pool?.cl?.metrics?.clm;
}

// spec vertelt welke hardware er is; dat bepaalt welke capabilities zinvol zijn
// (zie §10.4). Nooit "is dit veld toevallig gevuld" gebruiken.
function capabilityPlan(spec) {
  spec = spec || {};
  return {
    coverDevice: spec.deck_enabled === true,
    lightDevice: spec.lighting_enabled === true,
    rgbLighting: spec.lighting_enabled === true && spec.lighting_type !== 'single',
    chlorinePpm: spec.clm_sensor === true,
    waterLevel: spec.wl_sensor === true,
    dryRunAlarm: spec.flow_alarm === true,
    backwash: spec.backwash_enabled === true,
  };
}

// Basiscapabilities die de driver altijd op app.json-niveau declareert, plus de
// spec-afhankelijke die alleen aangemaakt worden als de hardware ze heeft.
// Gebruikt zowel bij het pairen (driver.js, om niet even de volledige set te
// flashen voordat de eerste poll binnen is) als bij elke volgende poll
// (device.js#_syncCapabilities).
const POOL_BASE_CAPABILITIES = [
  'measure_temperature',
  'measure_temperature.ambient',
  'measure_ph',
  'measure_redox',
  'measure_current',
  'filter_running',
  'filter_status',
  'filter_speed',
  'alarm_fault',
  'onoff.pause',
  'onoff.shock',
];

function poolCapabilities(spec) {
  const plan = capabilityPlan(spec);
  const capabilities = [...POOL_BASE_CAPABILITIES];
  if ((spec || {}).heating_enabled === true) capabilities.push('target_temperature');
  if (plan.chlorinePpm) capabilities.push('measure_chlorine');
  if (plan.waterLevel) capabilities.push('measure_water_level', 'alarm_water_level');
  if (plan.dryRunAlarm) capabilities.push('alarm_dryrun');
  if (plan.backwash) capabilities.push('button.backwash');
  return capabilities;
}

module.exports = {
  COVER_STATES,
  mapCoverStatus,
  PUMP_STATUS_LABELS,
  mapPumpStatus,
  isPumpFault,
  FILTER_SPEED_VALUES,
  pumpRunning,
  metricsLooksLive,
  NO_FLOW_CODES,
  dryRunRisk,
  lightingOn,
  waterTemp,
  ambientTemp,
  redox,
  chlorinePpm,
  capabilityPlan,
  POOL_BASE_CAPABILITIES,
  poolCapabilities,
};
