# Voorstel: Homey-app voor het EPS-zwembad

Dit document beschrijft hoe een volwaardige Homey-app voor het zwembad eruit kan
zien: welke waarden uitleesbaar zijn, welke bediening mogelijk is, en hoe dat het
beste op Homey-begrippen (devices, capabilities, flow-kaarten) te mappen valt.

Het is een **ontwerpvoorstel**, geen implementatie. Basis is de aangeleverde
[SmartPoolConnect API-documentatie](../reference/smartpoolconnect/SmartPoolConnect%20API%20Docs.pdf)
(v1.0.0, OpenAPI 3.1.0) plus wat er al staat in
[`prototypes/smartpoolconnect-homey/`](../prototypes/smartpoolconnect-homey/) en
[`prototypes/smartpoolconnect-cli/`](../prototypes/smartpoolconnect-cli/).

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
- **De afdekstatuscodes zijn gemeten** door tijdens die beweging status uit te lezen,
  zie [§2.5](#statuscodes-van-de-afdekking--gemeten-niet-gedocumenteerd).
- **Een commando doet er 20 tot 30 seconden over** voordat het in de status zichtbaar
  is. Dat is bepalend voor hoe de app na een commando moet verversen.
- **Het gebruikte credential is een OAuth-token uit de browsersessie**, niet een
  `spc_…`-API-key. Die key is nog niet door de leverancier verstrekt.

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
CLM-sondes vullen `clm` (ppm). Welke van de twee dit zwembad heeft, is nog niet
vastgesteld — de app moet de capability pas toevoegen als het veld daadwerkelijk
een getal bevat, en niet blind beide tonen.

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

### 2.5 Afdekking, verlichting, controller

| Waarde | API-pad | Capability |
|---|---|---|
| Afdekstand | `cover.status.status` | `windowcoverings_state` op het cover-device |
| Verlichting aan | `lighting.config.always_active` (en/of `lighting.status.status`) | `onoff` op het licht-device |
| Controller gepauzeerd | `GET /pool/{pid}/spec` → `pause` | `onoff.pause` |
| Online/offline | `GET /pool` → `status` + `activity_at` | `setAvailable()` / `setUnavailable()` |

#### Statuscodes van de afdekking — gemeten, niet gedocumenteerd

Deze codes staan nergens in de PDF. Ze zijn op 13 september 2026 vastgesteld door
de afdekking te laten bewegen en er `cover.status.status` bij uit te lezen:

| Code | Betekenis | Hoe vastgesteld |
|---|---|---|
| 2 | Dicht | beginstand, afdekking lag dicht |
| 3 | Aan het openen | direct na `cmd/cover_open` |
| 4 | Aan het sluiten | direct na `cmd/cover_close` |
| 5 | Gestopt in tussenstand | na `cmd/cover_stop` halverwege het openen |

**De code voor volledig open is nog onbekend**: bij deze test is de afdekking
halverwege gestopt en daarna weer gesloten, dus die eindstand is niet bereikt.
Waarschijnlijk 0, 1 of 6, maar dat is een gok tot iemand het meet.

> Hier zit een fout in het bestaande prototype: dat rekent `5` bij *beweegt*. Een
> afdekking die halverwege is gestopt blijft dan eindeloos "beweegt" tonen, terwijl
> hij juist stilstaat. Dat is inmiddels gecorrigeerd.

Voor de app betekent dit vier zinvolle standen in plaats van twee: `closed`,
`opening`, `closing` en `stopped`, plus `open` zodra die code bekend is. Een stand
die stilstaat maar niet dicht is, is precies het geval waar je een flow op wilt
kunnen bouwen ("afdekking staat al een uur halfopen").

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
| Filtersnelheid & schema's | `PATCH /pool/{pid}/filter` | volledig `FilterConfig`-object |
| Pompgedrag bij afdekking | `PATCH /pool/{pid}/cover` | volledig `CoverConfig`-object |

Twee dingen die de documentatie nadrukkelijk waarschuwt en die makkelijk fout gaan:

- **Licht aan/uit is géén commando.** `lighting_next` / `lighting_reset` wisselen
  alleen de RGB-kleur en doen niets op een enkelkleurige lamp. Aan/uit loopt via
  `PATCH /lighting` met `always_active`. `false` geeft de besturing terug aan een
  eventueel tijdschema.
- **`PATCH /cover` beweegt de afdekking niet.** Dat endpoint configureert alleen
  hoe de pomp op de afdekking reageert. Bewegen gaat via `cmd/cover_*`.

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

**Omgaan met een verlopend token.** Dat het token al dagen ongewijzigd is, betekent
niet dat het onbeperkt geldig is — een JWT draagt zijn eigen vervaldatum mee in het
`exp`-veld van de payload. Die is zonder sleutel uit te lezen: het middelste deel van
het token is base64, en daar staat een Unix-tijdstempel in. Zo weet je precies hoe
lang je nog hebt in plaats van te moeten afwachten.

De app doet daar drie dingen mee:

1. **Bij het koppelen** het `exp`-veld uitlezen en de vervaldatum tonen, zodat
   meteen duidelijk is of dit een token van een dag of van een half jaar is.
2. **Ruim van tevoren waarschuwen** — een Homey-melding een paar dagen voor de
   vervaldatum, in plaats van een zwembad dat op een onbewaakt moment stilvalt.
3. **Een repair-flow** (`"repair"` naast `"pair"` in `app.json`). Als de API 401
   teruggeeft, gaat het device op *niet beschikbaar* met de melding "token verlopen —
   open Reparatie om een nieuw token te plakken". Je hoeft het device dan niet
   opnieuw toe te voegen en je flows blijven intact.

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
keer. Uit de metingen blijkt namelijk dat een commando er **20 tot 30 seconden** over
doet voordat het in de status zichtbaar is — `cmd/cover_stop` werd pas ruim 30
seconden later zichtbaar, `cmd/cover_close` na ruim 23 seconden. Dat past bij wat de
documentatie zegt: het zwembad voert het commando uit "bij de volgende synchronisatie".

Eén verfrissing na 10 seconden zou de oude waarde teruglezen en de tegel laten
terugklappen. Beter is een reeks op ongeveer 5, 15, 30 en 45 seconden, die stopt zodra
`cover.status.timestamp` verspringt — dat veld is de betrouwbare indicatie dat het
zwembad echt iets nieuws gemeld heeft, en niet dat de app alleen opnieuw gekeken heeft.

### 4.4 Capability-overzicht per device

**Device "Zwembad"** (class `sensor`)

| Capability | Soort | Bediening |
|---|---|---|
| `measure_temperature` | water °C | lezen |
| `measure_temperature.ambient` | lucht °C | lezen |
| `measure_ph` | pH | lezen |
| `measure_redox` | mV | lezen |
| `measure_chlorine` | ppm (als aanwezig) | lezen |
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
| `button.next_colour` | `cmd/lighting_next` |
| `button.reset_colour` | `cmd/lighting_reset` |

### 4.5 Hoe de tegel eruit ziet

```
┌──────────────────────────────────┐   ┌─────────────────┐  ┌─────────────────┐
│  Zwembad                     ●   │   │  Afdekking      │  │  Verlichting    │
│                                  │   │                 │  │                 │
│   Water        26,4 °C           │   │      ▲          │  │       ◯         │
│   Lucht        19,1 °C           │   │      ■          │  │                 │
│   pH            7,18             │   │      ▼          │  │   Volgende      │
│   Redox          712 mV          │   │                 │  │   kleur   ▸     │
│   Pomp     Schema 1 · midden     │   │   Open · 13:04  │  │                 │
│   Stroom        1,8 A            │   └─────────────────┘  └─────────────────┘
│                                  │
│   Snelheid  [uit|laag|▣|hoog|max]│
│   Pauze              ◯──         │
│   Backwash        ▸ start        │
└──────────────────────────────────┘
```

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
- Volgende lichtkleur
- Filtersnelheid instellen *(uit / laag / midden / hoog / max)*
- Filterschema 1/2/3 in- of uitschakelen
- Controller pauzeren / hervatten

### Voorbeeldflows die dit mogelijk maakt

| Flow | Opbouw |
|---|---|
| **Filter op midden zolang de afdekking open is** — de documentatie noemt dit expliciet als recept, omdat het zwembad het zelf niet kan | *Wanneer* afdekking geopend → *dan* filtersnelheid midden. *Wanneer* afdekking gesloten → *dan* filtersnelheid laag. |
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

Dingen die uitgezocht moeten worden. Geen ervan blokkeert de bouw nog — lezen én
bedienen zijn inmiddels in de praktijk bewezen (zie [§1](#wat-er-inmiddels-praktisch-bewezen-is)).

1. **De `spc_…`-API-key is nog niet ontvangen.** Aan te vragen via
   `api-support@smartpoolconnect.eu`, met `pools:read` en `controls:write`,
   gekoppeld aan dit zwembad. Tot die er is werkt het OAuth-token,
   maar dat is een tijdelijke oplossing — vandaar de dubbele ondersteuning en de
   repair-flow uit [§4.2](#42-authenticatie-twee-methoden-naast-elkaar).
2. **Hoe lang is het huidige token geldig?** Het is al dagen ongewijzigd, maar dat
   zegt op zichzelf niets: de vervaldatum staat in het `exp`-veld van het token zelf
   en is zonder sleutel uit te lezen. Dat één keer controleren scheelt gokken over
   hoe urgent de key-aanvraag is.
3. ~~Statuscodes van de afdekking zijn niet gedocumenteerd.~~ **Opgelost**, op één
   punt na: `2` dicht, `3` openen, `4` sluiten, `5` gestopt in tussenstand. De code
   voor *volledig open* is nog niet gezien, omdat de test halverwege is gestopt.
   Eén keer helemaal open laten lopen en de status aflezen, dan is ook dat rond.
4. **`lighting.status.status === 1` is ook een aanname.** Waarschijnlijk is
   `lighting.config.always_active` de betrouwbaardere bron voor aan/uit.
5. **Het `FilterConfig`-schema is niet uitgeschreven in de PDF** (het staat achter
   een ingeklapte "Show Schema"). De exacte veldnamen moeten uit een echte
   `GET /pool/{pid}/filter` komen — noodzakelijk, omdat `PATCH` het hele object eist.
6. **Sondetype onbekend**: RX (mV) of CLM (ppm), of allebei. Af te lezen met
   `pool_test.py raw`, dat nu ook de modules `ph`, `cl`, `temperature` en `filter`
   toont die `status` wegfilterde.
8. **Wat is `covco`?** Dat veld staat naast `status` in `cover.status` en bleef op `0`
   staan, ook met een commando in de wachtrij. Het is dus geen echo van het laatste
   commando. Onbekend, en voorlopig niet nodig.
7. **Eerste `PATCH` testen met zicht op het zwembad.** De momentane commando's zijn
   getest, de configuratie-endpoints nog niet. Begin daar met `lighting`
   (onschadelijk en direct zichtbaar), niet met `filter` of `spec`.

---

## 8. Fasering

| Fase | Versie | Inhoud | Vereist |
|---|---|---|---|
| 1 | 0.2.0 | Dubbele authenticatie (key + token) met repair-flow. Uitgebreid lezen: pompsnelheid/-status, motorstroom, redox/chloor gesplitst, droogloop-alarm, storingsalarm, online-detectie. Alle triggers en condities. | niets — kan nu |
| 2 | 0.3.0 | Cover- en light-device, momentane commando's (afdekking, backwash, shock, lichtkleur). | niets — commando's zijn getest |
| 3 | 0.4.0 | Configuratie via read-modify-write: licht aan/uit, pauze, filtersnelheid en -schema's. | `FilterConfig`-schema bekend |
| 4 | 1.0.0 | Afronding: vertalingen, app-store-plaatjes, `homey app validate --level publish` in CI. | — |

Fase 1 en 2 kunnen allebei nu al, met het bestaande token — de key is nodig voor
duurzaam onbeheerd draaien, niet om te kunnen bouwen of testen. De dubbele
authenticatie zit bewust in fase 1 en niet later: het is het verschil tussen een app
die blijft werken als het token verloopt en een app die dan stilletjes stopt.

Alleen fase 3 wacht echt ergens op, en dat is met één `GET /pool/{pid}/filter` uit de
weg geruimd.

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
