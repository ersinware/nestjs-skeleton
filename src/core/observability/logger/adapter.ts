/**
 * @file adapter.ts
 * @description Pino-backed implementation of the logger port; the only place the LogPayload
 * envelope is translated into pino's own call shape.
 */

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { LogPayload } from 'src/core/observability/logger/log-payload';
import { ILoggerPort } from 'src/core/observability/logger/port';

/**
 * Translates the closed log envelope into pino's `(mergingObject, message)` signature.
 *
 * Keeping the translation here — rather than binding the port straight onto a pino logger — is what
 * makes {@link LogPayload}'s guarantees hold: `message` reaches pino as `msg` (so it is greppable as
 * a message rather than as data), and the caller's free-form keys are spread from `data` at the
 * merging object's root without ever being able to originate a reserved key. Writing through
 * `PinoLogger` also keeps `instrumentation-pino` in the path, so `traceId`/`spanId` stay injected.
 */
@Injectable()
export class LoggerAdapter implements ILoggerPort {
    /**
     * Creates an instance of LoggerAdapter.
     *
     * @param pino The request-scoped-aware pino logger provided by nestjs-pino.
     */
    constructor(private readonly pino: PinoLogger) {}

    /**
     * Writes the payload at pino's `info` level.
     */
    log(payload: LogPayload) {
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
     * Flattens the envelope into the object pino merges into the record. `error` is kept under its
     * own key so the configured error serializer picks it up, and is omitted entirely when absent so
     * a level without a cause does not emit a null field.
     *
     * @param payload The envelope to flatten.
     * @returns The object pino merges into the log record.
     */
    private toMergingObject(payload: LogPayload): Record<string, unknown> {
        return {
            class: payload.class,
            method: payload.method,
            error: payload.error,
            ...payload.data,
        };
    }
}
