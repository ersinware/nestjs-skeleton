/**
 * @file upload-token.ts
 * @description Shared upload proof payload contract parameterized by module-owned workflow token type.
 */

import type { TokenPayload } from 'src/core/security/token';

/**
 * Dependency injection token for signing and verifying {@link UploadTokenPayload}.
 */
export const TOKEN_UPLOAD_TOKEN_PORT = Symbol();

/**
 * Signed upload claims supplied by the owning workflow; upload workflow separation uses `type` directly.
 */
export type UploadTokenPayload<TType extends string = string> = TokenPayload<TType> & {
    /**
     * Subject authorized by the owning upload workflow.
     */
    readonly sub: string;

    /**
     * Unique upload proof identifier.
     */
    readonly jti: string;

    /**
     * Server-selected object key.
     */
    readonly fileKey: string;

    /**
     * Form binding computed and verified by the owning workflow.
     */
    readonly formHash: string;

    /**
     * Fixed proof expiry in Unix seconds.
     */
    readonly exp: number;
};
