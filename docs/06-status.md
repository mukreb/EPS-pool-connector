# 9.4 Status

This class is used to:

- List info from the **StatusModel**.
- Create and update the Status model **and** the many attached status models.

## Endpoints and Methods

- **`GET /publicapi/status/`** – Retrieves the statuses for a pool identified by
  its serial number, which must be provided in the query parameters.
- **`GET /publicapi/status/<pk>/`** – Retrieves the detailed status of a pool by
  the primary key (`pk`) of the status entry.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `serialnumber` | Yes (for listing/creating) | Specifies the serial number of the pool. |
| `api_key` | Optional | An alternative authentication method for users who may not be logged in but possess a valid API key. |

## Methods and URLs

| Method | URL |
|--------|-----|
| `POST` / `PUT` | dictionary (JSON body) |
| `GET` (multiple) | `https://api.Smartpoolcontrol.eu/publicapi/status/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key` |
| `GET` (single) | `https://api.Smartpoolcontrol.eu/publicapi/status/1/?api_key=valid_key` |

## Examples

List the statuses for a pool:

```
GET https://api.Smartpoolcontrol.eu/publicapi/status/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key
```

Retrieve the detailed status by primary key:

```
GET https://api.Smartpoolcontrol.eu/publicapi/status/1/?api_key=valid_key
```
