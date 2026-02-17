import { env } from "./env";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = env.NODE_ENV === "production" ? "info" : "debug";

export function setLogLevel(level: LogLevel) {
  currentLogLevel = level;
}

function formatLog(entry: LogEntry): string {
  const { timestamp, level, message } = entry;
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

export function log(level: LogLevel, message: string, data?: unknown) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };

  const formatted = formatLog(entry);

  switch (level) {
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => log("debug", message, data),
  info: (message: string, data?: unknown) => log("info", message, data),
  warn: (message: string, data?: unknown) => log("warn", message, data),
  error: (message: string, data?: unknown) => log("error", message, data),
};

export function logRequest(
  method: string,
  path: string,
  userId?: string,
  statusCode?: number,
  duration?: number
) {
  const level = statusCode && statusCode >= 400 ? "warn" : "info";
  log(level, `${method} ${path}`, {
    userId,
    statusCode,
    duration: duration ? `${duration}ms` : undefined,
  });
}
