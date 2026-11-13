/**
 * @file module.ts
 * @description Registers startup validation for HTTP policies and provides access/refresh token port instances.
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ENV } from 'src/core/config';
import { ACCESS_TOKEN_TYPE, TOKEN_AUTH_ACCESS_TOKEN_PORT } from 'src/core/security/auth/access-token';
import { AccessTokenLifetimePolicy } from 'src/core/security/auth/access-token-lifetime-policy';
import { AuthPolicyValidator } from 'src/core/security/auth/auth-policy.validator';
import { REFRESH_TOKEN_TYPE, TOKEN_AUTH_REFRESH_TOKEN_PORT } from 'src/core/security/auth/refresh-token';
import { JwtTokenAdapter, TokenModule, type ITokenPort } from 'src/core/security/token';

/**
 * Owns endpoint policy validation and concern-scoped access and refresh JWT token ports.
 */
@Module({
    imports: [DiscoveryModule, TokenModule],
    providers: [
        AuthPolicyValidator,
        AccessTokenLifetimePolicy,
        {
            inject: [JwtService, ConfigService],
            provide: TOKEN_AUTH_ACCESS_TOKEN_PORT,
            useFactory: (jwtService: JwtService, configService: ConfigService): ITokenPort<typeof ACCESS_TOKEN_TYPE> =>
                new JwtTokenAdapter(jwtService, configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET)),
        },
        {
            inject: [JwtService, ConfigService],
            provide: TOKEN_AUTH_REFRESH_TOKEN_PORT,
            useFactory: (jwtService: JwtService, configService: ConfigService): ITokenPort<typeof REFRESH_TOKEN_TYPE> =>
                new JwtTokenAdapter(jwtService, configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET)),
        },
    ],
    exports: [AccessTokenLifetimePolicy, TOKEN_AUTH_ACCESS_TOKEN_PORT, TOKEN_AUTH_REFRESH_TOKEN_PORT],
})
export class AuthPolicyModule {}
