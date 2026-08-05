/**
 * @file module.ts
 * @description NestJS module configuring pino and providing the logger port.
 */

import { Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV, Environment, ROUTE_DOCS, ROUTE_HEALTH } from 'src/core/config';
import { LoggerAdapter } from 'src/core/observability/logger/adapter/logger.adapter';
import { TOKEN_LOGGER_PORT } from 'src/core/observability/logger/port/logger.port';

/**
 * Configures pino — level per environment, whitelist serializers, route exclusions — and provides
 * the logger port.
 */
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
                            // Whitelist, not denylist: a denylist protects only the headers someone
                            // thought of and silently leaks every one added later — here a new header
                            // is private until named. The request BODY is never logged at any level:
                            // it is where credentials, tokens and PII reliably appear.
                            req: (req: IncomingMessage & { id: unknown; remoteAddress: string }) => ({
                                id: req.id,
                                method: req.method,
                                url: req.url,
                                remoteAddress: req.remoteAddress,
                                userAgent: req.headers['user-agent'],
                            }),
                            // Response headers are dropped wholesale: they answer no diagnostic
                            // question, while Set-Cookie and any future token-bearing header would
                            // land there by default. Only the status code is worth keeping.
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
                    // These routes answer no diagnostic question per request. The `*splat` wildcard
                    // (path-to-regexp v8) covers the /live and /ready probes — the app's
                    // highest-frequency traffic.
                    exclude: [
                        { method: RequestMethod.ALL, path: ROUTE_HEALTH },
                        { method: RequestMethod.ALL, path: `${ROUTE_HEALTH}/*splat` },
                        { method: RequestMethod.ALL, path: `v:version/${ROUTE_DOCS}` },
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
