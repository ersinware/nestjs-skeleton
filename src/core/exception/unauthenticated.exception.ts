/**
 * @file unauthenticated.exception.ts
 * @description Custom domain exception indicating the user is not authenticated or lacks valid credentials.
 */
import { UnauthenticatedType } from 'src/core/exception/unauthenticated-type.enum';

export class UnauthenticatedException extends Error {
    constructor(message: string = UnauthenticatedType.DEFAULT, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
