/**
 * @file token.module.ts
 * @description NestJS module configuring JWT access and refresh token utilities.
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TOKEN_TOKEN_SERVICE } from 'src/common/port/security/token.constant';
import { TokenService } from './token.service';

/**
 * Module responsible for configuring and exposing JWT token generation and verification services.
 */
@Module({
    imports: [JwtModule.register({})],
    providers: [
        {
            provide: TOKEN_TOKEN_SERVICE,
            useClass: TokenService,
        },
    ],
    exports: [TOKEN_TOKEN_SERVICE],
})
export class TokenModule {}
