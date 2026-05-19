export function createHealthyIndicator(description: string): Record<string, unknown> {
    return {
        description,
        type: 'object',
        required: ['status'],
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
        example: { status: 'up' },
    };
}
