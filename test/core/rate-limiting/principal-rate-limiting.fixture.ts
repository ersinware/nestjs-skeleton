/**
 * @file principal-rate-limiting.fixture.ts
 * @description Successful handlers behind production principal admission for budget persistence checks.
 */

import { Controller, Get } from '@nestjs/common';
import { HttpCache, HttpCachePolicy } from 'src/core/http';
import { Authenticated } from 'src/core/security/auth';
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';

/**
 * Exposes successful requests without modifying accounts or overriding admission guards.
 */
@Controller('principal-rate-limit-test')
@Authenticated()
export class PrincipalRateLimitingTestController {
    /**
     * Admitted handler executions, including calls that consume the last available budget.
     */
    calls = 0;

    /**
     * Successful password-proof-policy admission.
     *
     * @returns Cumulative number of admitted handler executions.
     */
    @Get('password')
    @RateLimit(RateLimitPolicy.PASSWORD_CHANGE_EMAIL_CHANGE_INITIATE)
    @HttpCache(HttpCachePolicy.NO_STORE)
    password(): number {
        return ++this.calls;
    }

    /**
     * Successful invitation-policy admission.
     *
     * @returns Cumulative number of admitted handler executions.
     */
    @Get('invitation')
    @RateLimit(RateLimitPolicy.ADMIN_INVITATION)
    @HttpCache(HttpCachePolicy.NO_STORE)
    invitation(): number {
        return ++this.calls;
    }

    /**
     * Successful avatar-policy admission.
     *
     * @returns Cumulative number of admitted handler executions.
     */
    @Get('avatar')
    @RateLimit(RateLimitPolicy.AVATAR_UPLOAD_INITIATE)
    @HttpCache(HttpCachePolicy.NO_STORE)
    avatar(): number {
        return ++this.calls;
    }
}
