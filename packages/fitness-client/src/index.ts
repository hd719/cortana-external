import { z } from 'zod'
import {
  ErrorEnvelopeSchema,
  HealthStatusSchema,
  StatusOkSchema,
  TonalDataResponseSchema,
  TonalHealthResponseSchema,
  WhoopAuthUrlResponseSchema,
  WhoopDataSchema,
} from '@cortana/fitness-types'

export interface FitnessClientOptions {
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class FitnessClientError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'FitnessClientError'
    this.status = status
    this.body = body
  }
}

export class FitnessClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: FitnessClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:3033'
    this.timeoutMs = options.timeoutMs ?? 15000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  getWhoopData() {
    return this.request('/whoop/data', WhoopDataSchema)
  }

  getTonalData() {
    return this.request('/tonal/data', TonalDataResponseSchema)
  }

  getTonalHealth() {
    return this.request('/tonal/health', TonalHealthResponseSchema)
  }

  getAuthUrl() {
    return this.request('/auth/url', WhoopAuthUrlResponseSchema)
  }

  getAuthCallback(code: string) {
    return this.request(`/auth/callback?code=${encodeURIComponent(code)}`, StatusOkSchema)
  }

  getHealth() {
    return this.request('/health', HealthStatusSchema)
  }

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

      const raw = await response.json().catch(() => null)

      if (!response.ok) {
        const parsedError = ErrorEnvelopeSchema.safeParse(raw)
        const message = parsedError.success ? parsedError.data.error : `Request failed for ${path}`
        throw new FitnessClientError(message, response.status, raw)
      }

      return schema.parse(raw)
    } catch (error) {
      if (error instanceof FitnessClientError) throw error
      if (error instanceof z.ZodError) {
        throw new FitnessClientError(`Schema validation failed for ${path}: ${error.message}`, 500, error.issues)
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FitnessClientError(`Request timeout after ${this.timeoutMs}ms for ${path}`, 408, null)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
