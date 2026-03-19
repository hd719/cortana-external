import { z } from "zod";

export const HealthTestPayloadSchema = z.object({
  type: z.literal("health_test"),
  deviceId: z.string(),
  deviceName: z.string(),
  sentAt: z.string().datetime(),
  message: z.string(),
});

export const HealthSyncPayloadSchema = z.object({
  type: z.literal("health_sync"),
  deviceId: z.string(),
  deviceName: z.string(),
  sentAt: z.string().datetime(),
  range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  metrics: z.object({
    steps: z.object({ total: z.number() }),
    sleep: z.object({ totalHours: z.number() }),
    restingHeartRate: z.object({ average: z.number() }),
    workouts: z.array(
      z.object({
        activityType: z.string(),
        start: z.string().datetime(),
        end: z.string().datetime(),
        durationMinutes: z.number(),
      }),
    ),
  }),
  appVersion: z.string(),
});

export type HealthTestPayload = z.infer<typeof HealthTestPayloadSchema>;
export type HealthSyncPayload = z.infer<typeof HealthSyncPayloadSchema>;

export interface AppleHealthFactoryConfig {
  APPLE_HEALTH_TOKEN: string;
  APPLE_HEALTH_DATA_DIR: string;
}
