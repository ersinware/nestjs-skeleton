/**
 * @file app.exception.ts
 * @description Abstract base of the exception taxonomy, optional diagnostic and audit metadata, and predicates classifying caught errors.
 */

import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Forensic detail a thrower attaches for whoever records the failure. Only the origin is typed —
 * the adapter logging the exception is never the origin and cannot recover it. The rest stays
 * free-form for diagnostics and separate from refusal audit metadata.
 */
export type ExceptionContext = {
    /**
     * Name of the class that threw.
     */
    readonly class: string;

    /**
     * Name of the method that threw.
     */
    readonly method: string;

    /**
     * Any further detail the thrower considers useful when the failure is investigated.
     */
    readonly [key: string]: unknown;
};

/**
 * Options accepted by every application exception. Keeps `cause` faithful to its native ES2022
 * meaning — strictly the underlying error — and keeps forensic and audit data separate.
 */
export type AppExceptionOptions = ErrorOptions & {
    /**
     * Forensic metadata for observability adapters; never rendered to a client.
     */
    readonly context?: ExceptionContext;

    /**
     * Stable reason the handling boundary must record before returning a refusal.
     */
    readonly auditReason?: string;
};

/**
 * Base class every application exception extends. Carries a transport-neutral `kind` instead of any
 * protocol status, so throwing code stays ignorant of HTTP (or any other transport) and a single
 * `instanceof AppException` check replaces per-class chains in protocol adapters.
 */
export abstract class AppException extends Error {
    /**
     * The transport-neutral failure category protocol adapters translate into their own status vocabulary.
     */
    abstract readonly kind: ExceptionKind;

    /**
     * Forensic metadata the thrower attached, consumed by observability adapters only.
     */
    readonly context?: ExceptionContext;

    /**
     * Stable refusal reason for audit; absent when no refusal audit is required.
     */
    readonly auditReason?: string;

    /**
     * Creates the exception and names it after the concrete class so logs and stack traces identify
     * the real type without an `instanceof` check.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying `cause`, forensic `context`, and optional audit reason
     */
    constructor(message: string, options?: AppExceptionOptions) {
        super(message, options);
        this.name = this.constructor.name;

        if (options?.context) {
            this.context = options.context;
        }

        if (options?.auditReason) {
            this.auditReason = options.auditReason;
        }
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
 * full class would expose fields a structural match never proved.
 *
 * @param error The caught value, of unknown type as every `catch` binding is
 * @param kind The failure category the caller is prepared to handle
 * @returns True when the error is a taxonomy failure of that category
 */
export function isExceptionOfKind(
    error: unknown,
    kind: ExceptionKind,
): error is Pick<AppException, 'kind' | 'message'> {
    return error != null && typeof error === 'object' && (error as { readonly kind?: unknown }).kind === kind;
}

/**
 * Identifies a taxonomy exception carrying a refusal reason for audit, regardless of its kind.
 * A structural match proves only the fields the caller needs, without relying on `instanceof`.
 *
 * @param error The caught value
 * @returns True when the kind is recognized and the audit reason is a string
 */
export function isExceptionWithAuditReason(
    error: unknown,
): error is Pick<AppException, 'kind'> & { readonly auditReason: string } {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as { readonly kind?: unknown; readonly auditReason?: unknown };

    return (
        Object.values(ExceptionKind).some((kind) => kind === candidate.kind) &&
        typeof candidate.auditReason === 'string'
    );
}
