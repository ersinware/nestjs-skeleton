/**
 * @file invalid-request.exception.ts
 * @description Custom domain exception indicating an operation was attempted that is invalid in the current state.
 */
import { InvalidRequestType } from 'src/core/exception/invalid-request-type.enum';

export class InvalidRequestException extends Error {
    constructor(message: string = InvalidRequestType.DEFAULT, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
