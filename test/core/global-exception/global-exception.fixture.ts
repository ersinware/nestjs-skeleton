/**
 * @file global-exception.fixture.ts
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
import { Public } from 'src/common/decorator/public.decorator';
import { UnhealthyDto } from 'src/health/dto/unhealthy.dto';

@Controller('health-exception-trigger')
@Public()
export class HealthExceptionTriggerController {
    @Get('health-fail')
    triggerHealthFail() {
        throw new ServiceUnavailableException({
            status: 'error',
            info: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
            },
            error: {
                database: { status: 'down', message: 'Database connection failed.' },
                redis: { status: 'down', message: 'Redis connection failed.' },
            },
            details: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                database: { status: 'down', message: 'Database connection failed.' },
                redis: { status: 'down', message: 'Redis connection failed.' },
            },
        } satisfies UnhealthyDto);
    }

    @Get('health-non-503')
    triggerHealthNon503() {
        throw new InternalServerErrorException();
    }
}

class TestValidationDto {
    @IsNotEmpty()
    @IsString()
    name!: string;
}

@Public()
@Controller('exception-trigger')
export class ExceptionTriggerController {
    @Get('non-standard')
    triggerNonStandard() {
        throw new HttpException('Non-standard status code error message', 499);
    }

    @Get('service-unavailable')
    triggerServiceUnavailable() {
        throw new ServiceUnavailableException('Database or Redis is down');
    }

    @Get('internal-server-error')
    triggerInternalServerError() {
        throw new InternalServerErrorException('Database failure or sensitive details');
    }

    @Get('not-found')
    triggerNotFound() {
        throw new NotFoundException('User with ID 99999 not found.');
    }

    @Post('validation-error')
    triggerValidationError(@Body() body: TestValidationDto) {
        return { success: true, name: body.name };
    }

    @Get('empty-object')
    triggerEmptyObject() {
        throw new HttpException({}, HttpStatus.BAD_REQUEST);
    }

    @Get('raw-string')
    triggerRawString() {
        throw new HttpException('Raw string error', HttpStatus.BAD_REQUEST);
    }

    @Get('null-response')
    triggerNullResponse() {
        throw new HttpException(null as unknown as string, HttpStatus.BAD_REQUEST);
    }

    @Get('teapot')
    triggerTeapot() {
        throw new HttpException({ customError: 'Something went wrong' }, HttpStatus.I_AM_A_TEAPOT);
    }

    @Get('db-23505')
    triggerDb23505() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Key (email)=(duplicate@example.com) already exists',
        });
    }

    @Get('db-23505-username')
    triggerDb23505Username() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Key (username)=(testuser) already exists',
        });
    }

    @Get('db-23505-fallback')
    triggerDb23505Fallback() {
        throw Object.assign(new Error('Unique constraint violation'), {
            code: '23505',
            detail: 'Unexpected detail format',
        });
    }

    @Get('db-null-detail')
    triggerDbNullDetail() {
        throw Object.assign(new Error('Unique constraint violation'), { code: '23505', detail: null });
    }

    @Get('db-23503')
    triggerDb23503() {
        throw Object.assign(new Error('Foreign key violation'), { code: '23503' });
    }

    @Get('db-cause-23503')
    triggerDbCause23503() {
        throw Object.assign(new Error('Db action failed'), { cause: { code: '23503' } });
    }

    @Get('db-unrecognized')
    triggerDbUnrecognized() {
        throw Object.assign(new Error('Database disconnected'), { code: '99999' });
    }

    @Get('db-code-length')
    triggerDbCodeLength() {
        throw Object.assign(new Error('Invalid error code'), { code: '123' });
    }

    @Get('db-cause-code-length')
    triggerDbCauseCodeLength() {
        throw Object.assign(new Error('Invalid wrapped error code'), { cause: { code: '1234' } });
    }

    @Get('runtime-error')
    triggerRuntimeError() {
        throw new Error('Unexpected runtime exception');
    }

    @Get('plain-string')
    triggerPlainString() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'Plain string error thrown';
    }
}
