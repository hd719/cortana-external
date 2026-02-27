# @cortana/fitness-client

Typed HTTP client for the local Go fitness service (`http://127.0.0.1:3033`).

## Features

- Typed responses backed by `@cortana/fitness-types` Zod schemas
- Configurable `baseUrl`
- Configurable request timeout
- Unified error type (`FitnessClientError`) with status + body

## Endpoints wrapped

- `GET /whoop/data`
- `GET /tonal/data`
- `GET /tonal/health`
- `GET /auth/url`
- `GET /auth/callback?code=...`
- `GET /health`

## Usage

```ts
import { FitnessClient } from '@cortana/fitness-client'

const client = new FitnessClient({
  baseUrl: 'http://127.0.0.1:3033',
  timeoutMs: 15000,
})

const whoop = await client.getWhoopData()
const tonal = await client.getTonalData()
const health = await client.getHealth()
```
