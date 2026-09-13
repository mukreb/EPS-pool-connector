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
| Scopes | Sinds 2026-07-08 hard afgedwongen. Nodig: `pools:read`, `controls:read`, `controls:write`. Zonder scope: HTTP 403 met `{"error":"missing_scope", …}`. |
| Rate limit | 60 verzoeken/minuut per key, met `X-RateLimit-Limit/Remaining/Reset` headers. |
| Hardwareversie | Dit zwembad is **v2** (vastgesteld 7 september 2026 via de ingelogde website). v2 = volledige besturing + configuratie. |
| Alle meetwaarden | Eén `GET /pool/{pid}` levert alle modules met `metrics`, `status` en `config`. Dezelfde vorm voor v1/v2/v3 — de API vertaalt v3-firmwaretabellen naar v1/v2-vorm. |

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

⚠️ **De statuscodes van de afdekking staan niet in de documentatie.** Het huidige
prototype gokt `2 = dicht` en `3/4/5 = beweegt`. Dat moet empirisch bevestigd
worden voordat er een stand in de UI getoond wordt — zie [§7](#7-open-punten).

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

### 4.2 Eén gedeelde poller

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

Na elk verstuurd commando doet de poller één extra verfrissing na ~10 seconden, zodat
de tegel snel de werkelijke toestand toont in plaats van alleen de optimistische
waarde.

### 4.3 Capability-overzicht per device

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

### 4.4 Hoe de tegel eruit ziet

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
| 401 | key ongeldig of verlopen | device op *niet beschikbaar* met duidelijke melding |
| 403 `missing_scope` | key mist `controls:write` | schrijf-capabilities uitschakelen, rest blijft werken |
| 429 | rate limit | wachten tot `X-RateLimit-Reset`, dan pas verder (zit al in het prototype) |
| 501 | `Unsupported version` | v3-zwembad, of v1 op `GET /pool/{pid}` — nette melding in plaats van een crash |

De key wordt opgeslagen in de Homey device-store, nooit in de logs. `spc_…`-waarden
worden uit foutmeldingen gefilterd.

---

## 7. Open punten

Dingen die uitgezocht moeten worden voordat dit gebouwd kan worden:

1. **Welk credential gebruikt de Homey-app?** Het CLI-prototype werkt tegen exact
   dezelfde host en endpoints als dit voorstel (`api.smartpoolconnect.eu`,
   `GET /pool`, `GET /pool/{pid}`, `POST /pool/{pid}/cmd/cover_*`), dus de route is
   in de praktijk bewezen. Alleen: dat prototype draait interactief en accepteert
   ook een sessiecookie of OAuth-token uit de browser. Een Homey-app draait
   onbeheerd door en kan niet elke paar uur om een verse cookie vragen — daarvoor is
   een echte `spc_…`-key nodig via `api-support@smartpoolconnect.eu`, met
   `pools:read`, `controls:read` en `controls:write`, gekoppeld aan dit zwembad.
   Te controleren: is de geslaagde CLI-test met een API-key gedaan of met een
   cookie/token? In het eerste geval kan fase 2 direct beginnen.
2. **Statuscodes van de afdekking zijn niet gedocumenteerd.** De aanname
   `2 = dicht`, `3/4/5 = beweegt` in het prototype moet bevestigd worden door de
   ruwe waarde uit te lezen in elke stand (open, dicht, tijdens bewegen).
3. **`lighting.status.status === 1` is ook een aanname.** Waarschijnlijk is
   `lighting.config.always_active` de betrouwbaardere bron voor aan/uit.
4. **Het `FilterConfig`-schema is niet uitgeschreven in de PDF** (het staat achter
   een ingeklapte "Show Schema"). De exacte veldnamen moeten uit een echte
   `GET /pool/{pid}/filter` komen — noodzakelijk, omdat `PATCH` het hele object eist.
5. **Sondetype onbekend**: RX (mV) of CLM (ppm), of allebei.
6. **Eerste schrijfactie testen met zicht op het zwembad.** Begin met `lighting`
   (onschadelijk), niet met de afdekking.
7. **Is de afdekking al daadwerkelijk bewogen via de API?** De README van het
   CLI-prototype vermeldt dat er tot dan toe alleen gelezen was en dat er geen
   bewegingscommando's verstuurd zijn. Als dat inmiddels wél gelukt is, is dat het
   sterkste bewijs dat fase 2 haalbaar is — dan graag de ruwe `cover.status.status`
   bij open, dicht en tijdens bewegen noteren, want daarmee is punt 2 meteen opgelost.

---

## 8. Fasering

| Fase | Versie | Inhoud | Vereist |
|---|---|---|---|
| 1 | 0.2.0 | Uitgebreid lezen: pompsnelheid/-status, motorstroom, redox/chloor gesplitst, droogloop-alarm, storingsalarm, online-detectie. Alle triggers en condities. | alleen leesrechten — kan nu al |
| 2 | 0.3.0 | Cover- en light-device, momentane commando's (afdekking, backwash, shock, lichtkleur). | key met `controls:write` |
| 3 | 0.4.0 | Configuratie via read-modify-write: licht aan/uit, pauze, filtersnelheid en -schema's. | `FilterConfig`-schema bekend |
| 4 | 1.0.0 | Afronding: vertalingen, app-store-plaatjes, `homey app validate --level publish` in CI. | — |

Fase 1 is los bruikbaar en heeft geen nieuwe rechten nodig — dat is het logische
startpunt terwijl de aanvraag voor de schrijf-key loopt.

---

## 9. Verhouding tot het bestaande prototype

[`prototypes/smartpoolconnect-homey/`](../prototypes/smartpoolconnect-homey/) is
v0.1.0 en alleen-lezen. De opzet daarvan blijft bruikbaar — de API-client met
rate-limit-afhandeling, de pair-flow en de polling-structuur kunnen rechtstreeks mee.
Wat verandert:

- `lib/api.js` krijgt `postCommand()`, `getConfig()` en `patchConfig()` erbij.
- De polling verhuist van het device naar een gedeelde poller in `app.js`.
- Er komen twee drivers bij (`cover`, `light`).
- `measure_chlorine` (mV) wordt hernoemd naar `measure_redox`, zodat `measure_chlorine`
  vrijkomt voor een echte ppm-waarde.

De sectie *"Why no write actions yet?"* in de README van dat prototype is
achterhaald. Die stelt dat bediening alleen via `www.smartpoolconnect.eu` met een
sessiecookie kan, maar de API-documentatie beschrijft `POST /pool/{pid}/cmd/{command}`
en `PATCH /pool/{pid}/{module}` gewoon op `api.smartpoolconnect.eu` met `X-API-Key`
plus de `controls:write`-scope. Het CLI-prototype, dat werkt, gebruikt precies die
route. Die README is in dit voorstel meegecorrigeerd.

Het CLI-prototype blijft daarnaast nuttig náást de app: het is de snelste manier om
de open punten uit §7 te beantwoorden (ruwe statuscodes uitlezen, het
`FilterConfig`-schema ophalen) zonder eerst een Homey-app te hoeven bouwen.
