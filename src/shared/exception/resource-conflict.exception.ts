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
     * Targets generic resource conflict errors.
     */
    DEFAULT = 'Resource already exists.',
    /**
     * Targets email conflict errors.
     */
    EMAIL_IN_USE = 'Email address is already in use.',
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
     * @param options The underlying `cause` and any forensic `context`
     */
    constructor(message: string = ResourceConflictMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
