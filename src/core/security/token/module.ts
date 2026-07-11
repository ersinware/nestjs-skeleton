/**
 * @file token.module.ts
 * @description NestJS module configuring JWT access and refresh token utilities.
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TokenAdapter } from 'src/core/security/token/adapter';
import { TOKEN_TOKEN_PORT } from 'src/core/security/token/port';

/**
 * Module responsible for configuring and exposing JWT token generation and verification services.
 */
@Module({
    imports: [JwtModule.register({})],
    providers: [
        {
            provide: TOKEN_TOKEN_PORT,
            useClass: TokenAdapter,
        },
    ],
    exports: [TOKEN_TOKEN_PORT],
})
export class TokenModule {}
