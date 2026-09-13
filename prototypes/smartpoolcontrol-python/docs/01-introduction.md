# 9.1 Introduction

## 9.1.1 Overview

The PoolBuilder Public API provides developers with a flexible and powerful
interface to interact with pool data within the PoolBuilder system. This
documentation is designed to guide developers on how to efficiently use the API
to **list, retrieve, create, and update** pool-related data.

The API is structured to support multiple operations across various endpoints,
each tailored to specific aspects of pool management such as:

- real-time data
- historical data
- configuration
- status
- settings

## 9.1.2 API Key Management

- **`api_key`** – A secret API key required for authentication. It can be
  requested by emailing [support@epsbv.eu](mailto:support@epsbv.eu).
- **`api_key` expiration** – Defines the duration for which the API key remains
  valid. A key is valid for **1 year** from the moment it is requested. A key
  can be prolonged by requesting it again via
  [support@epsbv.eu](mailto:support@epsbv.eu).
- **`api_max_per_day`** – The maximum number of API requests allowed per day
  (default is **1 request per second**).

> ⚠️ **Don't use the API unnecessarily.** The maximum number of requests per day
> is there to prevent overuse and to protect the server.

## 9.1.3 Authentication and Security

- All requests must include an `api_key` for authentication **unless** the
  poolbuilder is already logged in.
- Access is limited to the data associated with the poolbuilder's own pools.
- **Rate limiting** is enforced on API calls to prevent abuse.
