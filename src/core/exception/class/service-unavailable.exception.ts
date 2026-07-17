/**
 * @file service-unavailable.exception.ts
 * @description Custom exception indicating a required dependency (e.g. cache) is unreachable, mapped to HTTP 503.
 */
import { ServiceUnavailableType } from 'src/core/exception/enum/service-unavailable-type.enum';

/**
 * Signals that the service cannot complete the request because one of its dependencies is unhealthy.
 * The global filter renders this as HTTP 503 so clients (and load balancers) treat it as a transient,
 * retryable condition rather than a permanent 500 fault.
 */
export class ServiceUnavailableException extends Error {
    constructor(message: string = ServiceUnavailableType.DEFAULT, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
