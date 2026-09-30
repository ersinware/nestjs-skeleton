/**
 * @file upload-token-payload.type.ts
 * @description Claims binding an upload proof to its owning workflow.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';

/**
 * Upload claims supplied by the owning workflow.
 */
export type UploadTokenPayload = {
    /**
     * Subject authorized by the workflow.
     */
    readonly sub: string;

    /**
     * Unique upload proof identifier.
     */
    readonly jti: string;

    /**
     * Workflow allowed to accept this proof.
     */
    readonly purpose: string;

    /**
     * Server-selected object key.
     */
    readonly fileKey: string;

    /**
     * Form binding computed and checked by the owning domain.
     */
    readonly formHash: string;

    /**
     * Fixed proof expiry in Unix seconds.
     */
    readonly exp: number;

    /**
     * Discriminator separating upload proofs from other credentials.
     */
    readonly type: AuthTokenType.UPLOAD;
};
