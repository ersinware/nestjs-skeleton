/**
 * @file system.exception.ts
 * @description Exception signalling an unexpected internal system failure, together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of internal system failures.
 */
export enum SystemMessage {
    /**
     * Default internal failure message, deliberately generic so no internal detail leaks to clients.
     */
    DEFAULT = 'An unexpected internal error occurred.',
}

/**
 * Signals an unexpected internal failure with no more specific category.
 */
export class SystemException extends AppException {
    override readonly kind = ExceptionKind.SYSTEM;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying `cause` and any forensic `context`
     */
    constructor(message: string = SystemMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
