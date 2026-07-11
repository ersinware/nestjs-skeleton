/**
 * @file access-denied.exception.ts
 * @description Custom domain exception indicating the user does not have permission to perform an action.
 */
import { AccessDeniedType } from 'src/core/exception/enum/access-denied-type.enum';

export class AccessDeniedException extends Error {
    constructor(message: string = AccessDeniedType.DEFAULT, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
