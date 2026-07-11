/**
 * @file resource-conflict.exception.ts
 * @description Custom domain exception indicating a conflict in resource state (e.g., duplicate data).
 */
import { ResourceConflictType } from 'src/core/exception/enum/resource-conflict-type.enum';

export class ResourceConflictException extends Error {
    constructor(message: string = ResourceConflictType.DEFAULT, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
