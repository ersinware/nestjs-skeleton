/**
 * @file logger.config.ts
 * @description Configuration factory for nestjs-pino and pino-http.
 */

import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Params } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { ENV } from './constant/env.constant';
import { Environment } from 'src/common/enum/config/environment.enum';

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
            mixin: () => {
                const activeSpan = Sentry.getActiveSpan();

                if (activeSpan) {
                    const { traceId, spanId } = activeSpan.spanContext();

                    return { traceId, spanId };
                }

                return {};
            },
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
            ...(NODE_ENV === Environment.DEVELOPMENT
                ? {
                      transport: {
                          target: 'pino-pretty',
                          options: {
                              singleLine: false,
                              colorize: true,
                              translateTime: "UTC:yyyy-mm-dd HH:MM:ss.l'Z'",
                          },
                      },
                  }
                : {}),
        },
        exclude: [
            { method: RequestMethod.ALL, path: 'health' },
            { method: RequestMethod.ALL, path: 'v:version/docs' },
        ],
    };
}
