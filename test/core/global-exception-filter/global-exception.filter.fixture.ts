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
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';
import { ResponseUnhealthyDto } from 'src/module/health/presentation/dto/response-unhealthy.dto';

/**
 * Exercises health-error passthrough and ordinary error normalization.
 */
@Controller('health-exception-trigger')
@Public()
export class HealthExceptionTriggerController {
    /**
     * Raises an unhealthy dependency report for health response passthrough.
     *
     * @throws {ServiceUnavailableException} Always, carrying the health indicator report.
     */
    @Get('health-fail')
    @RateLimit(RateLimitPolicy.DEFAULT)
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

    /**
     * Raises a health-route failure that must use ordinary error normalization.
     *
     * @throws {InternalServerErrorException} Always, to exercise non-503 health failures.
     */
    @Get('health-non-503')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerHealthNon503() {
        throw new InternalServerErrorException();
    }
}

/**
 * Requires a non-empty string to exercise request validation failures.
 */
class TestValidationDto {
    /**
     * Required test input validated before handler execution.
     */
    @IsNotEmpty()
    @IsString()
    readonly name!: string;
}

/**
 * Exercises exception normalization across framework, driver and unexpected failures.
 */
@Public()
@Controller('exception-trigger')
export class ExceptionTriggerController {
    /**
     * Exercises normalization of a framework error with a non-standard status.
     *
     * @throws {HttpException} Always, carrying the non-standard 499 status.
     */
    @Get('non-standard')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerNonStandard() {
        throw new HttpException('Non-standard status code error message', 499);
    }

    /**
     * Exercises dependency-unavailable response masking.
     *
     * @throws {ServiceUnavailableException} Always, carrying a dependency-specific message.
     */
    @Get('service-unavailable')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerServiceUnavailable() {
        throw new ServiceUnavailableException('Database or Redis is down');
    }

    /**
     * Exercises masking of sensitive internal error messages.
     *
     * @throws {InternalServerErrorException} Always, carrying a sensitive message to mask.
     */
    @Get('internal-server-error')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerInternalServerError() {
        throw new InternalServerErrorException('Database failure or sensitive details');
    }

    /**
     * Exercises replacement of detailed not-found messages.
     *
     * @throws {NotFoundException} Always, carrying a resource-specific message.
     */
    @Get('not-found')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerNotFound() {
        throw new NotFoundException('User with ID 99999 not found.');
    }

    /**
     * Returns validated input so invalid payloads must be rejected before execution.
     *
     * @param body Input accepted by the validation pipe.
     * @returns Successful response containing the validated name.
     */
    @Post('validation-error')
    @RateLimit(RateLimitPolicy.DEFAULT)
    triggerValidationError(@Body() body: TestValidationDto) {
        return { success: true, name: body.name };
    }

    /**
     * Exercises normalization when a framework error has an empty response object.
     *
     * @throws {HttpException} Always, carrying an empty 400 response object.
     */
    @Get('empty-object')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerEmptyObject() {
        throw new HttpException({}, HttpStatus.BAD_REQUEST);
    }

    /**
     * Exercises normalization when a framework error carries a string response.
     *
     * @throws {HttpException} Always, carrying a string 400 response.
     */
    @Get('raw-string')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerRawString() {
        throw new HttpException('Raw string error', HttpStatus.BAD_REQUEST);
    }

    /**
     * Exercises normalization when a framework error carries a null response.
     *
     * @throws {HttpException} Always, carrying a null 400 response.
     */
    @Get('null-response')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerNullResponse() {
        throw new HttpException(null as unknown as string, HttpStatus.BAD_REQUEST);
    }

    /**
     * Exercises normalization of an unsupported custom error response.
     *
     * @throws {HttpException} Always, carrying a custom 418 response object.
     */
    @Get('teapot')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerTeapot() {
        throw new HttpException({ customError: 'Something went wrong' }, HttpStatus.I_AM_A_TEAPOT);
    }

    /**
     * Exercises unique-constraint translation using a recognized email detail.
     */
    @Get('db-23505')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23505() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Key (email)=(duplicate@example.com) already exists',
        });
    }

    /**
     * Exercises unique-constraint translation for a different column.
     */
    @Get('db-23505-username')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23505Username() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Key (username)=(testuser) already exists',
        });
    }

    /**
     * Exercises unique-constraint translation when the detail format is unrecognized.
     */
    @Get('db-23505-fallback')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23505Fallback() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Unexpected detail format',
        });
    }

    /**
     * Exercises unique-constraint translation without a usable detail.
     */
    @Get('db-null-detail')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbNullDetail() {
        throw Object.assign(new Error('Unique constraint violation'), { code: '23505', detail: null });
    }

    /**
     * Exercises translation of a direct foreign-key constraint failure.
     */
    @Get('db-23503')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDb23503() {
        throw Object.assign(new Error('Foreign key violation'), { code: '23503' });
    }

    /**
     * Exercises foreign-key failure detection through a wrapped cause.
     */
    @Get('db-cause-23503')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbCause23503() {
        throw Object.assign(new Error('Db action failed'), { cause: { code: '23503' } });
    }

    /**
     * Exercises preservation of an unrecognized database error.
     */
    @Get('db-unrecognized')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbUnrecognized() {
        throw Object.assign(new Error('Database disconnected'), { code: '99999' });
    }

    /**
     * Exercises rejection of malformed database error codes.
     */
    @Get('db-code-length')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbCodeLength() {
        throw Object.assign(new Error('Invalid error code'), { code: '123' });
    }

    /**
     * Exercises rejection of malformed codes inside wrapped causes.
     */
    @Get('db-cause-code-length')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerDbCauseCodeLength() {
        throw Object.assign(new Error('Invalid wrapped error code'), { cause: { code: '1234' } });
    }

    /**
     * Exercises reporting and masking of an unexpected runtime failure.
     */
    @Get('runtime-error')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerRuntimeError() {
        throw new Error('Unexpected runtime exception');
    }

    /**
     * Exercises normalization of a thrown value that is not an Error.
     */
    @Get('plain-string')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @HttpCache(HttpCachePolicy.NO_STORE)
    triggerPlainString() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'Plain string error thrown';
    }
}
