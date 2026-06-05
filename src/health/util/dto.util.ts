/**
 * @file dto.util.ts
 * @description Utility functions for constructing health check schema definitions and metadata.
 */

/**
 * Generates Swagger schema metadata for a healthy system component indicator.
 * Used to document indicators that are functioning correctly.
 *
 * @param description Detailed description of the indicator component.
 * @returns Swagger schema definition for a healthy indicator.
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
