# Voorstel: Homey-app voor het EPS-zwembad

Dit document beschrijft hoe een volwaardige Homey-app voor het zwembad eruit kan
zien: welke waarden uitleesbaar zijn, welke bediening mogelijk is, en hoe dat het
beste op Homey-begrippen (devices, capabilities, flow-kaarten) te mappen valt.

Het is een **ontwerpvoorstel plus bouwopdracht**. Basis is de aangeleverde
[SmartPoolConnect API-documentatie](../reference/smartpoolconnect/SmartPoolConnect%20API%20Docs.pdf)
(v1.0.0, OpenAPI 3.1.0), gecorrigeerd met wat op 13 september 2026 tegen de echte
installatie is gemeten, plus wat er al staat in
[`prototypes/smartpoolconnect-homey/`](../prototypes/smartpoolconnect-homey/) en
[`prototypes/smartpoolconnect-cli/`](../prototypes/smartpoolconnect-cli/).

## Hoe dit document te lezen

| Je wilt… | Ga naar |
|---|---|
| **de app bouwen** | [§10 Bouwopdracht](#10-bouwopdracht) — bestandsindeling, contracten, capabilitylijst, acceptatiecriteria |
| weten *waarom* iets zo moet | §1 t/m §9 hieronder |
| de API zelf gebruiken | de [SmartPoolConnect Field Guide](https://claude.ai/code/artifact/691db840-cd7c-413d-a94e-73a610aba723) — alle correcties op de officiële documentatie op één pagina |

> ⚠️ **De officiële documentatie bevat aantoonbare fouten.** Twee daarvan breken stil,
> zonder foutmelding: `pump_speed` is in de configuratie een tekst en niet het getal
> dat de PDF noemt, en de meegeleverde droogloopformule kan op deze installatie nooit
> afgaan. Volg bij twijfel de veldgids, niet de PDF.

---

## 1. Uitgangspunten uit de documentatie

| Onderwerp | Wat de documentatie zegt |
|---|---|
| Basis-URL | `https://api.smartpoolconnect.eu` — **cloud-only**. De kast host geen lokale API; er is dus géén endpoint op het IP-adres van het zwembad. |
| Authenticatie | `X-API-Key: spc_…` (aanbevolen voor integraties) of OAuth 2.0 Bearer-token (primair voor de eigen web-UI). |
| Scopes | Sinds 2026-07-08 hard afgedwongen. Nodig: `pools:read` + `controls:write` — meer niet, zie hieronder. Zonder scope: HTTP 403 met `{"error":"missing_scope", …}`. |
| Rate limit | 60 verzoeken/minuut per key, met `X-RateLimit-Limit/Remaining/Reset` headers. |
| Hardwareversie | Dit zwembad is **v2** (vastgesteld 7 september 2026 via de ingelogde website). v2 = volledige besturing + configuratie. |
| Alle meetwaarden | Eén `GET /pool/{pid}` levert alle modules met `metrics`, `status` en `config`. Voor v2 én v3 dezelfde vorm — de API vertaalt v3-firmwaretabellen naar v1/v2-vorm. **v1 geeft hier HTTP 501**, zie hieronder. |

### Wat er inmiddels praktisch bewezen is

Met het [CLI-prototype](../prototypes/smartpoolconnect-cli/) is vastgesteld dat de
route uit dit voorstel werkt — niet alleen op papier:

- **Lezen werkt.** `GET /pool` en `GET /pool/{pid}` geven HTTP 200 met de
  modulegegevens.
- **Bedienen werkt.** De afdekking is via `POST /pool/{pid}/cmd/cover_open`,
  `cover_stop` en `cover_close` daadwerkelijk gaan bewegen, halverwege gestopt en
  weer gesloten. Daarmee is de hele bedieningskant van dit voorstel geen aanname meer.
- **De afdekstatuscodes zijn volledig gemeten** — alle vijf, inclusief de looptijd van
  ruim zes minuten. Zie
  [§2.5](#statuscodes-van-de-afdekking--gemeten-niet-gedocumenteerd).
- **Twee verschillende vertragingen**, en dat verschil is bepalend voor de app: een
  `POST /cmd/*` doet er 20 tot 30 seconden over, een `PATCH` op een module is binnen
  10 seconden zichtbaar. Zie [§3.3](#33-hoe-lang-duurt-het-voordat-een-wijziging-zichtbaar-is).
- **De `PATCH`-route is heen en terug getest.** `PATCH /pool/{pid}/lighting` met
  `{"always_active": true}` en daarna `false` zette de verlichting aan en weer uit;
  de app van de leverancier toonde het licht als aan. Beide keren bleven de overige
  velden van die module (`dimming`, `switch_pulse`, `cover_disabled`, `schedule`)
  ongemoeid. Voor dit endpoint is de kale aan/uit-body dus een echte tweede variant en
  geen vervanging van het hele object — precies zoals de documentatie beschrijft, en
  anders dan bij `filter`.
- **`status` blijkt een pool-brede momentopname** die uren oud kan zijn, terwijl
  `metrics` en `config` live zijn. Zie
  [§2.3](#status-is-een-pool-brede-momentopname-en-kan-uren-oud-zijn) — dit raakt
  elke module en corrigeert een eerdere aanname in dit voorstel.
- **De pompstatuscodes uit de documentatie kloppen.** Toen de afdekking openging
  sprong `filter.status.pump_status` naar `11` (Afdekking), precies zoals de tabel
  voorspelt. Tot dan was alleen `4` (verwarming) waargenomen.
- **Het volledige antwoord en de moduleconfiguraties zijn opgehaald.** Daarmee zijn
  het `FilterConfig`-schema, het sondetype en de aanwezige hardware bekend — en kwam
  een fout in de documentatie aan het licht, zie
  [§3.2](#het-filterconfig-schema--en-een-fout-in-de-documentatie).
- **Het gebruikte credential is een OAuth-token uit de browsersessie**, niet een
  `spc_…`-API-key. Die key is nog niet door de leverancier verstrekt, en de
  vervaldatum van het token blijkt niet leesbaar.

Dat laatste punt is geen detail: het bepaalt hoe de app met authenticatie moet
omgaan, zie [§4.2](#42-authenticatie-twee-methoden-naast-elkaar).

### Welke scopes precies nodig zijn

De documentatie is hier preciezer dan je op het eerste gezicht zou denken: *"Reads
under `/pool` and `/search` require **any of** `pools:read`, `controls:read`, or
`history:read`"*. Eén van de drie volstaat dus voor álle leesverzoeken onder `/pool`
— inclusief `GET /pool/{pid}/filter` en `GET /pool/{pid}/spec`, die voor de
read-modify-write nodig zijn. Schrijven vereist `controls:write` of `pools:write`.

`pools:read` + `controls:write` dekt daarmee alles wat deze app doet. `controls:read`
erbij vragen voegt niets toe en maakt de aanvraag alleen zwaarder dan nodig; dat is
ook precies wat de CLI-instructies in deze repo al aanraden.

### Let op v1-zwembaden

De PDF spreekt zichzelf op één punt tegen. Het hoofdstuk over sensordata stelt dat
`GET /pool/{pid}` "dezelfde vorm" teruggeeft voor v1, v2 en v3, maar de
endpointspecificatie is expliciet: **v1 geeft `501 Pool version not supported for
detail view`** en verwijst voor v1-status naar de pool-lijst.

Voor dit zwembad (v2) maakt dat niets uit, maar de app moet niet blind aannemen dat
elk gekoppeld zwembad moduledata geeft: bij 501 terugvallen op de status uit
`GET /pool` in plaats van een fout tonen. Dat kost weinig en voorkomt dat de app
onbruikbaar is voor iemand met oudere hardware.

Twee valkuilen die de documentatie expliciet noemt en die het ontwerp sturen:

1. **`PATCH` vervangt het hele configuratie-object**, het is geen partiële merge.
   Een body als `{"schedule_1": {"enabled": true}}` wordt geweigerd. Je moet dus
   altijd eerst `GET` doen, het object aanpassen en compleet terugsturen.
2. **`GET` verpakt de config, `PATCH` niet.** `GET` geeft
   `{"config": {…}, "status": {…}, "metrics": {…}}`; de `PATCH`-body is exact het
   binnenste `config`-object op topniveau, zonder wrapper.

De app moet hier één gedeelde helper voor hebben (`readModifyWrite(module, changes)`),
anders gaat dit gegarandeerd een keer mis.

---

## 2. Wat er te lezen valt

Alles hieronder komt uit één `GET /pool/{pid}`, tenzij anders vermeld.

### 2.1 Waterchemie

| Waarde | API-pad | Voorgestelde capability | Eenheid |
|---|---|---|---|
| pH | `ph.metrics.actual` | `measure_ph` (custom) | pH |
| Redox / Rx | `cl.metrics.actual` | `measure_redox` (custom) | mV |
| Vrij chloor | `cl.metrics.clm` | `measure_chlorine` (custom) | ppm |

De documentatie onderscheidt twee sondetypes: RX-sondes vullen `actual` (mV),
CLM-sondes vullen `clm` (ppm). **Dit zwembad heeft geen CLM-sonde**: `spec.clm_sensor`
staat op `false` en `cl.metrics` bevat dan ook alleen `actual` in mV. De
ppm-capability moet hier dus niet aangemaakt worden.

Dat is meteen het nette patroon: niet kijken of een veld toevallig een getal bevat,
maar de expliciete vlag in `spec` lezen — zie
[§2.6](#26-spec-vertelt-welke-capabilities-je-moet-aanmaken).

De `config`-blokken geven er gratis streefwaarden bij: `ph.config.target` en
`cl.config.rx.target`. Daarmee kan de app tonen hoe ver een meting van zijn doel
af zit, in plaats van een kaal getal — en een flow kan op die afwijking triggeren
zonder dat je de streefwaarde in Homey hoeft over te typen.

> Let op: de huidige prototype-app noemt `cl.metrics.actual` "Chlorine" in mV.
> Dat is strikt genomen redox, niet chloor. In het voorstel wordt dat
> `measure_redox`, zodat er ruimte is voor een echte ppm-chloorwaarde.

### 2.2 Temperatuur

| Waarde | API-pad | Capability |
|---|---|---|
| Watertemperatuur | `temperature.metrics.water_temp` | `measure_temperature` (standaard) |
| Luchttemperatuur | `temperature.metrics.ambient_temp` | `measure_temperature.ambient` |

De documentatie merkt op dat `water_temp` gevuld is zodra de sonde bedraad is —
verwarming hoeft niet ingeschakeld te zijn.

⚠️ `temperature.metrics` bevat nog twee velden die er als temperatuur uitzien maar
het niet zijn: `main_temp` stond op `1581.0` en `imx_temp` op `52.5`. De eerste is
geen graden Celsius (een ruwe sensorwaarde), de tweede is vrijwel zeker de
temperatuur van de besturingsprint. **Alleen `water_temp` en `ambient_temp` zijn
zwembadtemperaturen.** Wie hier blind alles wat op `_temp` eindigt als capability
aanhangt, zet 1581 °C in de tegel.

`temperature.config.target` is de streeftemperatuur (30,5 °C bij deze installatie)
en is dus de waarde waar een `target_temperature`-capability op zou moeten aansluiten.

### 2.3 Filterpomp

| Waarde | API-pad | Capability |
|---|---|---|
| Commandosnelheid | `filter.metrics.pump_speed` | `filter_speed` (enum) |
| Wat de pomp doet | `filter.status.pump_status` | `filter_status` (enum, 16 waarden) |
| Motorstroom | `filter.metrics.pump_current` | `measure_current` (standaard, A) |
| Draait de pomp | afgeleid | `filter_running` (boolean) |

`pump_speed`: `-1` uitgeschakeld, `0` uit, `1` laag, `2` midden, `3` hoog, `4` max.

`pump_status` is de interessantste waarde, want die vertelt *waarom* de pomp draait:

| Code | Betekenis | | Code | Betekenis |
|---|---|---|---|---|
| -1 | Uitgeschakeld | | 8 | Handmatig |
| 0 | Uit | | 9 | Vorstbeveiliging |
| 1 | Schema 1 | | 10 | Actief |
| 2 | Schema 2 | | 11 | Afdekking |
| 3 | Schema 3 | | 12 | Klepfout |
| 4 | Verwarming | | 13 | Afdekking laag (normaal) |
| 5 | Zonnecollector | | 14 | Te warm |
| 6 | Backwash | | 15 | Ongeldig |
| 7 | Koeling | | | |

Code 12 (klepfout) en 15 (ongeldig) zijn kandidaten voor een storingsmelding.
Code 13 is expliciet als *normaal* gedocumenteerd en moet dus géén alarm geven.

#### `status` is een pool-brede momentopname en kan uren oud zijn

Dit is de belangrijkste vondst uit de metingen, en hij raakt élke module.

Elk moduleblok heeft een eigen `timestamp`, maar die zijn niet onafhankelijk. In het
volledige antwoord dragen **alle** `status`-blokken exact dezelfde tijdstempel, en
**alle** `metrics`-blokken eveneens. Er zijn dus geen tien losse tijdstempels maar
twee: één voor de hele `status`-sectie en één voor alle `metrics`.

En die twee lopen ver uiteen. In een meting was `metrics` actueel tot op de seconde,
terwijl de volledige `status`-sectie **137 minuten oud** was. Wat daar stond:

De `status`-sectie ververst bij bepaalde gebeurtenissen, niet op een vaste klok.
Tijdens het bewegen van de afdekking sprong hij elke paar seconden mee; daarna bleef
hij ruim twee uur bevroren, ook toen de verlichting via de API werd omgezet.

Dat het om één gedeelde sectie gaat is daarna hard bevestigd: bij een volgend
afdekcommando sprongen **alle** modules tegelijk naar dezelfde nieuwe tijdstempel —
`ph`, `cl`, `filter`, `level`, `lighting`, `backwash`, `temperature`, de hele rij.
Eén gebeurtenis ververst dus de status van álles, ook van modules die er niets mee te
maken hebben.

**Wat de app hieruit moet concluderen:**

| Wat je wilt weten | Lees uit |
|---|---|
| Meetwaarden (pH, temperatuur, niveau) | `metrics` |
| Ingestelde toestand (licht aan, schema's, streefwaarden) | `config` |
| Afdekstand | `status` — geen alternatief, en ververst juist bij beweging |
| Pompstand | `status` — zie de waarschuwing hieronder |

#### ⚠️ `filter.metrics` lijkt niet gevuld te worden

Dit is een correctie op een eerdere versie van dit voorstel, dat `metrics` als de
betrouwbare pompbron aanwees. Over vier metingen verspreid over ruim twee uur:

| Meting | `status.pump_speed` | `status.pump_status` | `metrics.pump_speed` | `metrics.pump_current` |
|---|---|---|---|---|
| in rust | 3 (hoog) | 4 (verwarming) | 0 | 0,0 A |
| licht aan | 3 (hoog) | 4 (verwarming) | 0 | 0,0 A |
| afdekking opent | 0 | 11 (afdekking) | 0 | 0,0 A |
| afdekking open | 3 (hoog) | 3 (schema 3) | 0 | 0,0 A |

`metrics` staat **altijd** op nul, ook op momenten dat `status` meldt dat de pomp op
schema 3 op hoog draait — en schema 3 staat bij deze installatie dagelijks van 00:00
tot 23:55 aan. Ondertussen vertellen de `status`-waarden wél een samenhangend verhaal:
hoog voor verwarming, dan stil tijdens het bewegen van de afdekking, dan hoog op
schema 3.

De conclusie ligt om: op deze installatie zijn `filter.metrics.pump_speed` en
`pump_current` kennelijk niet aangesloten, en is `filter.status` de enige bron voor de
pompstand — mét het voorbehoud dat die kan achterlopen.

**Dat raakt de droogloopdetectie hard.** De formule uit de documentatie eist
`metrics.pump_speed > 0`, en die voorwaarde wordt hier nooit waar. Het alarm zou dus
stilletjes nooit afgaan. Zie [§2.4](#24-droogloopdetectie--de-belangrijkste-afgeleide-waarde).

Te bevestigen: lees `raw` op een moment dat je de filterpomp hoort draaien. Blijft
`metrics.pump_current` dan nog 0,0 dan is het zeker.

#### Een tweede `pump_current`

`temperature.metrics.pump_current` is een ander veld dan dat in `filter.metrics`, en
dat wérkt wel: het sprong van 0,0 naar 8,2 A. Gezien `heating_type: "vbiv"` gaat dat
vermoedelijk over de verwarmingskant, niet de filterpomp. Niet door elkaar halen.

### 2.4 Droogloopdetectie — de belangrijkste afgeleide waarde

De documentatie beschrijft letterlijk hoe je "pomp draait maar geen doorstroming"
detecteert. Dat is het scenario waarin de pomp droogloopt, en het is precies het
soort ding waarvoor je een Homey-app wilt:

```js
const pumpOn  = filter.status.pump_status > 0 && filter.metrics.pump_speed > 0;
const NO_FLOW = [201, -28];   // 201 = v1/v2 "No Flow", -28 = v3 "Off: No flow"
const noFlow  = NO_FLOW.includes(ph.status.status)
             || NO_FLOW.includes(cl.status.status);
const dryRunRisk = pumpOn && noFlow;
```

Dit wordt in het voorstel capability `alarm_dryrun` (Homey-alarm, rood in de UI)
met een bijbehorende flow-trigger. De firmware bepaalt zelf of er doorstroming is
op basis van de geconfigureerde detectiemethode (schoepenrad / direct / druk /
Modbus-pomp), dus de app hoeft het sensortype niet te kennen.

⚠️ **De formule uit de documentatie werkt hier niet.** Die eist
`metrics.pump_speed > 0`, en dat veld stond in elke meting op 0 — zie de waarschuwing
hierboven. Het alarm zou dus nooit afgaan, zonder dat iets dat verraadt. Beide helften
moeten daarom uit `status` komen:

```js
const pumpOn = filter.status.pump_speed > 0 && filter.status.pump_status > 0;
```

Nadeel: die sectie kan achterlopen, dus het alarm kan te laat komen. Zolang
`filter.metrics` niet gevuld wordt, is er geen betere bron. Wordt dat veld op een
andere installatie wél gevuld, gebruik het dan — de app kan dat zelf vaststellen door
te kijken of `metrics.pump_current` ooit van nul afwijkt.

Wat overeind blijft is de vergelijking zelf: pomp aan én een doseerkanaal dat geen
doorstroming meldt. `spec.flow_alarm` geeft daarnaast aan of het zwembad
doorstroombewaking überhaupt aan heeft staan — is die `false`, dan heeft dit alarm
geen betekenis en kun je het beter niet aanmaken.

**Let op: `201` is heel gewoon.** In een meting met stilstaande pomp stonden
`ph.status.status` en `cl.status.status` allebei op `201`, en dat is precies zoals het
hoort — zonder draaiende pomp is er nu eenmaal geen doorstroming. De code op zichzelf
is dus geen storing en mag nooit alleen een alarm geven. Alleen de *combinatie* met
een draaiende pomp is verdacht.

### 2.5 Afdekking, verlichting, controller

| Waarde | API-pad | Capability |
|---|---|---|
| Afdekstand | `cover.status.status` | `windowcoverings_state` op het cover-device |
| Verlichting aan | `lighting.config.always_active` | `onoff` op het licht-device |
| Controller gepauzeerd | `GET /pool/{pid}/spec` → `pause` | `onoff.pause` |
| Online/offline | `GET /pool` → `status` + `activity_at` | `setAvailable()` / `setUnavailable()` |

#### Statuscodes van de afdekking — gemeten, niet gedocumenteerd

Deze codes staan nergens in de PDF. Ze zijn op 13 september 2026 vastgesteld door
de afdekking te laten bewegen en er `cover.status.status` bij uit te lezen:

| Code | Betekenis | Hoe vastgesteld |
|---|---|---|
| 1 | Volledig open | na een complete openingsloop |
| 2 | Dicht | beginstand, afdekking lag dicht |
| 3 | Aan het openen | direct na `cmd/cover_open` |
| 4 | Aan het sluiten | direct na `cmd/cover_close` |
| 5 | Gestopt in tussenstand | na `cmd/cover_stop` halverwege het openen |

De set is daarmee compleet en logisch: `1` en `2` zijn de twee ruststanden, `3` en `4`
de twee bewegingen, en `5` de onderbroken tussenstand.

#### De looptijd is minuten, niet seconden

De afdekking doet er in werkelijkheid **ongeveer 180 seconden** over, zowel openen als
sluiten. Dat is fysiek nagemeten.

De API-tijdstempels suggereerden iets anders, en dat is zelf een les. Tussen de
tijdstempel van `3` (openen) en die van `1` (open) zat 363 seconden, tussen `4` en `2`
maar 173. Daaruit leek te volgen dat openen twee keer zo lang duurt als sluiten. Dat
klopt niet.

⚠️ **Een `status.timestamp` is het moment van de momentopname, niet het moment waarop
de gebeurtenis plaatsvond.** Omdat die sectie alleen bij gebeurtenissen ververst, kan
er tijd zitten tussen "de afdekking is klaar" en "de API meldt dat". Duur berekenen
uit twee tijdstempels geeft dus een bovengrens, geen looptijd.

Voor de app maakt het weinig uit — die moet toch op de eindstand wachten en niet op
een klok — maar het is precies het soort afleiding waar je een verkeerde conclusie uit
trekt. Ik ben er zelf in getrapt.

Wat er wél uit volgt:

- Een afdekcommando is niet "klaar" na een halve minuut; reken op minuten. De
  eindstand komt binnen via de gewone pollcyclus, niet via de korte verversing direct
  na het commando.
- Tussendoor blijft de stand `3` of `4`. De app moet die weergeven als *beweegt*, maar
  er niet uit afleiden dat er nú nog iets beweegt — een al geopende afdekking kan nog
  even als "aan het openen" in beeld staan.
- Een flow die de afdekking opent en daarna iets anders wil doen, moet wachten op
  `status == 1`, niet op het uitblijven van een foutmelding en niet op een timer.

#### Er is geen standpercentage

`cover.status` bevat alleen `timestamp`, `status` en `covco`. **Hoe ver de afdekking
open staat, geeft de API niet** — geen percentage, geen positie. Ook `covco` bleef in
alle metingen op `0`, ook tijdens beweging en met een commando in de wachtrij.

Voor Homey betekent dat: `windowcoverings_state` (open / gestopt / dicht) kan wel,
maar `windowcoverings_set` met een schuifregelaar voor een percentage niet. Een meting
halverwege het openen gaf geen enkel veld dat de stand verraadde.

> Hier zit een fout in het bestaande prototype: dat rekent `5` bij *beweegt*. Een
> afdekking die halverwege is gestopt blijft dan eindeloos "beweegt" tonen, terwijl
> hij juist stilstaat. Dat is inmiddels gecorrigeerd.

Voor de app betekent dit vier zinvolle standen in plaats van twee: `closed`,
`opening`, `closing` en `stopped`, plus `open` zodra die code bekend is. Een stand
die stilstaat maar niet dicht is, is precies het geval waar je een flow op wilt
kunnen bouwen ("afdekking staat al een uur halfopen").

### 2.6 `spec` vertelt welke capabilities je moet aanmaken

`GET /pool/{pid}` bevat een `spec`-blok dat beschrijft **welke hardware deze
installatie heeft**. Dat is precies wat een Homey-app nodig heeft om niet een tegel
vol lege waarden te tonen. Een greep uit wat er bij deze installatie in staat:

| Vlag | Waarde hier | Wat de app ermee doet |
|---|---|---|
| `deck_enabled` | `true` | afdekking-device aanmaken |
| `lighting_enabled` | `true` | licht-device aanmaken |
| `lighting_type` | `"single"` | **enkelkleurige lamp** — geen kleurknoppen |
| `heating_enabled` | `true` | verwarmingscapabilities tonen |
| `heating_solar` | `false` | geen zonnecollector-module |
| `backwash_enabled` | `true` | backwash-knop tonen |
| `clm_sensor` | `false` | géén ppm-chloor, alleen redox |
| `wl_sensor` | `true` | waterniveau tonen |
| `flow_alarm` | `true` | droogloopalarm heeft betekenis |
| `aux_1` … `aux_4` | `false` | geen aux-slots, niets aanmaken |
| `pool_volume` | `60` | informatief |
| `pause` | `false` | huidige pauzestand |

**Dat `lighting_type` op `single` staat, verandert het ontwerp.** De documentatie
zegt zelf dat `lighting_next` en `lighting_reset` niets doen op een enkelkleurige
lamp. De kleurknoppen die eerder in dit voorstel stonden zijn hier dus loze knoppen
en moeten alleen verschijnen als `lighting_type` een RGB-variant is.

De pair-flow leest `spec` daarom één keer en bouwt daaruit de capabilitylijst op,
in plaats van alles aan te maken en te hopen dat het gevuld wordt. Bij een
`spec`-wijziging (nieuwe hardware) kan de app de lijst bij een volgende poll
bijwerken.

### 2.7 Modules die de documentatie niet noemt

De PDF somt `ph`, `cl`, `filter`, `cover`, `temperature`, `lighting`, `level`,
`aux/{slot}` en `spec` op. In het echte antwoord zitten er meer:

| Module | Inhoud | Bruikbaar als |
|---|---|---|
| `level` | `value` in centimeters, plus `delta` t.o.v. het streefniveau | waterniveau-sensor, en een alarm bij te grote afwijking — zie de waarschuwing hieronder |
| `backwash` | eigen status én een schema met `interval`, `backwash_duration`, `start_date`, `start_time` | tonen wanneer de volgende spoeling gepland staat |
| `firmware` | `gui_version`, `main_version`, `io_version`, `deck_version` | device-informatie in Homey |
| `eco_valve` | `regulation` (hier `"off"`) | alleen tonen als in gebruik |
| `zero_e` | drempelwaarden, hier uitgeschakeld | alleen tonen als `enabled` |
| `api_version` | `2` | bevestigt de hardwareversie in het antwoord zelf — handig voor de 501-afhandeling bij v1 |

Vooral `level` is de moeite: een zakkend waterniveau is precies zo'n sluipend
probleem waar je een melding voor wilt, en het staat niet in de documentatie.

⚠️ **Maar het niveau beweegt mee met de afdekking.** Tijdens het openen liep `value`
op van 4,44 naar 5,28 cm en `delta` van 0,34 naar 1,18 — een sprong die niets met
waterverlies te maken heeft. Een niveaualarm moet dus onderdrukt worden zolang de
afdekking beweegt of net bewogen heeft, anders krijg je een melding bij elke keer dat
je gaat zwemmen. `spec.wl_hys_*` bevat de hysteresedrempels die het zwembad zelf
hanteert; die zijn het logische startpunt voor de grenswaarden in plaats van een
zelfbedacht getal.

---

## 3. Wat er te bedienen valt

Twee soorten bediening, met verschillende semantiek:

### 3.1 Momentane commando's — `POST /pool/{pid}/cmd/{command}`

Geen request-body; het zwembad voert het commando uit bij de volgende synchronisatie.
HTTP 200 betekent *in de wachtrij gezet*, niet *uitgevoerd*.

| Commando | Effect | Versies |
|---|---|---|
| `cover_open` / `cover_stop` / `cover_close` | afdekking openen / stoppen / sluiten | v1, v2 |
| `backwash` | terugspoelcyclus starten | v2 |
| `shock_start` / `shock_stop` | shockchlorering starten / stoppen | v2 |
| `lighting_next` / `lighting_reset` | volgende kleur / kleur resetten | v2 |

`cover_open` en `cover_close` zijn met het CLI-prototype daadwerkelijk uitgevoerd:
de afdekking ging open en weer dicht. De overige commando's in deze tabel zijn nog
niet getest.

### 3.2 Persistente instellingen — `PATCH /pool/{pid}/{module}`

| Instelling | Endpoint | Body |
|---|---|---|
| Verlichting aan/uit | `PATCH /pool/{pid}/lighting` | `{"always_active": true\|false}` |
| Controller pauzeren | `PATCH /pool/{pid}/spec` | `{"pause": true\|false}` |
| Filtersnelheid & schema's | `PATCH /pool/{pid}/filter` | volledig `FilterConfig`-object, zie hieronder |
| Pompgedrag bij afdekking | `PATCH /pool/{pid}/cover` | volledig `CoverConfig`-object |

#### Het `FilterConfig`-schema — en een fout in de documentatie

Dit schema stond niet uitgeschreven in de PDF. Opgehaald met `GET /pool/{pid}/filter`
ziet het er zo uit:

```json
{
  "always_active": false,
  "pump_speed": "low",
  "schedule_1": { "pump_speed": "off",  "start_time": "00:00",
                  "stop_time": "00:00", "enabled": false, "days": [] },
  "schedule_2": { "…": "idem" },
  "schedule_3": { "pump_speed": "high", "start_time": "00:00",
                  "stop_time": "23:55", "enabled": true,
                  "days": ["monday", "tuesday", "…", "sunday"] }
}
```

⚠️ **`pump_speed` is hier een tekst, geen getal.** De waarden zijn `"off"`, `"low"`,
`"medium"`, `"high"` en `"max"`. Dat is iets anders dan de meetwaarde
`filter.metrics.pump_speed`, die wél een getal is (`0`–`4`).

Daarmee klopt het recept uit de documentatie niet. Die schrijft letterlijk *"enable a
schedule with `pump_speed: 2` (Medium)"* — maar een `2` op dit veld is geen geldige
waarde voor het configuratie-object. Het moet `"medium"` zijn. Wie de documentatie
hier letterlijk volgt, krijgt de `did not match any variant of untagged enum`-fout
die diezelfde pagina bij de andere valkuil beschrijft.

`days` is een lijst met volledig uitgeschreven Engelse dagnamen in kleine letters.

Twee dingen die de documentatie nadrukkelijk waarschuwt en die makkelijk fout gaan:

- **Licht aan/uit is géén commando.** `lighting_next` / `lighting_reset` wisselen
  alleen de RGB-kleur en doen niets op een enkelkleurige lamp. Aan/uit loopt via
  `PATCH /lighting` met `always_active`. `false` geeft de besturing terug aan een
  eventueel tijdschema.
- **`PATCH /cover` beweegt de afdekking niet.** Dat endpoint configureert alleen
  hoe de pomp op de afdekking reageert. Bewegen gaat via `cmd/cover_*`.

### 3.3 Hoe lang duurt het voordat een wijziging zichtbaar is

De twee soorten bediening hebben een duidelijk verschillende vertraging. Gemeten:

| Soort | Endpoint | Zichtbaar na | Waar |
|---|---|---|---|
| Momentaan commando | `POST /pool/{pid}/cmd/*` | 20–30 s | `cover.status` |
| Instelling | `PATCH /pool/{pid}/{module}` | < 10 s | `config` |

Dat verschil is geen toeval. Een `PATCH` schrijft naar de configuratie in de cloud en
is daar meteen terug te lezen. Een `cmd/*` moet wachten tot het zwembad zelf
synchroniseert — de documentatie zegt letterlijk dat het commando "op de volgende
sync" wordt toegepast, en `cmd/cover_stop` bleek pas na ruim 30 seconden zichtbaar,
`cmd/cover_close` na ruim 23.

**Belangrijk onderscheid:** dat `config` de nieuwe waarde teruggeeft, bewijst dat de
cloud de wijziging heeft geaccepteerd — niet dat het zwembad hem al heeft uitgevoerd.
Voor de verlichting vielen die twee praktisch samen, maar de app moet niet doen alsof
een teruggelezen `config` hetzelfde is als fysieke bevestiging. Bij de afdekking is
dat verschil expliciet: HTTP 200 betekent alleen "in de wachtrij".

Waar de app op moet wachten verschilt dus per geval:

- **Afdekking**: tot `cover.status.timestamp` verspringt. Bij beweging ververst de
  `status`-sectie wél, dus dat is een bruikbaar signaal.
- **`PATCH`-instellingen**: tot `config` de nieuwe waarde toont. Wachten op `status`
  werkt hier niet — bij het omzetten van de verlichting bleef dat blok ruim twee uur
  onveranderd, terwijl `config.always_active` binnen 10 seconden meebewoog. Een app
  die hier op `status` wacht, wacht eeuwig en meldt ten onrechte een mislukking.

---

## 4. Voorgestelde app-structuur

### 4.0 Wat draait waar — je hoeft niets te hosten

Een Homey-app draait op de Homey Pro zelf. Er komt geen server, VPS, container of
cloudfunctie aan te pas, en er hoeft niets inkomend bereikbaar te zijn: geen open
poort, geen domeinnaam, geen certificaat.

```
Homey Pro  ──HTTPS (uitgaand)──►  api.smartpoolconnect.eu  ──►  zwembadkast
 (deze app)                         (van de leverancier)
```

Het credential staat in de device-store van de Homey. Wat je nodig hebt:

- **Een Homey Pro.** Eigen apps draaien alleen op Pro — niet op Homey Cloud of Bridge.
- **Een computer met Node.js en de Athom CLI**, uitsluitend om de app te bouwen en
  naar de Homey te sturen. Dat is een handeling per update, geen draaiend proces.

Let op het verschil tussen de twee CLI-commando's: `homey app run` is
ontwikkelmodus en leeft zolang je terminal openstaat, terwijl `homey app install` de
app permanent op de Homey zet — daarna mag de computer uit en blijft alles draaien.
Publiceren in de Homey App Store kan later, maar is niet nodig; sideloaden werkt
net zo goed.

**Waar de app wél van afhankelijk is, is de cloud van de leverancier.** De kast host
geen lokale API — de documentatie stelt expliciet dat er geen endpoint op het
IP-adres van het zwembad zit en dat de kast alleen uitgaand naar de cloud stuurt.
Zonder internet, of bij een storing bij SmartPoolConnect, werkt de app dus niet. Dat
is inherent aan het platform en niet iets dat met zelf hosten te omzeilen is.

### 4.1 Drie devices per zwembad, één API-verbinding

Alles in één device stoppen kán, maar dan is het licht geen echt Homey-licht (geen
"doe alle lampen uit") en is de afdekking geen echte rolluik-bediening. Voorstel:

```
Smart Pool Connect (app)
│
├── Driver "pool"    → class: sensor         de meetwaarden + controller
├── Driver "cover"   → class: windowcoverings  de afdekking
└── Driver "light"   → class: light            de verlichting
```

Alle drie worden bij het koppelen in één keer aangemaakt vanaf hetzelfde
pool-UUID, dus je doorloopt de pair-flow één keer.

### 4.2 Authenticatie: twee methoden naast elkaar

De app moet **beide** credentials ondersteunen, want in de praktijk is er nu alleen
een browsertoken en later hopelijk een API-key. De API accepteert ze allebei op
dezelfde endpoints; alleen de header verschilt:

| Methode | Header | Geschikt voor |
|---|---|---|
| API-key | `X-API-Key: spc_…` | permanent gebruik — dit is waar de app naartoe moet |
| OAuth-token | `Authorization: Bearer <token>` | nu bruikbaar, maar verloopt een keer |

In de pair-flow komt dus een keuze: *API-key* (aanbevolen) of *toegangstoken*. De
API-client heeft er verder geen last van — één `authHeader()`-functie die op basis
van het opgeslagen credentialtype de juiste header zet, de rest van de code blijft
identiek.

**Omgaan met een verlopend token.** Hier liep een aanname stuk. Het plan was om de
vervaldatum uit het `exp`-veld van de JWT-payload te lezen, zodat je vooraf weet
hoeveel tijd je hebt. Dat werkt niet: **het token van SmartPoolConnect is geen
standaard JWT** en bevat geen leesbaar `exp`-veld. Het CLI-prototype meldt dat nu
ook eerlijk in plaats van een datum te verzinnen.

Gevolg: de vervaldatum is niet te voorspellen. Het token kan morgen ongeldig zijn of
over een half jaar; dat het al dagen werkt zegt niets over wat er gaat komen. Er is
geen waarschuwing vooraf mogelijk — alleen opvangen achteraf.

Daarmee wordt de **repair-flow** (`"repair"` naast `"pair"` in `app.json`) geen
comfort maar de kern van de oplossing. Als de API 401 teruggeeft, gaat het device op
*niet beschikbaar* met de melding "token verlopen — open Reparatie om een nieuw token
te plakken". Je hoeft het device dan niet opnieuw toe te voegen en je flows blijven
intact. Zonder die flow ben je bij elke sessievernieuwing je hele configuratie kwijt.

Het onderstreept ook waarom de `spc_…`-key de echte oplossing is: die heeft wél een
voorspelbare geldigheidsduur (een jaar volgens de documentatie).

Zodra de `spc_…`-key er is, is dat een kwestie van één keer de repair-flow doorlopen
en het tokenpad wordt verder niet meer geraakt.

Het credential staat in de Homey device-store, niet in een `.env`-bestand, en wordt
uit logs en foutmeldingen gefilterd.

### 4.3 Eén gedeelde poller

Drie devices die elk apart pollen zou drie keer zoveel verzoeken kosten. In plaats
daarvan houdt `app.js` één `PoolPoller` per pool-UUID bij: die doet één
`GET /pool/{pid}` per interval en deelt het resultaat uit aan de devices die erop
geabonneerd zijn.

```
app.js
  PoolPoller(pid)  ──GET /pool/{pid}──►  api.smartpoolconnect.eu
        │
        ├─► pool-device    (meetwaarden, alarmen)
        ├─► cover-device   (stand)
        └─► light-device   (aan/uit)
```

Budget bij het standaardinterval van 30 s: 2 verzoeken/minuut van de 60. Ruim
voldoende marge voor commando's en voor de `GET`-helft van elke read-modify-write.

Na elk verstuurd commando verfrist de poller een paar keer extra in plaats van één
keer, en hoe lang dat duurt hangt af van het soort commando — zie
[§3.3](#33-hoe-lang-duurt-het-voordat-een-wijziging-zichtbaar-is). Kort: na een
`PATCH` volstaat een verfrissing na een paar seconden tegen `config`, na een
`POST /cmd/*` is een reeks op ongeveer 10, 20, 30 en 45 seconden tegen
`cover.status.timestamp` nodig.

### 4.4 Capability-overzicht per device

**Device "Zwembad"** (class `sensor`)

| Capability | Soort | Bediening |
|---|---|---|
| `measure_temperature` | water °C | lezen |
| `measure_temperature.ambient` | lucht °C | lezen |
| `measure_ph` | pH | lezen |
| `measure_redox` | mV | lezen |
| `measure_water_level` | waterniveau cm | lezen |
| `measure_current` | pompstroom A | lezen |
| `filter_running` | boolean | lezen |
| `filter_status` | enum (16 codes) | lezen |
| `filter_speed` | enum uit/laag/midden/hoog/max | **schrijven** |
| `alarm_dryrun` | alarm | lezen |
| `alarm_fault` | alarm (klepfout / ongeldig) | lezen |
| `onoff.pause` | controller pauzeren | **schrijven** |
| `button.backwash` | backwash starten | **schrijven** |
| `onoff.shock` | shockchlorering | **schrijven** |

**Device "Afdekking"** (class `windowcoverings`)

| Capability | Mapping |
|---|---|
| `windowcoverings_state` | `up` → `cmd/cover_open`, `idle` → `cmd/cover_stop`, `down` → `cmd/cover_close` |

**Device "Zwembadverlichting"** (class `light`)

| Capability | Mapping |
|---|---|
| `onoff` | `PATCH /lighting` `{"always_active": …}` |
| `button.next_colour` | `cmd/lighting_next` — **alleen bij een RGB-lamp** |
| `button.reset_colour` | `cmd/lighting_reset` — idem |

`spec.lighting_type` staat bij deze installatie op `single`. Op een enkelkleurige
lamp doen beide commando's niets, dus die twee knoppen worden hier niet aangemaakt.

### 4.5 Hoe de tegel eruit ziet

Met echte waarden uit de meting, en de streefwaarden uit de `config`-blokken ernaast:

```
┌────────────────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Zwembad                      ●    │  │  Afdekking       │  │  Verlichting     │
│                                    │  │                  │  │                  │
│   Water         30,2 °C   → 30,5   │  │        ▲         │  │        ◯         │
│   Lucht         21,5 °C            │  │        ■         │  │       uit        │
│   pH             7,18     → 7,20   │  │        ▼         │  │                  │
│   Redox           648 mV  → 975    │  │                  │  │  enkelkleurig,   │
│   Niveau          4,4 cm           │  │   Dicht · 09:21  │  │  geen kleurknop  │
│   Pomp           Uit               │  └──────────────────┘  └──────────────────┘
│   Stroom          0,0 A            │
│                                    │
│   Snelheid  [uit|laag|mid|hoog|max]│
│   Pauze                ◯──         │
│   Backwash          ▸ start        │
└────────────────────────────────────┘
```

De pijl toont de streefwaarde uit `config`. Dat redox ver onder de streefwaarde zit
(648 tegenover 975) is precies het soort afwijking waar een flow op kan triggeren,
zonder dat je die grens ergens in Homey hoeft over te typen.

---

## 5. Flow-kaarten

Hier zit de eigenlijke meerwaarde boven de app van de leverancier: het zwembad
koppelen aan de rest van het huis.

**Triggers (wanneer…)**

- Watertemperatuur is gewijzigd *(standaard, via `measure_temperature`)*
- pH komt buiten bereik — argumenten `min` / `max`
- Redox komt buiten bereik
- Filterpomp is gestart / gestopt
- Pompstatus is gewijzigd — token met de status-naam ("Schema 1", "Vorstbeveiliging", …)
- Afdekking is geopend / gesloten
- **Droogloop-risico gedetecteerd** ⚠️
- Storing gedetecteerd (klepfout / ongeldige status)
- Zwembad is offline / weer online
- Waterniveau wijkt te ver af van het streefniveau

**Condities (en…)**

- Filterpomp draait
- Afdekking is open
- Verlichting is aan
- pH is tussen `x` en `y`
- Controller is gepauzeerd

**Acties (dan…)**

- Afdekking openen / stoppen / sluiten
- Backwash starten
- Shockchlorering starten / stoppen
- Verlichting aan / uit
- Volgende lichtkleur *(alleen bij een RGB-lamp)*
- Filtersnelheid instellen *(uit / laag / midden / hoog / max)*
- Filterschema 1/2/3 in- of uitschakelen
- Controller pauzeren / hervatten

### Voorbeeldflows die dit mogelijk maakt

| Flow | Opbouw |
|---|---|
| **Filter op midden zolang de afdekking open is** — de documentatie noemt dit expliciet als recept, omdat het zwembad het zelf niet kan | *Wanneer* afdekking geopend → *dan* filtersnelheid midden. *Wanneer* afdekking gesloten → *dan* filtersnelheid laag. De app stuurt hiervoor `pump_speed: "medium"` als tekst, niet `2` zoals de documentatie beweert. |
| **Droogloopbeveiliging** | *Wanneer* droogloop-risico → *dan* controller pauzeren + push-melding. |
| **Waterchemie-waarschuwing** | *Wanneer* pH buiten 7,0–7,6 langer dan 2 uur → *dan* melding met de gemeten waarde. |
| **Zwemmen begint** | *Wanneer* knop ingedrukt → afdekking openen, verlichting aan, filter op midden. |
| **Nacht** | *Wanneer* 23:00 → verlichting uit, afdekking sluiten *(alleen met bevestiging, zie §6)*. |
| **Warmteterugwinning** | *Wanneer* watertemperatuur > luchttemperatuur + 5 °C → melding "afdekking sluiten scheelt warmte". |

---

## 6. Veiligheid en betrouwbaarheid

**Afdekking bewegen is een fysieke handeling.** De afdekking kan iemand in het
water beknellen, en `cover_stop` loopt óók via de cloud — het is dus geen
noodstop. Voorstel:

- Een device-instelling **"Bediening afdekking toestaan"**, standaard **uit**. Zolang
  die uit staat is het cover-device alleen-lezen en zijn de flow-acties uitgeschakeld.
- In de beschrijving van elke cover-actie de waarschuwing opnemen dat de lokale
  bediening bereikbaar moet blijven.
- Geen automatische herhaling bij een timeout: het commando kan al ontvangen zijn.
  Dat geldt voor alle `POST /cmd/*`-aanroepen.

**Foutafhandeling per HTTP-status:**

| Status | Betekenis | Gedrag van de app |
|---|---|---|
| 401 | credential ongeldig of verlopen | device op *niet beschikbaar*, plus de repair-flow aanbieden om een nieuw token of de API-key in te voeren ([§4.2](#42-authenticatie-twee-methoden-naast-elkaar)) |
| 403 `missing_scope` | key mist `controls:write` | schrijf-capabilities uitschakelen, rest blijft werken |
| 429 | rate limit | wachten tot `X-RateLimit-Reset`, dan pas verder (zit al in het prototype) |
| 501 | `Unsupported version` | v3-zwembad, of v1 op `GET /pool/{pid}` — nette melding in plaats van een crash |

Het credential staat in de Homey device-store, nooit in de logs. Zowel `spc_…`-keys
als tokens worden uit foutmeldingen gefilterd.

---

## 7. Open punten

Alles wat gemeten kon worden, is gemeten. Wat resteert blokkeert de bouw niet.

### Te regelen

**De `spc_…`-API-key is nog niet ontvangen.** Aan te vragen via
`api-support@smartpoolconnect.eu`, met `pools:read` en `controls:write`, gekoppeld aan
dit zwembad. Tot die er is werkt het OAuth-token uit de browsersessie, maar dat is een
tijdelijke oplossing: het token is geen standaard JWT, draagt geen leesbaar
`exp`-veld, en de vervaldatum is dus niet te voorspellen. Vandaar de dubbele
ondersteuning en de repair-flow uit
[§4.2](#42-authenticatie-twee-methoden-naast-elkaar). Een API-key is volgens de
documentatie een jaar geldig.

### Tijdens het bouwen bevestigen

**Wordt `filter.metrics` ooit gevuld?** Op deze installatie stond het in elke meting op
nul, ook terwijl de pomp volgens `status` draaide — vandaar de feature-detectie in
[§10.4](#104-libmappingjs--de-regels-die-geld-kosten-als-je-ze-fout-doet). Eén meting
op een moment dat de filterpomp hoorbaar draait, geeft uitsluitsel. Blijft
`pump_current` dan 0,0, dan is het veld niet aangesloten en klopt de terugval.

### Onbekend, maar niet nodig

**`lighting.status.status`** neemt de waarden `0`, `1` en `2` aan, waarbij `2` zowel
voorkwam met het licht uit als aan, en `0` eveneens in beide gevallen. Er is geen
aan/uit-betekenis uit af te leiden; mogelijk hangt het samen met de pulsschakeling
(`switch_pulse: 250` op een enkelkleurige lamp), maar dat is speculatie.
`config.always_active` is de bron en klopte in beide richtingen.

**`covco`** staat naast `status` in `cover.status` en bleef in elke meting op `0`, ook
met een commando in de wachtrij. Het is dus geen echo van het laatste commando.

### Opgelost

| Vraag | Antwoord |
|---|---|
| Afdekstatuscodes | `1` open, `2` dicht, `3` openen, `4` sluiten, `5` gestopt |
| `FilterConfig`-schema | opgehaald; `pump_speed` is een **tekst**, geen getal |
| Sondetype | redox in mV; `spec.clm_sensor` is `false`, dus geen ppm |
| Werkt `PATCH`? | ja, heen en terug getest op de verlichting |
| Geldigheid token | niet vast te stellen — geen leesbaar `exp` |
| Looptijd afdekking | ± 180 s, beide richtingen |

---

## 8. Fasering

| Fase | Versie | Inhoud | Vereist |
|---|---|---|---|
| 1 | 0.2.0 | Dubbele authenticatie (key + token) met repair-flow. Uitgebreid lezen: pompsnelheid/-status, motorstroom, redox/chloor gesplitst, droogloop-alarm, storingsalarm, online-detectie. Alle triggers en condities. | niets — kan nu |
| 2 | 0.3.0 | Cover- en light-device, momentane commando's (afdekking, backwash, shock, lichtkleur). | niets — commando's zijn getest |
| 3 | 0.4.0 | Configuratie via read-modify-write: licht aan/uit, pauze, filtersnelheid en -schema's. | niets — schema is opgehaald |
| 4 | 1.0.0 | Afronding: vertalingen, app-store-plaatjes, `homey app validate --level publish` in CI. | — |

**Alle drie de fasen kunnen nu.** Er wacht niets meer op informatie: de commando's
zijn getest, de afdekcodes gemeten, het `FilterConfig`-schema opgehaald en de
hardware-inventaris staat in `spec`. De API-key is nodig voor duurzaam onbeheerd
draaien, niet om te kunnen bouwen of testen.

De dubbele authenticatie met repair-flow zit bewust in fase 1 en niet later. Nu
gebleken is dat de vervaldatum van het token niet te lezen valt, is dat het verschil
tussen een app die te repareren is en een app die op een willekeurig moment stilvalt
en je flows meesleept.

---

## 9. Verhouding tot het bestaande prototype

[`prototypes/smartpoolconnect-homey/`](../prototypes/smartpoolconnect-homey/) is
v0.1.0 en alleen-lezen. De opzet daarvan blijft bruikbaar — de API-client met
rate-limit-afhandeling, de pair-flow en de polling-structuur kunnen rechtstreeks mee.
Wat verandert:

- `lib/api.js` krijgt `postCommand()`, `getConfig()` en `patchConfig()` erbij, en de
  vaste `X-API-Key`-header wordt een `authHeader()` die ook Bearer-tokens aankan.
- De polling verhuist van het device naar een gedeelde poller in `app.js`.
- Er komen twee drivers bij (`cover`, `light`).
- `measure_chlorine` (mV) wordt hernoemd naar `measure_redox`, zodat `measure_chlorine`
  vrijkomt voor een echte ppm-waarde.
- De pair-flow krijgt een keuze tussen key en token, en er komt een repair-flow bij.

De sectie *"Why no write actions yet?"* in de README van dat prototype is
achterhaald. Die stelt dat bediening alleen via `www.smartpoolconnect.eu` met een
sessiecookie kan, maar de API-documentatie beschrijft `POST /pool/{pid}/cmd/{command}`
en `PATCH /pool/{pid}/{module}` gewoon op `api.smartpoolconnect.eu` met `X-API-Key`
plus de `controls:write`-scope. Het CLI-prototype, dat werkt, gebruikt precies die
route. Die README is in dit voorstel meegecorrigeerd.

Het CLI-prototype blijft daarnaast nuttig náást de app: het is de snelste manier om
de open punten uit §7 te beantwoorden (ruwe afdekstatus uitlezen in elke stand, het
`FilterConfig`-schema ophalen, de vervaldatum van het token controleren) zonder
eerst een Homey-app te hoeven bouwen. Het zou daarvoor twee kleine uitbreidingen
kunnen gebruiken: een `config <module>`-commando dat een module-config ruw afdrukt,
en het tonen van de `exp`-datum van het gebruikte token.

---

## 10. Bouwopdracht

Dit hoofdstuk is wat iemand nodig heeft om te beginnen. De hoofdstukken hierboven
leggen uit waarom de keuzes zo liggen; hier staat wat er gemaakt moet worden.

### 10.1 Bestandsindeling

```
app.json                      Manifest: capabilities, drivers, flow-kaarten
app.js                        Houdt de PoolPoller-registry bij
lib/api.js                    API-client: auth, rate limit, lezen en schrijven
lib/poller.js                 Eén gedeelde poll per pool-UUID
lib/mapping.js                Codes → capabilitywaarden, spec → capabilitylijst
drivers/pool/driver.js        Pair-flow; maakt alle drie de devices aan
drivers/pool/device.js        Meetwaarden, alarmen, pompbediening
drivers/cover/device.js       windowcoverings_state
drivers/light/device.js       onoff
drivers/*/pair/*.html         Credentialkeuze → zwembadlijst
drivers/*/repair/*.html       Nieuw token of key invoeren bij 401
locales/en.json, locales/nl.json
```

Plain JavaScript, geen buildstap — zoals het bestaande prototype.

### 10.2 `lib/api.js` — contract

```js
new SmartPoolConnectClient({ credential: { type: 'key' | 'token', value }, baseUrl })

listPools()                        // GET /pool           → items[]
getPool(pid)                       // GET /pool/{pid}     → volledige modules
getModule(pid, module)             // GET /pool/{pid}/{m} → { config, status, metrics }
patchModule(pid, module, config)   // PATCH, volledig config-object op topniveau
setLighting(pid, on)               // PATCH /lighting met { always_active }
sendCommand(pid, command)          // POST /pool/{pid}/cmd/{command}, geen body
```

Eisen aan de implementatie:

- **Eén `authHeader()`** die op basis van `credential.type` `X-API-Key` of
  `Authorization: Bearer` zet. De rest van de client kent het verschil niet.
- **`patchModule` verpakt niet.** `getModule` geeft `{config, status, metrics}`; de
  `PATCH`-body is het kale `config`-object. Een helper
  `readModifyWrite(pid, module, changes)` doet `GET` → samenvoegen → `PATCH` en is de
  enige manier waarop de rest van de app configuratie schrijft.
- **`setLighting` is de uitzondering** en stuurt bewust alleen `{always_active}`.
  Documenteer dat in de code, want het ziet eruit als een fout.
- **Rate limit**: bij `429` of `X-RateLimit-Remaining: 0` wachten tot
  `X-RateLimit-Reset` voor het volgende verzoek.
- **Nooit het credential loggen**, ook niet in foutmeldingen. Filter de waarde uit
  response-bodies voordat die in een `Error` terechtkomt.
- **Geen automatische herhaling na een timeout op een commando.** Het kan al
  ontvangen zijn.

### 10.3 `lib/poller.js` — contract

```js
poller = getPoller(homey, pid, client)
poller.subscribe(device)            // device.onPoolData(pool) bij elke ronde
poller.setInterval(seconds)         // 15–300, standaard 30
poller.refreshAfter('patch')        // extra ronden op 3, 6 en 10 s
poller.refreshAfter('command')      // extra ronden op 10, 20, 30 en 45 s
```

Eén `GET /pool/{pid}` per ronde bedient alle drie de devices. Bij 30 s is dat 2 van de
60 toegestane verzoeken per minuut.

De twee verversingsprofielen zijn niet willekeurig: een `PATCH` is binnen 10 seconden
terug te lezen in `config`, een commando heeft 20 tot 30 seconden nodig. Zie
[§3.3](#33-hoe-lang-duurt-het-voordat-een-wijziging-zichtbaar-is).

Bij `501` op `GET /pool/{pid}` terugvallen op de status uit `GET /pool` in plaats van
het device op onbeschikbaar te zetten — dat is een v1-zwembad.

### 10.4 `lib/mapping.js` — de regels die geld kosten als je ze fout doet

```js
COVER = { 1: 'open', 2: 'closed', 3: 'opening', 4: 'closing', 5: 'stopped' }
// alles anders → 'unknown'

lightingOn(pool)   = pool.lighting.config.always_active          // niet status
waterTemp(pool)    = pool.temperature.metrics.water_temp         // niet main_temp
redox(pool)        = pool.cl.metrics.actual                      // mV, is geen chloor
```

**Pompstand.** `filter.metrics.pump_speed` en `pump_current` stonden op deze
installatie in elke meting op 0, ook terwijl de pomp volgens `status` draaide. Doe
daarom feature-detectie in plaats van één bron hard te kiezen:

```js
// Onthoud per zwembad of metrics ooit van nul afweek.
if (metricsEverNonZero) return metrics.pump_speed > 0;
return status.pump_speed > 0;        // terugval, kan achterlopen
```

**Capabilities aanmaken uit `spec`**, niet uit "is dit veld gevuld":

| Capability | Alleen als |
|---|---|
| `measure_chlorine` (ppm) | `spec.clm_sensor === true` |
| `button.next_colour` | `spec.lighting_type !== 'single'` |
| `measure_water_level` | `spec.wl_sensor === true` |
| `alarm_dryrun` | `spec.flow_alarm === true` |
| cover-device | `spec.deck_enabled === true` |
| light-device | `spec.lighting_enabled === true` |
| `button.backwash` | `spec.backwash_enabled === true` |

### 10.5 Capabilities — klaar voor `app.json`

**Device „Zwembad"** · class `sensor`

| ID | Type | Eenheid | Setable | Bron |
|---|---|---|---|---|
| `measure_temperature` | number | °C | nee | `temperature.metrics.water_temp` |
| `measure_temperature.ambient` | number | °C | nee | `temperature.metrics.ambient_temp` |
| `target_temperature` | number | °C | ja | `temperature.config.target` |
| `measure_ph` | number | pH | nee | `ph.metrics.actual` |
| `measure_redox` | number | mV | nee | `cl.metrics.actual` |
| `measure_chlorine` | number | ppm | nee | `cl.metrics.clm` |
| `measure_water_level` | number | cm | nee | `level.metrics.value` |
| `filter_running` | boolean | — | nee | zie §10.4 |
| `filter_status` | enum (16) | — | nee | `filter.status.pump_status` |
| `filter_speed` | enum | — | ja | `filter.config` via read-modify-write |
| `alarm_dryrun` | boolean | — | nee | afgeleid, zie §2.4 |
| `alarm_fault` | boolean | — | nee | `pump_status` 12 of 15 |
| `onoff.pause` | boolean | — | ja | `spec.pause` |
| `onoff.shock` | boolean | — | ja | `cmd/shock_start`, `shock_stop` |
| `button.backwash` | boolean | — | ja | `cmd/backwash` |

**Device „Afdekking"** · class `windowcoverings` · `windowcoverings_state`
→ `up` = `cmd/cover_open`, `idle` = `cmd/cover_stop`, `down` = `cmd/cover_close`.
Géén `windowcoverings_set`: de API geeft geen standpercentage.

**Device „Zwembadverlichting"** · class `light` · `onoff` → `setLighting()`.

`filter_speed` schrijft `"off"`, `"low"`, `"medium"`, `"high"`, `"max"` — **tekst, geen
getal**, zie [§3.2](#het-filterconfig-schema--en-een-fout-in-de-documentatie).

### 10.6 Acceptatiecriteria per fase

**Fase 1 — lezen** *(geen schrijfrechten nodig)*

- Alle meetwaarden uit §10.5 verschijnen, en capabilities die `spec` uitsluit worden
  niet aangemaakt.
- `homey app validate --level publish` slaagt.
- Eén `GET` per pollronde, aantoonbaar in de log — niet drie.
- Een zwembad dat `501` geeft, blijft beschikbaar met de status uit de lijst.
- Een ongeldig credential zet het device op onbeschikbaar met een leesbare melding, en
  de sleutel staat nergens in de log.

**Fase 2 — commando's**

- Afdekking open, stop en dicht werken; de tegel volgt binnen een minuut.
- Bediening staat standaard uit achter de device-instelling en de flow-acties zijn dan
  geblokkeerd.
- Een afdekking die volledig open is toont `open`, niet blijvend `opening`.
- Na een commando wordt niet automatisch opnieuw verstuurd bij een timeout.

**Fase 3 — configuratie**

- Licht aan/uit via `setLighting`; de andere lichtvelden blijven aantoonbaar ongemoeid.
- Filtersnelheid instellen stuurt de tekstwaarde en alle drie de schema's mee.
- Pauzeren en hervatten werkt via `spec`.

**Fase 4 — afronding**

- Nederlandse en Engelse teksten compleet.
- Flow-kaarten uit §5 aanwezig met tokens.
- App-store-materiaal en CI groen.

### 10.7 Testen zonder zwembad

De installatie hoeft niet vrij te zijn om te ontwikkelen. Leg met
`pool_test.py raw > sample.json` een echt antwoord vast en voed dat aan de
mappinglaag. Juist de lastige gevallen zijn zo te dekken: een bevroren `status`-sectie,
`filter.metrics` op nul, een afdekking die nog `opening` meldt terwijl hij al open is,
en een `spec` waarin `clm_sensor` en `lighting_type` variëren.

Bewegingscommando's alleen uitvoeren met zicht op het zwembad en niemand in het water.
