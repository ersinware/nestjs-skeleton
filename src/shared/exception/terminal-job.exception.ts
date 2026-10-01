/**
 * @file terminal-job.exception.ts
 * @description Defines job failures that require intervention instead of automatic retries.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';
import { SystemMessage } from 'src/shared/exception/system.exception';

/**
 * Signals an unrecoverable job failure for the queue boundary to settle terminally.
 */
export class TerminalJobException extends AppException {
    override readonly kind = ExceptionKind.TERMINAL_JOB;

    /**
     * Creates an actionable failure while retaining its underlying cause.
     *
     * @param message Diagnostic description masked at HTTP boundaries
     * @param options Underlying cause and optional diagnostic or audit metadata
     */
    constructor(message: string = SystemMessage.DEFAULT, options?: AppExceptionOptions) {
        super(message, options);
    }
}
