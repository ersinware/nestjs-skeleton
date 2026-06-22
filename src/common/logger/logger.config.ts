/**
 * @file logger.config.ts
 * @description Configuration factory for nestjs-pino and pino-http.
 */

import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Params } from 'nestjs-pino';
import { Environment } from 'src/common/enum/config/environment.enum';
import { ENV } from '../config/constant/env.constant';

/**
 * Returns configuration parameters for LoggerModule.
 *
 * @param config The NestJS ConfigService instance.
 * @returns Configured parameters for nestjs-pino.
 */
export function getLoggerConfig(config: ConfigService): Params {
    const NODE_ENV = config.getOrThrow<Environment>(ENV.NODE_ENV);

    return {
        pinoHttp: {
            level:
                NODE_ENV === Environment.PRODUCTION
                    ? 'info'
                    : NODE_ENV === Environment.DEVELOPMENT
                      ? 'debug'
                      : 'silent',
            serializers: {
                error: function serialize(error: unknown): unknown {
                    if (error instanceof Error) {
                        return {
                            type: error.name,
                            message: error.message,
                            stack: error.stack,
                            cause: error.cause ? serialize(error.cause) : undefined,
                        };
                    }

                    return error;
                },
            },
            formatters: {
                level: (label: string) => ({ level: label }),
            },
        },
        exclude: [
            { method: RequestMethod.ALL, path: 'health' },
            { method: RequestMethod.ALL, path: 'metrics' },
            { method: RequestMethod.ALL, path: 'v:version/docs' },
        ],
    };
}
