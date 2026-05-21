import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, validateSync } from 'class-validator';

enum Environment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}

class EnvironmentVariables {
    @IsNumber()
    readonly PORT!: number;

    @IsEnum(Environment)
    readonly NODE_ENV!: Environment;

    @IsString()
    readonly DATABASE_URL!: string;

    @IsNumber()
    readonly DATABASE_POOL_SIZE!: number;

    @IsNumber()
    readonly HEALTH_HEAP_LIMIT_MB!: number;

    @IsNumber()
    readonly HEALTH_RSS_LIMIT_MB!: number;

    @IsNumber()
    readonly THROTTLE_TTL!: number;

    @IsNumber()
    readonly THROTTLE_LIMIT!: number;

    @IsString()
    readonly REDIS_HOST!: string;

    @IsNumber()
    readonly REDIS_PORT!: number;

    @IsString()
    readonly REDIS_PASSWORD!: string;

    @IsNumber()
    readonly REDIS_MAX_RETRIES_PER_REQUEST!: number;

    @IsNumber()
    readonly REDIS_COMMAND_TIMEOUT!: number;
}

export function validateConfig(config: Record<string, unknown>) {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, {
            enableImplicitConversion: true,
        }),
        errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }

    return validatedConfig;
}
