export type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = {
  event: string;
  message: string;
  context?: Record<string, unknown>;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: LogLevel = "info";

function getConfiguredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (!level || !(level in LEVEL_ORDER)) {
    return DEFAULT_LEVEL;
  }

  return level as LogLevel;
}

export function log(level: LogLevel, payload: LogPayload) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[getConfiguredLevel()]) {
    return;
  }

  const entry = {
    level,
    timestamp: new Date().toISOString(),
    event: payload.event,
    message: payload.message,
    ...("context" in payload && payload.context ? { context: payload.context } : {}),
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
