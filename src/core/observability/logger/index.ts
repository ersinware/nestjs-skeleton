/**
 * @file index.ts
 * @description Public entry point of the logger concern. Nothing outside may import past this barrel.
 */

export { ConnectionLogMessage } from 'src/core/observability/logger/connection-log-message.enum';
export type { LogPayload } from 'src/core/observability/logger/log-payload';
export { LoggerModule } from 'src/core/observability/logger/module';
export { TOKEN_LOGGER_PORT } from 'src/core/observability/logger/port/logger.port';
export type { ILoggerPort } from 'src/core/observability/logger/port/logger.port';
