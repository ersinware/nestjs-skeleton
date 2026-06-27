/**
 * @file dto.util.ts
 * @description Provides utility functions for constructing health check schema definitions and metadata. Abstracting these helpers prevents clutter in the main DTO files and ensures consistency across OpenAPI documentation.
 */

/**
 * Generates Swagger schema metadata for a healthy system component indicator.
 * Used to cleanly document individual indicators that are functioning correctly without duplicating schema boilerplate.
 *
 * @param description The detailed description of the indicator component
 * @returns A Swagger schema definition detailing a healthy indicator state
 */
export function createHealthyIndicator(description: string): Record<string, unknown> {
    return {
        type: 'object',
        required: ['status'],
        description,
        properties: {
            status: {
                type: 'string',
                description: 'Indicator status',
                example: 'up',
                enum: ['up'],
                minLength: 2,
                maxLength: 2,
            },
        },
        additionalProperties: false,
        minProperties: 1,
        maxProperties: 1,
        example: { status: 'up' },
    };
}
