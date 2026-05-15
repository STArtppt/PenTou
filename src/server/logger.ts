/**
 * logger.ts
 * Minimal structured logger. No third-party deps; writes single-line records to
 * stdout/stderr. Format: `<ISO> <level> <message>`.
 */
const LEVEL_ORDER: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const CURRENT_LEVEL = LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info;

function fmt(level: string, msg: string): string {
  return `${new Date().toISOString()} ${level} ${msg}`;
}

export const log = {
  debug(msg: string): void {
    if (CURRENT_LEVEL <= LEVEL_ORDER.debug) console.log(fmt("debug", msg));
  },
  info(msg: string): void {
    if (CURRENT_LEVEL <= LEVEL_ORDER.info) console.log(fmt("info", msg));
  },
  warn(msg: string): void {
    if (CURRENT_LEVEL <= LEVEL_ORDER.warn) console.warn(fmt("warn", msg));
  },
  error(msg: string): void {
    if (CURRENT_LEVEL <= LEVEL_ORDER.error) console.error(fmt("error", msg));
  },
};
