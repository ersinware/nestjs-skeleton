/**
 * @file module.ts
 * @description NestJS module providing the email-change confirmation token port bound to its dedicated secret.
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ENV } from 'src/core/config';
import {
    EMAIL_CONFIRMATION_TOKEN_TYPE,
    TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT,
} from 'src/core/security/email-change/email-confirmation-token';
import { JwtTokenAdapter, TokenModule, type ITokenPort } from 'src/core/security/token';

/**
 * Provides and exports the dedicated email-confirmation JWT token port.
 */
@Module({
    imports: [TokenModule],
    providers: [
        {
            inject: [JwtService, ConfigService],
            provide: TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT,
            useFactory: (
                jwtService: JwtService,
                configService: ConfigService,
            ): ITokenPort<typeof EMAIL_CONFIRMATION_TOKEN_TYPE> =>
                new JwtTokenAdapter(jwtService, configService.getOrThrow<string>(ENV.JWT_EMAIL_CONFIRM_SECRET)),
        },
    ],
    exports: [TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT],
})
export class EmailChangeModule {}
