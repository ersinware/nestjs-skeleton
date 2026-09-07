/**
 * @file doc.config.ts
 * @description Configuration for Swagger and Scalar API documentation: version metadata, tag
 * descriptions, and document-wide identity (contact, license, servers). All doc-facing text lives
 * here so the generator stays free of project identity.
 */

import { APIVersion, VERSION_1 } from 'src/core/config';

/**
 * Contact block rendered on every generated OpenAPI document.
 */
export const DOC_CONTACT = {
    name: 'API Support',
    url: 'https://example.com/support',
    email: 'support@example.com',
} as const;

/**
 * License block rendered on every generated OpenAPI document.
 */
export const DOC_LICENSE = {
    name: 'MIT',
    url: 'https://opensource.org/licenses/MIT',
} as const;

/**
 * Server entries rendered on every generated OpenAPI document.
 */
export const DOC_SERVERS = [{ url: 'http://localhost:3000', description: 'Development server' }] as const;

/**
 * Type representing allowed OpenAPI tag names.
 */
type APITag = 'health' | 'auth' | 'user' | 'admin' | 'audit-trail';

/**
 * OpenAPI configuration details for each active version. Keyed by APIVersion, so activating a new
 * version fails compilation until its entry — including every tag description — is provided.
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
            health: 'System health monitoring.',
            auth: 'Authentication and session operations.',
            user: 'User management and profile operations.',
            admin: 'Administrative operations.',
            'audit-trail': 'Read-only operator view of the audit trail.',
        },
    },
} as const;
