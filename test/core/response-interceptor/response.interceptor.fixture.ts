/**
 * @file response.interceptor.fixture.ts
 * @description Controller designed to return various status codes and responses to test the response wrapping interceptor.
 */

import { Controller, Get, HttpCode } from '@nestjs/common';
import { Public } from 'src/common/decorator/auth/public.decorator';

@Controller('response-interceptor-trigger')
@Public()
export class ResponseInterceptorTriggerController {
    @Get('204')
    @HttpCode(204)
    get204() {
        return 'no-content-data';
    }

    @Get('304')
    @HttpCode(304)
    get304() {
        return 'not-modified-data';
    }

    @Get('data')
    getData() {
        return { id: 1 };
    }

    @Get('null')
    getNull() {
        return null;
    }

    @Get('undefined')
    getUndefined() {
        return undefined;
    }
}
