/**
 * @file invalid-input.exception.ts
 * @description Exception signalling input that is invalid or violates a business rule in the current state, together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of invalid-input failures.
 */
export enum InvalidInputMessage {
    /**
     * The transport-neutral fallback when no thrower-owned message applies.
     */
    DEFAULT = 'The provided input is invalid.',

    /**
     * The requested email address is unchanged.
     */
    EMAIL_UNCHANGED = 'The new email address must differ from the current address.',
}

/**
 * Signals that the provided input is malformed or violates a business rule in the current state.
 */
export class InvalidInputException extends AppException {
    override readonly kind = ExceptionKind.INVALID_INPUT;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying cause and optional diagnostic or audit metadata
     */
    constructor(message: string = InvalidInputMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
