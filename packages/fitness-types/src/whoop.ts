import { z } from 'zod'
import { UnknownRecordSchema } from './common'

export const WhoopTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string(),
})
export type WhoopTokenResponse = z.infer<typeof WhoopTokenResponseSchema>

export const WhoopStoredTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.string().datetime(),
})
export type WhoopStoredToken = z.infer<typeof WhoopStoredTokenSchema>

export const WhoopCollectionResponseSchema = z.object({
  records: z.array(UnknownRecordSchema),
  next_token: z.string().optional().default(''),
})
export type WhoopCollectionResponse = z.infer<typeof WhoopCollectionResponseSchema>

export const WhoopProfileSchema = UnknownRecordSchema
export type WhoopProfile = z.infer<typeof WhoopProfileSchema>

export const WhoopBodyMeasurementSchema = UnknownRecordSchema
export type WhoopBodyMeasurement = z.infer<typeof WhoopBodyMeasurementSchema>

export const WhoopCycleRecordSchema = UnknownRecordSchema
export type WhoopCycleRecord = z.infer<typeof WhoopCycleRecordSchema>

export const WhoopRecoveryRecordSchema = UnknownRecordSchema
export type WhoopRecoveryRecord = z.infer<typeof WhoopRecoveryRecordSchema>

export const WhoopSleepRecordSchema = UnknownRecordSchema
export type WhoopSleepRecord = z.infer<typeof WhoopSleepRecordSchema>

export const WhoopWorkoutRecordSchema = UnknownRecordSchema
export type WhoopWorkoutRecord = z.infer<typeof WhoopWorkoutRecordSchema>

export const WhoopDataSchema = z.object({
  profile: WhoopProfileSchema,
  body_measurement: WhoopBodyMeasurementSchema,
  cycles: z.array(WhoopCycleRecordSchema),
  recovery: z.array(WhoopRecoveryRecordSchema),
  sleep: z.array(WhoopSleepRecordSchema),
  workouts: z.array(WhoopWorkoutRecordSchema),
})
export type WhoopData = z.infer<typeof WhoopDataSchema>

export const WhoopAuthUrlResponseSchema = z.object({
  url: z.string().url(),
})
export type WhoopAuthUrlResponse = z.infer<typeof WhoopAuthUrlResponseSchema>
