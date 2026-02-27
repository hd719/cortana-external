# @cortana/fitness-types

Shared Zod schemas + inferred TypeScript types for the Cortana fitness hybrid stack.

## Includes

- `common.ts` shared envelopes, health/error schemas
- `whoop.ts` Whoop auth/token + `/whoop/data` payload schemas
- `tonal.ts` Tonal auth/token + `/tonal/health`, `/tonal/data`, and cache/workout schemas
- `index.ts` barrel exports

## Usage

```ts
import { WhoopDataSchema, TonalDataResponseSchema } from '@cortana/fitness-types'

const whoop = WhoopDataSchema.parse(await fetch('/whoop/data').then((r) => r.json()))
const tonal = TonalDataResponseSchema.parse(await fetch('/tonal/data').then((r) => r.json()))
```
