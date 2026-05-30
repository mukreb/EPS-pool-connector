# 9.5 Settings

## Class Overview

This class facilitates **getting and updating** configuration settings for pools.

- It is essential that the pools already exist in the system before their
  settings can be retrieved or modified.
- Security is enforced through user authentication or an API key, ensuring that
  only authorized poolbuilders or users with a valid API key can access and
  modify settings.

> ⚠️ No new `PoolSettings` can be made yet — the pool has to exist already.

## Endpoints and Methods

- **`GET /publicapi/settings/?serialnumber=<serialnumber>`** – Retrieves the
  settings of a pool specified by its `serialnumber`. This endpoint requires
  either user authentication or a valid `api_key`.
- **`GET /publicapi/settings/<pk>/`** – Retrieves the settings of a pool
  specified by its primary key (`pk`). It also requires user authentication or a
  valid `api_key`.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `serialnumber` | Yes (for listing) | Identifies the pool whose settings are to be retrieved. |
| `api_key` | Optional | Can be used to authenticate the request in lieu of a user session. |

## Methods and URLs

| Method | URL |
|--------|-----|
| `PUT` | dictionary (JSON body) |
| `GET` (multiple) | `https://api.Smartpoolcontrol.eu/publicapi/settings/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key` |
| `GET` (single) | `https://api.Smartpoolcontrol.eu/publicapi/settings/1/?api_key=valid_key` |

## Examples

Retrieve the settings of a pool by serial number:

```
GET https://api.Smartpoolcontrol.eu/publicapi/settings/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key
```

Retrieve the settings of a pool by primary key:

```
GET https://api.Smartpoolcontrol.eu/publicapi/settings/1/?api_key=valid_key
```
