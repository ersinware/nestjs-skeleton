/**
 * @file service-unavailable-type.enum.ts
 * @description Enum defining the target types of service unavailable failures for 503 Service Unavailable responses.
 */

/**
 * Enum defining the target types of service unavailable failures for 503 Service Unavailable responses.
 */
export enum ServiceUnavailableType {
    /**
     * Default service unavailable message.
     */
    DEFAULT = 'Service or one of its dependencies is unhealthy.',
}
