/**
 * @file auth-policy.validator.ts
 * @description Rejects missing or conflicting endpoint access policies before serving requests.
 */

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { resolveAuthPolicy } from 'src/core/security/auth/auth-policy';

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
                    resolveAuthPolicy(this.reflector, controller, handler);
                }
            }
        }
    }
}
