/**
 * @file resource-conflict.exception.ts
 * @description Exception signalling a conflict with the current state of a resource (e.g. duplicate data), together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of resource-conflict failures.
 */
export enum ResourceConflictMessage {
    /**
     * Targets generic resource conflict errors. Worded to cover every member below, since it is also
     * the documented example wherever an endpoint can conflict for more than one reason.
     */
    DEFAULT = 'The request conflicts with the current state of the resource.',

    /**
     * Targets email conflict errors.
     */
    EMAIL_IN_USE = 'Email address is already in use.',

    /**
     * Targets a lost optimistic-lock race: the row was written by another request between this
     * one's load and save, so its decision was made on stale state and was refused.
     */
    CONCURRENT_MODIFICATION = 'The resource was modified by another request; reload and retry.',
}

/**
 * Signals that the request conflicts with the current state of the resource, such as duplicate data
 * or a lost concurrency race.
 */
export class ResourceConflictException extends AppException {
    override readonly kind = ExceptionKind.RESOURCE_CONFLICT;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying cause and optional diagnostic or audit metadata
     */
    constructor(message: string = ResourceConflictMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
