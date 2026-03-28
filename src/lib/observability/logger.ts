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

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, nextValue) => {
      if (typeof nextValue === "bigint") {
        return nextValue.toString();
      }

      if (nextValue instanceof Error) {
        return {
          name: nextValue.name,
          message: nextValue.message,
          stack: nextValue.stack,
        };
      }

      if (typeof nextValue === "object" && nextValue !== null) {
        if (seen.has(nextValue)) {
          return "[Circular]";
        }

        seen.add(nextValue);
      }

      return nextValue;
    }) ?? '{"message":"Failed to serialize log entry"}';
  } catch (error) {
    const serializationError =
      error instanceof Error ? error.message : "Failed to serialize log entry";

    return JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      event: "logger_serialization_failure",
      message: "Failed to serialize log entry",
      context: {
        serializationError,
      },
    });
  }
}

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

  const line = safeStringify(entry);

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
