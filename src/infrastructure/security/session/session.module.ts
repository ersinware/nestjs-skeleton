/**
 * @file session.module.ts
 * @description NestJS module configuring security session management utilities.
 */

import { Module } from '@nestjs/common';
import { CacheModule } from 'src/infrastructure/cache/cache.module';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import { SessionService } from './session.service';

/**
 * Module responsible for configuring and exposing session management capabilities via cache.
 */
@Module({
    imports: [CacheModule],
    providers: [
        {
            provide: TOKEN_SESSION_SERVICE,
            useClass: SessionService,
        },
    ],
    exports: [TOKEN_SESSION_SERVICE],
})
export class SessionModule {}
