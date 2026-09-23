/**
 * @file unauthenticated.exception.ts
 * @description Exception signalling the caller is not authenticated or presented invalid credentials, together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of unauthenticated failures.
 */
export enum UnauthenticatedMessage {
    /**
     * Targets invalid or expired tokens. Kept intentionally generic to avoid leaking token type information.
     */
    DEFAULT = 'Invalid or expired token.',
    /**
     * Targets invalid email or password credentials.
     */
    CREDENTIALS = 'Invalid email or password.',
    /**
     * Targets requests missing authentication credentials.
     */
    MISSING_CREDENTIALS = 'Authentication credentials are required.',
}

/**
 * Signals that the caller is not authenticated: credentials are missing, invalid, or the session
 * behind them has been revoked.
 */
export class UnauthenticatedException extends AppException {
    override readonly kind = ExceptionKind.UNAUTHENTICATED;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying cause and optional diagnostic or audit metadata
     */
    constructor(message: string = UnauthenticatedMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
