/**
 * @file log-payload.ts
 * @description Closed structured log envelope. Every logger call carries the same four reserved
 * fields, and anything else a caller wants to attach is isolated under `data`.
 */

/**
 * Structured payload required for every application log.
 *
 * The envelope is CLOSED — there is no index signature — and that is what it exists for. An open
 * envelope let a caller write a key pino reserves for itself (`level`, `time`, `pid`, `hostname`,
 * `msg`), silently overwriting it and misclassifying the line downstream, with no compiler warning.
 * It also let each producer invent its own shape, so a human-readable string landed in `message`
 * for one caller and in `error` for another while pino's own message field, `msg`, stayed empty.
 * Here `message` is always the message and free-form keys can only ever live under `data`, so a
 * collision with a reserved key is structurally impossible.
 */
export class LogPayload {
    readonly class: string;
    readonly method: string;
    readonly message: string;
    readonly error?: unknown;
    readonly data?: Record<string, unknown>;

    /**
     * Creates an instance of LogPayload.
     *
     * @param payload The raw log details.
     */
    constructor(payload: {
        class: string;
        method: string;
        message: string;
        error?: unknown;
        data?: Record<string, unknown>;
    }) {
        this.class = payload.class;
        this.method = payload.method;
        this.message = payload.message;
        this.error = payload.error;

        if (payload.data) this.data = payload.data;
    }
}
