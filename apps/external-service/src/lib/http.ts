export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonResponse<T>(response: Response, acceptedStatuses: number[] = [200]): Promise<T> {
  const body = await response.text();
  if (!acceptedStatuses.includes(response.status)) {
    throw new HttpError(`HTTP ${response.status}`, response.status, body);
  }

  return JSON.parse(body) as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
