/**
 * @file auth-policy.ts
 * @description Shared resolution and validation of controller and route access policies.
 */

import type { Reflector } from '@nestjs/core';
import { KEY_DECORATOR_AUTHENTICATED } from 'src/core/security/auth/decorator/authenticated.decorator';
import { KEY_DECORATOR_PERMISSIONS } from 'src/core/security/auth/decorator/permissions.decorator';
import { KEY_DECORATOR_PRINCIPAL_ONLY } from 'src/core/security/auth/decorator/principal-only.decorator';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import { PERMISSION_HOLDER, Permission, PrincipalType } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';

/** Metadata target accepted by Nest's reflector, covering controller classes and handlers. */
type AuthPolicyTarget = Parameters<Reflector['get']>[1];

/** Effective endpoint policy produced during validation or read by authorization. */
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
 * Reads the effective authorization requirements after startup validation has succeeded.
 *
 * @param reflector Reads the decorator metadata.
 * @param controller Controller owning the endpoint.
 * @param handler Endpoint method.
 * @returns Effective access policy used by authorization.
 */
export function readAuthPolicy(
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

/**
 * Combines class and method restrictions without allowing a method to remove class protection.
 *
 * @param reflector Reads the decorator metadata.
 * @param controller Controller owning the endpoint.
 * @param handler Endpoint method.
 * @returns The validated effective access policy.
 * @throws {SystemException} If the policy is absent, contradictory, or invalid.
 */
export function resolveAuthPolicy(
    reflector: Reflector,
    controller: AuthPolicyTarget,
    handler: AuthPolicyTarget,
): AuthPolicy {
    const targets = [controller, handler],
        publicFlags = targets.map((target) => reflector.get<boolean | undefined>(KEY_DECORATOR_PUBLIC, target)),
        authenticatedFlags = targets.map((target) =>
            reflector.get<boolean | undefined>(KEY_DECORATOR_AUTHENTICATED, target),
        ),
        principalTypes = targets
            .map((target) => reflector.get<PrincipalType | undefined>(KEY_DECORATOR_PRINCIPAL_ONLY, target))
            .filter((value) => value !== undefined),
        permissionLists = targets
            .map((target) => reflector.get<Permission[] | undefined>(KEY_DECORATOR_PERMISSIONS, target))
            .filter((value) => value !== undefined),
        policy = readAuthPolicy(reflector, controller, handler),
        permissions = policy.permissions,
        isPublic = policy.public,
        authenticated = authenticatedFlags.includes(true),
        principalType = policy.principalType;

    if (
        [...publicFlags, ...authenticatedFlags].some((value) => value !== undefined && value !== true) ||
        principalTypes.some((value) => !Object.values(PrincipalType).includes(value)) ||
        permissionLists.some((value) => !Array.isArray(value) || value.length === 0) ||
        permissions.some((value) => !Object.values(Permission).includes(value))
    ) {
        throw new SystemException(`Invalid auth metadata: ${controller.name}.${handler.name}`);
    }

    if (
        (isPublic && (authenticated || principalTypes.length > 0 || permissions.length > 0)) ||
        (!isPublic && !authenticated && principalTypes.length === 0 && permissions.length === 0) ||
        (authenticatedFlags[0] === true &&
            (reflector.get(KEY_DECORATOR_PRINCIPAL_ONLY, controller) !== undefined ||
                reflector.get(KEY_DECORATOR_PERMISSIONS, controller) !== undefined)) ||
        (authenticatedFlags[1] === true && (principalTypes.length > 0 || permissions.length > 0)) ||
        new Set(principalTypes).size > 1 ||
        new Set(permissions.map((permission) => PERMISSION_HOLDER[permission])).size > 1 ||
        (principalType !== undefined &&
            permissions.some((permission) => PERMISSION_HOLDER[permission] !== principalType))
    ) {
        throw new SystemException(`Missing or conflicting auth policy: ${controller.name}.${handler.name}`);
    }

    return policy;
}
