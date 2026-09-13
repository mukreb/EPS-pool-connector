# 9.3 Configuration

## Overview

This class provides endpoints for **getting, creating, and updating** the
configuration of a pool. Each action ensures that security is maintained either
through user authentication or an API key.

## Endpoints and Methods

- **`GET /publicapi/configuration/`** – Retrieves all configurations for a pool
  identified by its serial number, which must be provided as a parameter.
- **`GET /publicapi/configuration/<pk>/`** – Retrieves a specific configuration
  by its primary key (`pk`), with an optional API key for access.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `serialnumber` | Yes (for listing/creating) | Specifies the serial number of the pool. |
| `api_key` | Optional | An alternative authentication method for users who may not be logged in but possess a valid API key. |

## Methods and URLs

| Method | URL |
|--------|-----|
| `POST` / `PUT` | dictionary (JSON body) |
| `GET` (multiple) | `https://api.Smartpoolcontrol.eu/publicapi/configuration/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key` |
| `GET` (single) | `https://api.Smartpoolcontrol.eu/publicapi/configuration/1/?api_key=valid_key` |

## Examples

List all configurations for a pool:

```
GET https://api.Smartpoolcontrol.eu/publicapi/configuration/?serialnumber=00:14:2D:A8:B1:42&api_key=valid_key
```

Retrieve a single configuration by primary key:

```
GET https://api.Smartpoolcontrol.eu/publicapi/configuration/1/?api_key=valid_key
```
