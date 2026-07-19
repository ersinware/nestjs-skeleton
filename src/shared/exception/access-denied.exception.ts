/**
 * @file access-denied.exception.ts
 * @description Exception signalling the caller lacks permission to perform an action, together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of access-denied failures.
 */
export enum AccessDeniedMessage {
    /**
     * Default permission failure message.
     */
    DEFAULT = 'You do not have permission to access or modify this resource.',
}

/**
 * Signals that the caller is authenticated but not permitted to access or modify the resource.
 */
export class AccessDeniedException extends AppException {
    override readonly kind = ExceptionKind.ACCESS_DENIED;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying `cause` and any forensic `context`
     */
    constructor(message: string = AccessDeniedMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
