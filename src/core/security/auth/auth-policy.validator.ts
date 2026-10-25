/**
 * @file auth-policy.validator.ts
 * @description Rejects missing or conflicting endpoint access policies before serving requests.
 */

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { resolveAuthPolicy } from 'src/core/security/auth/auth-policy';
import { KEY_DECORATOR_AUTHENTICATED } from 'src/core/security/auth/decorator/authenticated.decorator';
import { KEY_DECORATOR_PERMISSIONS } from 'src/core/security/auth/decorator/permissions.decorator';
import { KEY_DECORATOR_PRINCIPAL_ONLY } from 'src/core/security/auth/decorator/principal-only.decorator';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import { PERMISSION_HOLDER, Permission, PrincipalType } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';

/**
 * Validates registered HTTP handlers, including inherited methods and scoped controllers.
 */
@Injectable()
export class AuthPolicyValidator implements OnApplicationBootstrap {
    /**
     * @param discovery Enumerates registered controllers.
     * @param scanner Enumerates inherited controller methods.
     * @param reflector Reads route and access metadata.
     */
    constructor(
        private readonly discovery: DiscoveryService,
        private readonly scanner: MetadataScanner,
        private readonly reflector: Reflector,
    ) {}

    /**
     * Checks every registered HTTP endpoint before the application starts listening.
     *
     * @throws {SystemException} If an endpoint's access policy is invalid.
     */
    onApplicationBootstrap() {
        for (const wrapper of this.discovery.getControllers()) {
            const controller = wrapper.metatype;
            if (!controller) {
                continue;
            }

            const prototype = controller.prototype as Record<string, (...args: never[]) => unknown>;
            for (const method of this.scanner.getAllMethodNames(prototype)) {
                const handler = prototype[method];
                if (handler && this.reflector.get<number | undefined>(METHOD_METADATA, handler) !== undefined) {
                    this.validateAuthPolicy(controller, handler);
                }
            }
        }
    }

    /**
     * Rejects absent, invalid, or conflicting controller and method access declarations.
     *
     * @param controller Controller owning the endpoint.
     * @param handler Endpoint method.
     * @throws {SystemException} If the policy is absent, contradictory, or invalid.
     */
    private validateAuthPolicy(controller: Parameters<Reflector['get']>[1], handler: Parameters<Reflector['get']>[1]) {
        const targets = [controller, handler],
            publicFlags = targets.map((target) =>
                this.reflector.get<boolean | undefined>(KEY_DECORATOR_PUBLIC, target),
            ),
            authenticatedFlags = targets.map((target) =>
                this.reflector.get<boolean | undefined>(KEY_DECORATOR_AUTHENTICATED, target),
            ),
            principalTypes = targets
                .map((target) => this.reflector.get<PrincipalType | undefined>(KEY_DECORATOR_PRINCIPAL_ONLY, target))
                .filter((value) => value !== undefined),
            permissionLists = targets
                .map((target) => this.reflector.get<Permission[] | undefined>(KEY_DECORATOR_PERMISSIONS, target))
                .filter((value) => value !== undefined),
            policy = resolveAuthPolicy(this.reflector, controller, handler),
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
            throw new SystemException(`Invalid auth metadata: ${controller.name}.${handler.name}`, {
                context: {
                    class: 'auth-policy.validator.ts',
                    method: this.validateAuthPolicy.name,
                },
            });
        }

        if (
            (isPublic && (authenticated || principalTypes.length > 0 || permissions.length > 0)) ||
            (!isPublic && !authenticated && principalTypes.length === 0 && permissions.length === 0) ||
            (authenticatedFlags[0] === true &&
                (this.reflector.get(KEY_DECORATOR_PRINCIPAL_ONLY, controller) !== undefined ||
                    this.reflector.get(KEY_DECORATOR_PERMISSIONS, controller) !== undefined)) ||
            (authenticatedFlags[1] === true && (principalTypes.length > 0 || permissions.length > 0)) ||
            new Set(principalTypes).size > 1 ||
            new Set(permissions.map((permission) => PERMISSION_HOLDER[permission])).size > 1 ||
            (principalType !== undefined &&
                permissions.some((permission) => PERMISSION_HOLDER[permission] !== principalType))
        ) {
            throw new SystemException(`Missing or conflicting auth policy: ${controller.name}.${handler.name}`, {
                context: {
                    class: 'auth-policy.validator.ts',
                    method: this.validateAuthPolicy.name,
                },
            });
        }
    }
}
