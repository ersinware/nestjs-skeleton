/**
 * @file resource-not-found.exception.ts
 * @description Custom domain exception indicating a requested resource could not be found.
 */

import { ResourceNotFoundType } from 'src/core/exception/enum/resource-not-found-type.enum';

export class ResourceNotFoundException extends Error {
    constructor(message: string = ResourceNotFoundType.DEFAULT, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
