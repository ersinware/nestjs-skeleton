/**
 * @file module.ts
 * @description Registers startup validation for HTTP authentication and authorization policies.
 */

import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuthPolicyValidator } from 'src/core/security/auth/auth-policy.validator';

/**
 * Owns endpoint policy validation; global guard ordering remains in the composition root.
 */
@Module({
    imports: [DiscoveryModule],
    providers: [AuthPolicyValidator],
})
export class AuthPolicyModule {}
