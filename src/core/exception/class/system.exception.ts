/**
 * @file system.exception.ts
 * @description Custom domain exception indicating an unexpected internal system failure.
 */

export class SystemException extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
        this.cause = (cause as { cause?: unknown })?.cause !== undefined ? (cause as { cause?: unknown }).cause : cause;
    }
}
