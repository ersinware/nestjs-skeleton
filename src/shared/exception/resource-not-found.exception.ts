/**
 * @file resource-not-found.exception.ts
 * @description Exception signalling a requested resource could not be found, together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of resource-not-found failures.
 */
export enum ResourceNotFoundMessage {
    /**
     * Default resource not found message.
     */
    DEFAULT = 'Not found.',
}

/**
 * Signals that the requested resource does not exist or is not visible to the caller.
 */
export class ResourceNotFoundException extends AppException {
    override readonly kind = ExceptionKind.RESOURCE_NOT_FOUND;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying cause and optional diagnostic or audit metadata
     */
    constructor(message: string = ResourceNotFoundMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
