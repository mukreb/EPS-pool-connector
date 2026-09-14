'use strict';

// Regressietests tegen de metingen uit docs/homey-app-voorstel.md, zodat de
// mappinglaag getest kan worden zonder een echt zwembad (§10.7). Draaien met:
//   node --test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mapping = require('../lib/mapping');

test('cover status codes: gemeten set van vijf, plus fallback', () => {
  assert.equal(mapping.mapCoverStatus(1), 'open');
  assert.equal(mapping.mapCoverStatus(2), 'closed');
  assert.equal(mapping.mapCoverStatus(3), 'opening');
  assert.equal(mapping.mapCoverStatus(4), 'closing');
  assert.equal(mapping.mapCoverStatus(5), 'stopped');
  assert.equal(mapping.mapCoverStatus(99), 'unknown');
  assert.equal(mapping.mapCoverStatus(undefined), 'unknown');
});

test('filter.metrics op nul: pompstand komt uit status (§2.3)', () => {
  const pool = {
    filter: {
      metrics: { pump_speed: 0, pump_current: 0.0 },
      status: { pump_speed: 3, pump_status: 3 }, // hoog, schema 3
    },
  };
  assert.equal(mapping.metricsLooksLive(pool), false);
  assert.equal(mapping.pumpRunning(pool, false), true);
  // Als metrics ooit wél leefde, mag alleen metrics nog tellen — en die staat hier op 0.
  assert.equal(mapping.pumpRunning(pool, true), false);
});

test('pompstand komt uit metrics zodra die ooit van nul afweek', () => {
  const pool = {
    filter: {
      metrics: { pump_speed: 2, pump_current: 4.1 },
      status: { pump_speed: 0, pump_status: 0 },
    },
  };
  assert.equal(mapping.pumpRunning(pool, true), true);
});

test('droogloopdetectie: 201 alleen is normaal, pomp + no-flow is risico (§2.4)', () => {
  const idle = {
    filter: { status: { pump_speed: 0, pump_status: 0 } },
    ph: { status: { status: 201 } },
    cl: { status: { status: 201 } },
  };
  assert.equal(mapping.dryRunRisk(idle, false), false);

  const running = {
    filter: { status: { pump_speed: 3, pump_status: 3 } },
    ph: { status: { status: 201 } },
    cl: { status: { status: 975 } },
  };
  assert.equal(mapping.dryRunRisk(running, false), true);

  const runningNoAlarm = {
    filter: { status: { pump_speed: 3, pump_status: 3 } },
    ph: { status: { status: 975 } },
    cl: { status: { status: 975 } },
  };
  assert.equal(mapping.dryRunRisk(runningNoAlarm, false), false);
});

test('pompstoringen: 12 en 15 zijn storingen, 13 is expliciet normaal (§2.3)', () => {
  assert.equal(mapping.isPumpFault(12), true);
  assert.equal(mapping.isPumpFault(15), true);
  assert.equal(mapping.isPumpFault(13), false);
  assert.equal(mapping.isPumpFault(4), false);
});

test('lighting.status is onbruikbaar; config.always_active is de bron (§7)', () => {
  assert.equal(mapping.lightingOn({ lighting: { config: { always_active: true }, status: { status: 2 } } }), true);
  assert.equal(mapping.lightingOn({ lighting: { config: { always_active: false }, status: { status: 2 } } }), false);
});

test('main_temp/imx_temp zijn geen zwembadtemperaturen (§2.2)', () => {
  const pool = {
    temperature: {
      metrics: { water_temp: 30.2, ambient_temp: 21.5, main_temp: 1581.0, imx_temp: 52.5 },
    },
  };
  assert.equal(mapping.waterTemp(pool), 30.2);
  assert.equal(mapping.ambientTemp(pool), 21.5);
});

test('capabilityPlan volgt spec, niet of een veld toevallig gevuld is (§2.6)', () => {
  // Exact de installatie uit het voorstel: geen CLM-sonde, enkelkleurig licht.
  const spec = {
    deck_enabled: true,
    lighting_enabled: true,
    lighting_type: 'single',
    heating_enabled: true,
    heating_solar: false,
    backwash_enabled: true,
    clm_sensor: false,
    wl_sensor: true,
    flow_alarm: true,
    aux_1: false,
  };
  const plan = mapping.capabilityPlan(spec);
  assert.equal(plan.coverDevice, true);
  assert.equal(plan.lightDevice, true);
  assert.equal(plan.rgbLighting, false, 'enkelkleurig licht mag geen kleurknoppen krijgen');
  assert.equal(plan.chlorinePpm, false, 'geen CLM-sonde, dus geen ppm-capability');
  assert.equal(plan.waterLevel, true);
  assert.equal(plan.dryRunAlarm, true);
});

test('capabilityPlan met RGB-licht en CLM-sonde', () => {
  const plan = mapping.capabilityPlan({
    lighting_enabled: true,
    lighting_type: 'rgb',
    clm_sensor: true,
  });
  assert.equal(plan.rgbLighting, true);
  assert.equal(plan.chlorinePpm, true);
});

test('capabilityPlan zonder spec (leeg object) faalt niet', () => {
  const plan = mapping.capabilityPlan();
  assert.equal(plan.coverDevice, false);
  assert.equal(plan.lightDevice, false);
});

test('poolCapabilities: basis plus alleen wat spec toestaat', () => {
  const noExtras = mapping.poolCapabilities({});
  for (const base of mapping.POOL_BASE_CAPABILITIES) {
    assert.ok(noExtras.includes(base), `mist basiscapability ${base}`);
  }
  assert.ok(!noExtras.includes('measure_chlorine'));
  assert.ok(!noExtras.includes('measure_water_level'));

  const full = mapping.poolCapabilities({
    heating_enabled: true,
    clm_sensor: true,
    wl_sensor: true,
    flow_alarm: true,
  });
  assert.ok(full.includes('target_temperature'));
  assert.ok(full.includes('measure_chlorine'));
  assert.ok(full.includes('measure_water_level'));
  assert.ok(full.includes('measure_water_level_delta'));
  assert.ok(full.includes('alarm_water_level'));
  assert.ok(full.includes('alarm_dryrun'));
});

test('poolCapabilities: geen pauzeren/filtersnelheid-schrijven/backwash/shockchlorering, ongeacht spec', () => {
  // Bediening (afdekking, licht, streeftemperatuur) staat op de betreffende
  // devices/capabilities; de rest doet de gebruiker in de SmartPoolConnect-
  // app/-website — dat zijn acties van een paar keer per jaar, niet iets voor
  // een Homey-tegel of een verkeerd afgevuurde flow. target_temperature is
  // bewust wél terug (vaker aangepast, dus wel een tegel/flow-actie waard).
  const full = mapping.poolCapabilities({
    heating_enabled: true, clm_sensor: true, wl_sensor: true, flow_alarm: true, backwash_enabled: true,
  });
  for (const writable of ['button.backwash', 'onoff.shock', 'onoff.pause']) {
    assert.ok(!full.includes(writable), `${writable} hoort niet meer in poolCapabilities()`);
    assert.ok(!mapping.POOL_MANAGED_CAPABILITIES.includes(writable), `${writable} hoort niet meer in POOL_MANAGED_CAPABILITIES`);
  }
});

test('poolCapabilities(null): v1-fallback (geen detail-endpoint) levert een lege lijst', () => {
  // GET /pool/{pid} gaf 501, dus er is geen spec en geen enkele van deze
  // capabilities heeft een databron. Zie de PoolDriver code review-fix.
  assert.deepEqual(mapping.poolCapabilities(null), []);
  assert.deepEqual(mapping.poolCapabilities(undefined), []);
});
