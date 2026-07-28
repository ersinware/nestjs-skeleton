/**
 * @file app.exception.ts
 * @description Abstract base of the exception taxonomy, the forensic context an exception may carry, and the predicate classifying a caught error by kind.
 */

import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Forensic detail a thrower attaches for whoever records the failure. Only the origin is typed —
 * the adapter logging the exception is never the origin and cannot recover it. The rest stays
 * free-form so the taxonomy never learns a downstream observability concept.
 */
export type ExceptionContext = {
    /** Name of the class that threw. */
    class: string;

    /** Name of the method that threw. */
    method: string;

    /** Any further detail the thrower considers useful when the failure is investigated. */
    [key: string]: unknown;
};

/**
 * Options accepted by every application exception. Keeps `cause` faithful to its native ES2022
 * meaning — strictly the underlying error — and gives forensic data its own `context` field.
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

/**
 * Reports whether a caught error is a taxonomy failure of the given category, so a caller that
 * treats one category as an expected outcome can tell it apart from everything it must rethrow.
 *
 * Classifies structurally by `kind`, not by `instanceof`: the caller reacts to the CATEGORY, so a
 * renamed subclass, a duplicated module instance, or an error rebuilt from a serialized payload
 * must not silently stop matching. The narrowed type is deliberately `Pick`, not `AppException` —
 * the check only proves `kind` (and `message`, which every matching value carries), so claiming the
 * full class would type-safely expose fields a structural match never had.
 *
 * @param error The caught value, of unknown type as every `catch` binding is
 * @param kind The failure category the caller is prepared to handle
 * @returns True when the error is a taxonomy failure of that category
 */
export function isExceptionOfKind(
    error: unknown,
    kind: ExceptionKind,
): error is Pick<AppException, 'kind' | 'message'> {
    return error !== null && typeof error === 'object' && (error as { kind?: unknown }).kind === kind;
}
