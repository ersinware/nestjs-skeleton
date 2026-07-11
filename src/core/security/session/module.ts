/**
 * @file session.module.ts
 * @description NestJS module configuring security session management utilities.
 */

import { Module } from '@nestjs/common';
import { CacheModule } from 'src/core/cache';
import { SessionAdapter } from 'src/core/security/session/adapter';
import { TOKEN_SESSION_PORT } from 'src/core/security/session/port';

/**
 * Module responsible for configuring and exposing session management capabilities via cache.
 */
@Module({
    imports: [CacheModule],
    providers: [
        {
            provide: TOKEN_SESSION_PORT,
            useClass: SessionAdapter,
        },
    ],
    exports: [TOKEN_SESSION_PORT],
})
export class SessionModule {}
