# 9.2.1 Realtime Data

Real-time measurement data for a pool.

## Endpoints

- **`GET /publicapi/realtimedata/`** – Realtime measurement of one pool,
  requiring a pool `serialnumber` and an optional `api_key` for access.
- **`GET /publicapi/realtimedata/<pk>/`** – Retrieves a single real-time
  measurement by its primary key (`pk`), with an optional `api_key` for access.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `serialnumber` | Yes (for listing/updating) | The serial number of the pool for which to list or update measurements. |
| `api_key` | Optional | An API key for authentication, providing an alternative to logged-in users. |

## Methods and URLs

| Method | URL |
|--------|-----|
| `POST` / `PUT` | dictionary (JSON body) |
| `GET` (multiple) | `https://api.Smartpoolcontrol.eu/publicapi/realtimedata/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key` |
| `GET` (single) | `https://api.Smartpoolcontrol.eu/publicapi/realtimedata/1/?api_key=valid_key` |

## Examples

List the realtime data for a pool:

```
GET https://api.Smartpoolcontrol.eu/publicapi/realtimedata/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key
```

Retrieve a single realtime measurement by primary key:

```
GET https://api.Smartpoolcontrol.eu/publicapi/realtimedata/1/?api_key=valid_key
```
