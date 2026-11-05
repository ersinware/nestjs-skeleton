/**
 * @file api-idempotency-key.decorator.ts
 * @description Swagger decorator documenting the required idempotency key header.
 */

import { ApiHeader } from '@nestjs/swagger';

/**
 * Documents the UUID v4 key and its retry and fingerprint-conflict semantics.
 *
 * @returns A decorator applying the required header metadata to a controller or method.
 */
export function ApiIdempotencyKey(): MethodDecorator & ClassDecorator {
    return ApiHeader({
        name: 'Idempotency-Key',
        required: true,
        description:
            'Random UUID v4. Reuse for retries of this logical request; use a new key for a new operation. A different fingerprint with the same key returns 409.',
        schema: {
            type: 'string',
            format: 'uuid',
        },
        example: 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f',
    });
}
