/**
 * @file dependency-unavailable.exception.ts
 * @description Exception signalling a required dependency (e.g. cache, database) is unreachable, together with its client-safe message vocabulary.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Enum defining the client-safe messages of dependency-unavailable failures.
 */
export enum DependencyUnavailableMessage {
    /**
     * Default dependency unavailable message.
     */
    DEFAULT = 'Service or one of its dependencies is unhealthy.',
}

/**
 * Signals that the service cannot complete the request because one of its dependencies is
 * unreachable. The DEPENDENCY_UNAVAILABLE kind marks the condition as transient and retryable, so
 * protocol adapters render it as such (HTTP 503 in the global filter) rather than as a permanent
 * internal fault.
 */
export class DependencyUnavailableException extends AppException {
    override readonly kind = ExceptionKind.DEPENDENCY_UNAVAILABLE;

    /**
     * Creates the exception.
     *
     * @param message The client-safe description of the failure
     * @param options The underlying `cause` and any forensic `context`
     */
    constructor(message: string = DependencyUnavailableMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
