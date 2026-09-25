/**
 * @file response.interceptor.fixture.ts
 * @description Controller designed to return various status codes and responses to test the response wrapping interceptor.
 */

import { Controller, Get, HttpCode } from '@nestjs/common';
import { HttpCache, HttpCachePolicy } from 'src/core/http';
import { Public } from 'src/core/security/auth';

@Controller('response-interceptor-trigger')
@Public()
export class ResponseInterceptorTriggerController {
    @Get('204')
    @HttpCache(HttpCachePolicy.NO_STORE)
    @HttpCode(204)
    get204() {
        return 'no-content-data';
    }

    @Get('304')
    @HttpCache(HttpCachePolicy.NO_STORE)
    @HttpCode(304)
    get304() {
        return 'not-modified-data';
    }

    @Get('data')
    @HttpCache(HttpCachePolicy.NO_STORE)
    getData() {
        return { id: 1 };
    }

    @Get('null')
    @HttpCache(HttpCachePolicy.NO_STORE)
    getNull() {
        return null;
    }

    @Get('undefined')
    @HttpCache(HttpCachePolicy.NO_STORE)
    getUndefined() {
        return undefined;
    }
}
