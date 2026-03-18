export interface TonalTokenData {
  id_token: string;
  refresh_token?: string;
  expires_at: string;
}

export interface StrengthScoreData {
  current: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
}

export interface TonalCacheData {
  user_id: string;
  profile: Record<string, unknown>;
  workouts: Record<string, Record<string, unknown>>;
  strength_scores: StrengthScoreData | null;
  last_updated: string;
}

export interface TonalDataResponse {
  profile: Record<string, unknown>;
  workouts: Record<string, Record<string, unknown>>;
  workout_count: number;
  strength_scores: StrengthScoreData | null;
  last_updated: string;
}

export interface TonalHealthResponse {
  status: "healthy" | "unhealthy";
  user_id?: string;
  error?: string;
  details?: string;
}
