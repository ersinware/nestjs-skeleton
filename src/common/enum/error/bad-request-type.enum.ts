/**
 * @file bad-request-type.enum.ts
 * @description Enum defining the target types of validation failures for 400 Bad Request responses.
 */

/**
 * Enum defining the target types of validation failures for 400 Bad Request responses.
 */
export enum BadRequestType {
    /**
     * Targets validation errors in the request body.
     */
    PAYLOAD = 'Invalid request payload format.',
    /**
     * Targets validation errors in the request parameters.
     */
    PARAM = 'Invalid request parameter format.',
    /**
     * Targets validation errors in both request body and parameters.
     */
    BOTH = 'Invalid request payload or parameter format.',
    /**
     * Targets empty request body payloads.
     */
    EMPTY_BODY = 'Request body must be a non-empty plain object.',
}
