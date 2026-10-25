/**
 * @file response.interceptor.fixture.ts
 * @description Controller designed to return various status codes and responses to test the response wrapping interceptor.
 */

import { Controller, Get, HttpCode } from '@nestjs/common';
import { HttpCache, HttpCachePolicy } from 'src/core/http';
import { Public } from 'src/core/security/auth';
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';

/**
 * Exercises response wrapping and statuses that must not carry a body.
 */
@Controller('response-interceptor-trigger')
@Public()
export class ResponseInterceptorTriggerController {
    /**
     * Returns data under a 204 status to verify body suppression.
     *
     * @returns Sentinel data that must be omitted from the HTTP response.
     */
    @Get('204')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    @HttpCode(204)
    get204() {
        return 'no-content-data';
    }

    /**
     * Returns data under a 304 status to verify body suppression.
     *
     * @returns Sentinel data that must be omitted from the HTTP response.
     */
    @Get('304')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    @HttpCode(304)
    get304() {
        return 'not-modified-data';
    }

    /**
     * Returns an object to verify successful response wrapping.
     *
     * @returns Object to be wrapped in the standard response envelope.
     */
    @Get('data')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    getData() {
        return { id: 1 };
    }

    /**
     * Returns null to verify empty-value wrapping.
     *
     * @returns Null handler result.
     */
    @Get('null')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    getNull() {
        return null;
    }

    /**
     * Returns undefined to verify empty-value wrapping.
     *
     * @returns Undefined handler result.
     */
    @Get('undefined')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    getUndefined() {
        return undefined;
    }
}
