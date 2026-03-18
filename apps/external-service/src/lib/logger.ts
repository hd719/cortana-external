type LogMethod = (...args: unknown[]) => void;

export interface AppLogger {
  log(message: string): void;
  printf(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
}

function formatTemplate(message: string, args: unknown[]): string {
  let index = 0;
  return message.replace(/%[svtd]/g, () => String(args[index++] ?? ""));
}

export function createLogger(prefix: string, sink: LogMethod = console.log): AppLogger {
  const tag = prefix.startsWith("[") ? prefix : `[${prefix}]`;

  return {
    log(message: string) {
      sink(`${tag} ${message}`);
    },
    printf(message: string, ...args: unknown[]) {
      sink(`${tag} ${formatTemplate(message, args)}`);
    },
    error(message: string, error?: unknown) {
      const detail =
        error instanceof Error ? error.message : typeof error === "string" ? error : error ? String(error) : "";
      console.error(detail ? `${tag} ${message}: ${detail}` : `${tag} ${message}`);
    },
  };
}
