# 9.2.2 Historical Data

Historical data for a pool.

## Endpoints

- **`GET /publicapi/historicaldata/`** – Lists all historical data for a given
  pool identified by `serialnumber`.
- **`GET /publicapi/historicaldata/<pk>/`** – Retrieves a single historical data
  entry identified by its primary key (`pk`).

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `serialnumber` | Yes (for listing) | The serial number of the pool whose historical data is requested. |
| `api_key` | Optional | An API key for authentication, providing an alternative to logged-in users. |

## Methods and URLs

| Method | URL |
|--------|-----|
| `POST` / `PUT` | dictionary (JSON body) |
| `GET` (multiple) | `https://api.Smartpoolcontrol.eu/publicapi/historicaldata/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key` |
| `GET` (single) | `https://api.Smartpoolcontrol.eu/publicapi/historicaldata/1/?api_key=valid_key` |

## Examples

List the historical data for a pool:

```
GET https://api.Smartpoolcontrol.eu/publicapi/historicaldata/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key
```

Retrieve a single historical data entry by primary key:

```
GET https://api.Smartpoolcontrol.eu/publicapi/historicaldata/1/?api_key=valid_key
```
