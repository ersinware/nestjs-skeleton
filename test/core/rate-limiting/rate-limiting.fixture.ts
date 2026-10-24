/**
 * @file rate-limiting.fixture.ts
 * @description HTTP surfaces exercising shared, independent and protected admission paths.
 */

import { Controller, Get } from '@nestjs/common';
import { HttpCache, HttpCachePolicy } from 'src/core/http';
import { Authenticated, Public } from 'src/core/security/auth';
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';

/**
 * Observable handler execution behind production guards.
 */
@Controller('rate-limit-test')
export class RateLimitingTestController {
    /**
     * Number of admitted public handler executions.
     */
    calls = 0;

    /**

     * First endpoint sharing the default budget.

     */
    @Get('a')
    @Public()
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    first(): number {
        return ++this.calls;
    }

    /**

     * Second endpoint sharing the default budget.

     */
    @Get('b')
    @Public()
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    second(): number {
        return ++this.calls;
    }

    /**

     * Independent policy for the same caller.

     */
    @Get('refresh')
    @Public()
    @RateLimit(RateLimitPolicy.REFRESH_TOKEN)
    @HttpCache(HttpCachePolicy.NO_STORE)
    refresh(): number {
        return ++this.calls;
    }

    /**

     * Missing credentials must fail after pre-auth consumption.

     */
    @Get('protected')
    @Authenticated()
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    protected(): number {
        return ++this.calls;
    }
}
