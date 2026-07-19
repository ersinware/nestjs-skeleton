/**
 * @file app.exception.ts
 * @description Abstract base of the application's exception taxonomy, together with the forensic context an exception may carry. Every domain, application, and infrastructure failure is expressed as a subclass carrying a transport-neutral kind.
 */

import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Free-form detail a thrower attaches so whoever ends up recording the failure knows where it came
 * from and under what circumstances. Only the origin is fixed — `class` and `method` — because a
 * protocol adapter logging the exception is never the origin and cannot recover it. Everything else
 * is the thrower's to choose: no field here names a logging, auditing, or authentication concept, so
 * the taxonomy stays independent of whatever observability stack sits downstream.
 */
export type ExceptionContext = {
    /** Name of the class that threw, preserved because whoever records the failure is not the origin. */
    class: string;

    /** Name of the method that threw, preserved for the same reason as `class`. */
    method: string;

    /** Any further detail the thrower considers useful when the failure is investigated. */
    [key: string]: unknown;
};

/**
 * Options accepted by every application exception. Keeps `cause` faithful to its native ES2022
 * meaning — strictly the underlying error — and gives auxiliary forensic data its own `context`
 * field, so the two are never conflated in one slot.
 */
export type AppExceptionOptions = ErrorOptions & {
    /** Forensic metadata for observability adapters; never rendered to a client. */
    context?: ExceptionContext;
};

/**
 * Base class every application exception extends. Carries a transport-neutral `kind` instead of any
 * protocol status, so throwing code stays ignorant of HTTP (or any other transport) and a single
 * `instanceof AppException` check replaces per-class chains in protocol adapters.
 */
export abstract class AppException extends Error {
    /** The transport-neutral failure category protocol adapters translate into their own status vocabulary. */
    abstract readonly kind: ExceptionKind;

    /** Forensic metadata the thrower attached, consumed by observability adapters only. */
    readonly context?: ExceptionContext;

    /**
     * Creates the exception and names it after the concrete class so logs and stack traces identify
     * the real type without an `instanceof` check.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying `cause` and any forensic `context`
     */
    constructor(message: string, options?: AppExceptionOptions) {
        super(message, options);
        this.name = this.constructor.name;

        if (options?.context) this.context = options.context;
    }
}
