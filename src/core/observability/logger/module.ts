/**
 * @file logger.module.ts
 * @description NestJS module configuring Pino logger globally.
 */

import { Global, Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV, Environment } from 'src/core/config';
import { LoggerAdapter } from 'src/core/observability/logger/adapter';
import { TOKEN_LOGGER_PORT } from 'src/core/observability/logger/port';

/**
 * Global LoggerModule wrapper encapsulating pino configurations.
 */
@Global()
@Module({
    imports: [
        PinoLoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
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
                            // Whitelist, not denylist — the same philosophy as the response DTOs'
                            // `@Exclude()` + `@Expose()`. A denylist of sensitive headers protects only
                            // the headers someone thought of, and silently leaks every one added later;
                            // here a new header is private by default and must be named to be logged.
                            // The request BODY is never logged at all, at any level: it is the one place
                            // credentials, tokens and full PII payloads reliably appear, and no
                            // operational question is worth keeping that standing risk.
                            req: (req: IncomingMessage & { id: unknown; remoteAddress: string }) => ({
                                id: req.id,
                                method: req.method,
                                url: req.url,
                                remoteAddress: req.remoteAddress,
                                userAgent: req.headers['user-agent'],
                            }),
                            // Response headers are dropped wholesale rather than filtered: they answer
                            // no diagnostic question a log line is asked, while Set-Cookie and any
                            // future token-bearing header would land there by default. The status code
                            // is the only part worth keeping.
                            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
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
            },
        }),
    ],
    providers: [
        {
            provide: TOKEN_LOGGER_PORT,
            useClass: LoggerAdapter,
        },
    ],
    exports: [PinoLoggerModule, TOKEN_LOGGER_PORT],
})
export class LoggerModule {}
