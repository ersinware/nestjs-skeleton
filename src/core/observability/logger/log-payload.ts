/**
 * @file log-payload.ts
 * @description Closed structured log envelope. Every logger call carries the same reserved fields,
 * and anything else a caller wants to attach is isolated under `data`.
 */

/**
 * Structured payload required for every application log.
 *
 * The envelope is CLOSED — no index signature — so a caller can never write a key pino reserves
 * for itself (`level`, `time`, `pid`, `hostname`, `msg`): `message` is always the message, and
 * free-form keys live only under `data`. Excess-property checking on the literal each call site
 * passes is what enforces the shape.
 */
export type LogPayload = {
    readonly class: string;
    readonly method: string;
    readonly message: string;
    readonly error?: unknown;
    readonly data?: Record<string, unknown>;
};
