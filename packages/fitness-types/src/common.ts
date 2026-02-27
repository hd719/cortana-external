import { z } from 'zod'

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>

export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[]

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(JsonValueSchema)]),
)

export const UnknownRecordSchema = z.record(z.unknown())
export type UnknownRecord = z.infer<typeof UnknownRecordSchema>

export const ErrorEnvelopeSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
  description: z.string().optional(),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>

export const StatusOkSchema = z.object({
  status: z.literal('ok'),
  message: z.string().optional(),
})
export type StatusOk = z.infer<typeof StatusOkSchema>

export const HealthStatusSchema = z.object({
  status: z.enum(['healthy', 'unhealthy', 'ok']),
  user_id: z.string().optional(),
  error: z.string().optional(),
  details: z.string().optional(),
})
export type HealthStatus = z.infer<typeof HealthStatusSchema>
