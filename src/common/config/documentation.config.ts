/**
 * @file documentation.config.ts
 * @description Configuration for Swagger and Scalar API documentation versioning and metadata.
 */

import { APIVersion } from './type/config.type';

export * from './type/config.type';

/**
 * List of API versions currently active and documented.
 */
export const ACTIVE_VERSIONS: APIVersion[] = ['1'];

/**
 * Type representing allowed OpenAPI tag names.
 */
type APITag = 'admin' | 'auth' | 'health' | 'user';

/**
 * OpenAPI tag descriptions grouped by tag name and API version.
 */
const TAG_DESCRIPTIONS: Record<APITag, Record<APIVersion, string>> = {
    health: {
        '1': 'System health monitoring.',
    },
    auth: {
        '1': 'Authentication and session operations.',
    },
    user: {
        '1': 'User management and profile operations.',
    },
    admin: {
        '1': 'Administrative operations.',
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
    '1': {
        title: 'Skeleton API V1',
        description: 'Core API features.',
        tags: {
            health: TAG_DESCRIPTIONS['health']['1'],
            auth: TAG_DESCRIPTIONS['auth']['1'],
            user: TAG_DESCRIPTIONS['user']['1'],
            admin: TAG_DESCRIPTIONS['admin']['1'],
        },
    },
};
