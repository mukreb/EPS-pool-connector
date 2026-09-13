# SmartPoolConnect CLI-prototype

Dit is het actuele experiment voor het nieuwe SmartPoolConnect-platform. Start
een terminal in deze map; er zijn geen extra Python-pakketten nodig.

## Test met je SmartPoolConnect-login

De eenvoudigste manier is de sessiecookie plakken:

1. Log in op SmartPoolConnect in Chrome en open ontwikkelaarstools met **Command + Option + I**.
2. Ga naar **Application → Cookies → https://www.smartpoolconnect.eu**.
3. Kopieer de volledige waarde van **connect_session**.
4. Voer in de projectmap `python3 pool_test.py status --cookie` uit.
5. Plak de cookie bij de vraag en druk op Enter. Je ziet tijdens het plakken geen tekens; dat is normaal.

```bash
python3 pool_test.py status --cookie
python3 pool_test.py open --cookie --dry-run
python3 pool_test.py open --cookie
python3 pool_test.py stop --cookie
python3 pool_test.py close --cookie
```

Elke opdracht vraagt opnieuw om de cookie. Het script haalt `tokens.access_token` uit de cookie en stuurt alleen dat token naar de nieuwe API als Bearer-token. Cookie en token worden niet opgeslagen. Plak de cookie bij de verborgen vraag, niet als onderdeel van het shellcommando. Ook `connect_session=...` wordt geaccepteerd. Bij een verlopen sessie log je opnieuw in en kopieer je een verse cookie.

### Cookie bewaren in .env

Om niet steeds te plakken kun je zelf deze regel toevoegen aan `.env` naast het script:

```dotenv
SPC_SESSION_COOKIE=plak-hier-de-volledige-waarde-van-connect_session
```

Daarna werken `python3 pool_test.py status`, `python3 pool_test.py open`, `python3 pool_test.py stop` en `python3 pool_test.py close` zonder extra optie. De expliciete opties `--cookie` en `--token` vragen nog steeds om nieuwe invoer. Zonder die opties is de volgorde: `SPC_ACCESS_TOKEN`, `SPC_SESSION_COOKIE`, `SPC_API_KEY`, `EPS_API_KEY`. Een ongeldige cookie geeft een fout en valt niet terug op een oude key. Een opgeslagen cookie kan verlopen; vervang die dan door een verse cookie. `.env` bevat hiermee een sessiecredential in leesbare tekst; deel of commit het bestand niet.

De API ondersteunt ook een OAuth access token. Met `python3 pool_test.py status --token` kun je dat verborgen invoeren; het script slaat het niet op. Hetzelfde werkt voor `open --token`, `stop --token` en `close --token`. Voer alleen het access token in, zonder `Bearer ` ervoor. Optioneel kun je zelf `SPC_ACCESS_TOKEN=...` in `.env` zetten; dit heeft voorrang op API-keys. Een verlopen token moet worden vervangen; automatisch vernieuwen zit niet in dit testscript.

Op 7 september 2026 is via de ingelogde website vastgesteld dat dit zwembad online is en v2 gebruikt. De browser leest via websessie-endpoints op `www.smartpoolconnect.eu`. Daarna is met expliciete toestemming een directe `GET /pool/{pid}` op `api.smartpoolconnect.eu` uitgevoerd met het OAuth Bearer-token uit de browsersessie: HTTP 200, zwembad online. Het token is niet op schijf opgeslagen.

Inmiddels zijn ook bewegingscommando's verstuurd: met `open` en `close` is de afdekking daadwerkelijk opengegaan en weer dichtgegaan, via `POST /pool/{pid}/cmd/cover_open` en `cover_close` met datzelfde OAuth Bearer-token. Schrijfrechten en fysieke uitvoering zijn daarmee bevestigd voor de afdekking. De overige commando's (`backwash`, `shock_start`/`shock_stop`, `lighting_next`/`lighting_reset`) en de configuratie-endpoints (`PATCH /pool/{pid}/…`) zijn nog niet getest. Er is nog geen `spc_…`-API-key ontvangen, dus deze bevestiging geldt voor het tokenpad; een API-key is niet apart beproefd.

## Commando's

```bash
python3 pool_test.py status
python3 pool_test.py raw
python3 pool_test.py config filter
python3 pool_test.py open --dry-run
python3 pool_test.py open
python3 pool_test.py stop
python3 pool_test.py close
```

`status` toont bewust maar een handvol velden (`pid`, `name`, `version`, `status`, `activity_at`, `cover`). Gebruik `raw` voor het volledige, ongefilterde antwoord van `GET /pool/{pid}` — daar staan ook de modules `ph`, `cl`, `temperature`, `filter` en `lighting` in.

`light on` en `light off` schakelen de verlichting via `PATCH /pool/{pid}/lighting` met `{"always_active": true|false}`. Dit is de eerste schrijfactie in dit script die een body verstuurt. De documentatie staat voor dít endpoint expliciet een kale aan/uit-body toe; andere modules eisen het volledige configuratie-object, dus kopieer deze aanpak niet zomaar naar `filter` of `spec`. Met `--dry-run` zie je de body zonder iets te versturen. Let op: `always_active: false` geeft de besturing terug aan een eventueel ingesteld tijdschema; staat dat uit, dan gaat het licht uit.

`config <module>` haalt de configuratie van één module op via `GET /pool/{pid}/{module}`, bijvoorbeeld `config filter`, `config cover`, `config lighting` of `config spec`. Dat is de manier om de veldnamen te zien die je nodig hebt voor een `PATCH`: die vervangt het hele object, dus je moet elk veld terugsturen.

Bij gebruik van een token of sessiecookie drukt het script de vervaldatum van het token af (het `exp`-veld uit de JWT-payload). Zo weet je hoe lang de sessie nog bruikbaar is in plaats van te moeten afwachten.

> **Let op bij het delen van uitvoer.** `raw` en `config` bevatten gegevens die je waarschijnlijk niet publiek wilt hebben: het pool-UUID, het MAC-adres en de GPS-coördinaten van de installatie. Deel bij het melden van een probleem alleen de veldnamen of vervang de waarden.

`open` opent de afdekking; `close` sluit die. Voer bewegingen uit terwijl je zicht op het zwembad hebt en niemand in het water is. `stop` loopt ook via de cloud en is dus geen directe noodstop; houd de lokale bediening beschikbaar.

Het script leest eerst `.env` naast het script en daarna ook `.env` in de hoofdmap
van de repository. `SPC_MAC` of de bestaande `EPS_SERIAL` wordt gebruikt om via
het MAC-adres precies één pool UUID op te zoeken. De oude SmartPoolControl-key
werkt niet op SmartPoolConnect. Gebruik voor de nieuwe omgeving een sessiecookie,
toegangstoken of nieuwe API-key:

```dotenv
SPC_API_KEY=spc_jouw_sleutel
```

Een SmartPoolConnect-key is aan te vragen via api-support@smartpoolconnect.eu. Vraag `pools:read` en `controls:write`, gekoppeld aan jouw zwembad. Optioneel: `SPC_POOL_ID=...` om rechtstreeks het pool UUID te gebruiken, of `SPC_MAC=...` voor het MAC-adres. Shellvariabelen gaan boven dezelfde variabelen uit `.env`. Sleutels blijven lokaal.

`python3 pool_test.py list` toont de eerste pagina van toegankelijke zwembaden. Je kunt ook `python3 pool_test.py status --pid JOUW-POOL-UUID` gebruiken. `--dry-run` zoekt zo nodig alleen het zwembad op en verstuurt geen bewegingscommando.

Deze test gebruikt de nieuwe API op `https://api.smartpoolconnect.eu`, met `X-API-Key` en een lege `POST /pool/{pid}/cmd/cover_open`, `cover_stop` of `cover_close`. De bestaande `eps`-connector gebruikt de oudere SmartPoolControl-API.

Volgens de aangeleverde JSON/PDF werken deze commando's voor hardware v1/v2; v3 geeft `Unsupported version`. HTTP 200 betekent dat het commando in de wachtrij staat. Pas na synchronisatie kan de afdekking bewegen. Controleer de beweging zelf en lees daarna `status` opnieuw. Een geslaagde test bewijst alleen deze lees- en afdekfuncties, niet de volledige API.

### Gemeten afdekstatuscodes

De documentatie vertaalt de codes in `cover.status.status` niet. Op 13 september 2026 zijn ze vastgesteld door de afdekking te laten bewegen en er status bij uit te lezen:

| Code | Betekenis |
|---|---|
| 2 | Dicht |
| 3 | Aan het openen |
| 4 | Aan het sluiten |
| 5 | Gestopt in tussenstand |

De code voor *volledig open* is nog niet waargenomen; bij die test is halverwege gestopt.

Reken op **20 tot 30 seconden** tussen het versturen van een commando en het moment dat de nieuwe status zichtbaar is. Gebruik `cover.status.timestamp` om te zien of het zwembad echt iets nieuws gemeld heeft: dat veld verspringt pas bij een echte statuswijziging, terwijl `activity_at` bij vrijwel elk verzoek meebeweegt.

Bij een timeout wordt niet automatisch opnieuw verstuurd: het commando kan al ontvangen zijn. HTTP 401 wijst op authenticatie; HTTP 403 op toegang/scopes; HTTP 429 op de verzoeklimiet.
