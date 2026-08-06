/**
 * @file logger.adapter.ts
 * @description Pino-backed implementation of the logger port.
 */

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { LogPayload } from 'src/core/observability/logger/port/logger.port';
import { ILoggerPort } from 'src/core/observability/logger/port/logger.port';

/**
 * Translates the {@link LogPayload} envelope into pino's `(mergingObject, message)` signature —
 * the only place the two shapes meet.
 */
@Injectable()
export class LoggerAdapter implements ILoggerPort {
    /**
     * @param pino The configured pino logger. Writing through it keeps `instrumentation-pino` in
     * the path, so `traceId`/`spanId` stay injected.
     */
    constructor(private readonly pino: PinoLogger) {}

    /**
     * Writes the payload at pino's `info` level.
     */
    info(payload: LogPayload) {
        this.pino.info(this.toMergingObject(payload), payload.message);
    }

    /**
     * Writes the payload at pino's `warn` level.
     */
    warn(payload: LogPayload) {
        this.pino.warn(this.toMergingObject(payload), payload.message);
    }

    /**
     * Writes the payload at pino's `error` level.
     */
    error(payload: LogPayload) {
        this.pino.error(this.toMergingObject(payload), payload.message);
    }

    /**
     * Flattens the envelope for pino. `data` is spread first so the envelope's own keys win over a
     * colliding free-form key; `error` keeps its key so the configured error serializer picks it up.
     *
     * @param payload The envelope to flatten.
     * @returns The object pino merges into the log record.
     */
    private toMergingObject(payload: LogPayload): Record<string, unknown> {
        return {
            ...payload.data,
            class: payload.class,
            method: payload.method,
            ...(payload.error !== undefined && { error: payload.error }),
        };
    }
}
