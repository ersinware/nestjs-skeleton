/**
 * @file log-payload.ts
 * @description Base structured log payload class enforcing class and method context on every logger call.
 */

/**
 * Structured payload required for every application log.
 * Enforces that every logger call contains class and method context.
 */
export class LogPayload {
    readonly class: string;
    readonly method: string;
    [key: string]: unknown;

    /**
     * Creates an instance of LogPayload.
     *
     * @param payload The raw log details.
     */
    constructor({
        class: _class,
        method: _method,
        ...rest
    }: { class: string; method: string } & Record<string, unknown>) {
        this.class = _class;
        this.method = _method;
        Object.assign(this, rest);
    }
}
