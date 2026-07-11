/**
 * @file doc.config.ts
 * @description Configuration for Swagger and Scalar API documentation versioning and metadata.
 */

import { APIVersion, VERSION_1 } from 'src/core/config';

/**
 * Type representing allowed OpenAPI tag names.
 */
type APITag = 'health' | 'auth' | 'user' | 'admin';

/**
 * OpenAPI tag descriptions grouped by tag name and API version.
 */
const TAG_DESCRIPTIONS: Record<APITag, Record<APIVersion, string>> = {
    health: {
        [VERSION_1]: 'System health monitoring.',
    },
    auth: {
        [VERSION_1]: 'Authentication and session operations.',
    },
    user: {
        [VERSION_1]: 'User management and profile operations.',
    },
    admin: {
        [VERSION_1]: 'Administrative operations.',
    },
};

/**
 * OpenAPI configuration details for each active version.
 */
export const VERSION_CONFIG: Record<
    APIVersion,
    {
        title: string;
        description: string;
        tags: Record<APITag, string>;
    }
> = {
    [VERSION_1]: {
        title: 'Skeleton API V1',
        description: 'Core API features.',
        tags: {
            health: TAG_DESCRIPTIONS['health'][VERSION_1],
            auth: TAG_DESCRIPTIONS['auth'][VERSION_1],
            user: TAG_DESCRIPTIONS['user'][VERSION_1],
            admin: TAG_DESCRIPTIONS['admin'][VERSION_1],
        },
    },
};
