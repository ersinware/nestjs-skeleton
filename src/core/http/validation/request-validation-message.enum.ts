/**
 * @file request-validation-message.enum.ts
 * @description Client-safe messages describing HTTP request-validation rejections. Owned by the HTTP validation concern because the effective thrower is the request-validation pipeline, not the shared exception taxonomy.
 */

/**
 * Enum defining the client-safe messages of HTTP request-validation failures, consumed by the
 * `ApiDefaultInvalidRequestResponse` documentation decorator to describe which part of the request
 * failed validation.
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
