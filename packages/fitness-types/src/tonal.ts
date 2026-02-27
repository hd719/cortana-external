import { z } from 'zod'
import { UnknownRecordSchema } from './common'

export const TonalAuthResponseSchema = z.object({
  id_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
})
export type TonalAuthResponse = z.infer<typeof TonalAuthResponseSchema>

export const TonalStoredTokenSchema = z.object({
  id_token: z.string(),
  refresh_token: z.string().optional(),
  expires_at: z.string().datetime(),
})
export type TonalStoredToken = z.infer<typeof TonalStoredTokenSchema>

export const TonalUserInfoResponseSchema = z.object({
  id: z.string(),
})
export type TonalUserInfoResponse = z.infer<typeof TonalUserInfoResponseSchema>

export const TonalMovementDataSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  movementId: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  reps: z.number().optional(),
  weight: z.number().optional(),
  volume: z.number().optional(),
}).catchall(z.unknown())
export type TonalMovementData = z.infer<typeof TonalMovementDataSchema>

export const TonalWorkoutRecordSchema = z.object({
  id: z.union([z.string(), z.number()]),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
  movements: z.array(TonalMovementDataSchema).optional(),
}).catchall(z.unknown())
export type TonalWorkoutRecord = z.infer<typeof TonalWorkoutRecordSchema>

export const TonalStrengthScoreDataSchema = z.object({
  current: z.array(UnknownRecordSchema),
  history: z.array(UnknownRecordSchema),
})
export type TonalStrengthScoreData = z.infer<typeof TonalStrengthScoreDataSchema>

export const TonalCacheSchema = z.object({
  user_id: z.string(),
  profile: UnknownRecordSchema,
  workouts: z.record(UnknownRecordSchema),
  strength_scores: TonalStrengthScoreDataSchema.nullable(),
  last_updated: z.string().datetime(),
})
export type TonalCache = z.infer<typeof TonalCacheSchema>

export const TonalHealthResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  user_id: z.string().optional(),
  error: z.string().optional(),
  details: z.string().optional(),
})
export type TonalHealthResponse = z.infer<typeof TonalHealthResponseSchema>

export const TonalDataResponseSchema = z.object({
  profile: UnknownRecordSchema,
  workouts: z.record(UnknownRecordSchema),
  workout_count: z.number(),
  strength_scores: TonalStrengthScoreDataSchema.nullable(),
  last_updated: z.string().datetime(),
})
export type TonalDataResponse = z.infer<typeof TonalDataResponseSchema>

export const TonalWorkoutHistorySchema = z.array(TonalWorkoutRecordSchema)
export type TonalWorkoutHistory = z.infer<typeof TonalWorkoutHistorySchema>
