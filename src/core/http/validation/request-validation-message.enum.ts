/**
 * @file request-validation-message.enum.ts
 * @description Client-safe messages for HTTP request-validation rejections. Lives here because the
 * effective thrower is the request-validation pipeline, not the shared exception taxonomy.
 */

/**
 * Names which part of the request failed validation, consumed by the
 * `ApiDefaultInvalidRequestResponse` documentation decorator.
 */
export enum RequestValidationMessage {
    /**
     * Targets validation errors in the request body.
     */
    PAYLOAD = 'Invalid request payload format.',
    /**
     * Targets validation errors in the request parameters.
     */
    PARAM = 'Invalid request parameter format.',
}
