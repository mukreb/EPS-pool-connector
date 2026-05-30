# 9.2 API Endpoints Overview

This section explains the general URL logic that applies to **all** public API
resources (realtime data, historical data, configuration, status and settings).

## URL logic

A **single** pool / measurement / historical-data entry is always addressed with
its number (database id) at the end of the URL:

```
https://api.Smartpoolcontrol.eu/publicapi/realtimedata/1/
```

To get the **list** of all pool measurements, simply leave out the number:

```
http://api.Smartpoolcontrol.eu/publicapi/realtimedata/
```

A `GET` request (to get a pool) must include all the required variables
(`api_key`, `serialnumber`) in the link:

```
http://api.Smartpoolcontrol.eu/publicapi/realtimedata/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key
```

> The same logic applies to **Historicaldata**, **Configuration**, **Status**
> and **Settings**.

## HTTP methods

| Method | Purpose | Body |
|--------|---------|------|
| `GET` | Retrieve data (list or single item) | – |
| `POST` | Create a new entry | dictionary (JSON) |
| `PUT` | Update an existing entry | dictionary (JSON) |

## Common parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `serialnumber` | Yes (for list/create) | The serial number of the pool, e.g. `00:14:2D:A8:B1:42`. |
| `api_key` | Optional | An API key for authentication, providing an alternative to logged-in users. |
