/**
 * @file auth-policy.ts
 * @description Resolution of controller and route access policies.
 */

import type { Reflector } from '@nestjs/core';
import { KEY_DECORATOR_PERMISSIONS } from 'src/core/security/auth/decorator/permissions.decorator';
import { KEY_DECORATOR_PRINCIPAL_ONLY } from 'src/core/security/auth/decorator/principal-only.decorator';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import type { Permission, PrincipalType } from 'src/shared/domain/principal';

/**
 * Metadata target accepted by Nest's reflector, covering controller classes and handlers.
 */
type AuthPolicyTarget = Parameters<Reflector['get']>[1];

/**
 * Effective endpoint policy produced during validation or read by authorization.
 */
export type AuthPolicy = {
    readonly public: boolean;
    readonly principalType: PrincipalType | undefined;
    readonly permissions: readonly Permission[];
};

/**
 * Reads whether either declaration level makes an already-validated endpoint public.
 *
 * @param reflector Reads the decorator metadata.
 * @param controller Controller owning the endpoint.
 * @param handler Endpoint method.
 * @returns Whether authentication must be skipped.
 */
export function isPublicAuthPolicy(
    reflector: Reflector,
    controller: AuthPolicyTarget,
    handler: AuthPolicyTarget,
): boolean {
    return (
        reflector.get<boolean | undefined>(KEY_DECORATOR_PUBLIC, controller) === true ||
        reflector.get<boolean | undefined>(KEY_DECORATOR_PUBLIC, handler) === true
    );
}

/**
 * Combines controller and method authorization requirements after startup validation has succeeded.
 *
 * @param reflector Reads the decorator metadata.
 * @param controller Controller owning the endpoint.
 * @param handler Endpoint method.
 * @returns Effective access policy used by authorization.
 */
export function resolveAuthPolicy(
    reflector: Reflector,
    controller: AuthPolicyTarget,
    handler: AuthPolicyTarget,
): AuthPolicy {
    const targets = [controller, handler],
        principalTypes = targets
            .map((target) => reflector.get<PrincipalType | undefined>(KEY_DECORATOR_PRINCIPAL_ONLY, target))
            .filter((value) => value !== undefined),
        permissionLists = targets
            .map((target) => reflector.get<Permission[] | undefined>(KEY_DECORATOR_PERMISSIONS, target))
            .filter((value) => value !== undefined);

    return {
        public: isPublicAuthPolicy(reflector, controller, handler),
        principalType: principalTypes[0],
        permissions: [...new Set(permissionLists.flat())],
    };
}
