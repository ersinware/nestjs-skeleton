/**
 * @file global-exception.filter.fixture.ts
 * @description Controllers and DTOs designed to trigger various runtime and database exceptions to test the global exception filter.
 */

import {
    Body,
    Controller,
    Get,
    HttpException,
    HttpStatus,
    InternalServerErrorException,
    NotFoundException,
    Post,
    ServiceUnavailableException,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { HttpCache, HttpCachePolicy } from 'src/core/http';
import { Public } from 'src/core/security/auth';
import { ResponseUnhealthyDto } from 'src/module/health/presentation/dto/response-unhealthy.dto';

@Controller('health-exception-trigger')
@Public()
export class HealthExceptionTriggerController {
    @Get('health-fail')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerHealthFail() {
        throw new ServiceUnavailableException({
            status: 'error',
            info: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
            },
            error: {
                database: { status: 'down', message: 'Database connection failed.' },
                database_replica: { status: 'down', message: 'Database replica connection failed.' },
                cache: { status: 'down', message: 'Cache connection failed.' },
            },
            details: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                session: { status: 'up' },
                database: { status: 'down', message: 'Database connection failed.' },
                database_replica: { status: 'down', message: 'Database replica connection failed.' },
                cache: { status: 'down', message: 'Cache connection failed.' },
            },
        } satisfies ResponseUnhealthyDto);
    }

    @Get('health-non-503')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerHealthNon503() {
        throw new InternalServerErrorException();
    }
}

class TestValidationDto {
    @IsNotEmpty()
    @IsString()
    readonly name!: string;
}

@Public()
@Controller('exception-trigger')
export class ExceptionTriggerController {
    @Get('non-standard')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerNonStandard() {
        throw new HttpException('Non-standard status code error message', 499);
    }

    @Get('service-unavailable')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerServiceUnavailable() {
        throw new ServiceUnavailableException('Database or Redis is down');
    }

    @Get('internal-server-error')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerInternalServerError() {
        throw new InternalServerErrorException('Database failure or sensitive details');
    }

    @Get('not-found')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerNotFound() {
        throw new NotFoundException('User with ID 99999 not found.');
    }

    @Post('validation-error')
    triggerValidationError(@Body() body: TestValidationDto) {
        return { success: true, name: body.name };
    }

    @Get('empty-object')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerEmptyObject() {
        throw new HttpException({}, HttpStatus.BAD_REQUEST);
    }

    @Get('raw-string')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerRawString() {
        throw new HttpException('Raw string error', HttpStatus.BAD_REQUEST);
    }

    @Get('null-response')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerNullResponse() {
        throw new HttpException(null as unknown as string, HttpStatus.BAD_REQUEST);
    }

    @Get('teapot')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerTeapot() {
        throw new HttpException({ customError: 'Something went wrong' }, HttpStatus.I_AM_A_TEAPOT);
    }

    @Get('db-23505')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23505() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Key (email)=(duplicate@example.com) already exists',
        });
    }

    @Get('db-23505-username')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23505Username() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Key (username)=(testuser) already exists',
        });
    }

    @Get('db-23505-fallback')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23505Fallback() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Unexpected detail format',
        });
    }

    @Get('db-null-detail')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbNullDetail() {
        throw Object.assign(new Error('Unique constraint violation'), { code: '23505', detail: null });
    }

    @Get('db-23503')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23503() {
        throw Object.assign(new Error('Foreign key violation'), { code: '23503' });
    }

    @Get('db-cause-23503')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbCause23503() {
        throw Object.assign(new Error('Db action failed'), { cause: { code: '23503' } });
    }

    @Get('db-unrecognized')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbUnrecognized() {
        throw Object.assign(new Error('Database disconnected'), { code: '99999' });
    }

    @Get('db-code-length')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbCodeLength() {
        throw Object.assign(new Error('Invalid error code'), { code: '123' });
    }

    @Get('db-cause-code-length')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbCauseCodeLength() {
        throw Object.assign(new Error('Invalid wrapped error code'), { cause: { code: '1234' } });
    }

    @Get('runtime-error')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerRuntimeError() {
        throw new Error('Unexpected runtime exception');
    }

    @Get('plain-string')
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerPlainString() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'Plain string error thrown';
    }
}
