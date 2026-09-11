/**
 * @file module.ts
 * @description NestJS module configuring pino and providing the logger port.
 */

import { Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV, Environment, ROUTE_DOCS, ROUTE_HEALTH, VERSION_PREFIX } from 'src/core/config';
import { LoggerAdapter } from 'src/core/observability/logger/adapter/logger.adapter';
import { serializeError } from 'src/core/observability/logger/error-serializer';
import { TOKEN_LOGGER_PORT } from 'src/core/observability/logger/port/logger.port';

/**
 * Log level per environment. Exhaustive, so a new {@link Environment} member fails compilation
 * here instead of silently falling through to a silenced logger.
 */
const ENVIRONMENT_TO_LEVEL: Record<Environment, string> = {
    [Environment.PRODUCTION]: 'info',
    [Environment.DEVELOPMENT]: 'debug',
    [Environment.TEST]: 'silent',
};

/**
 * Configures pino — level per environment, whitelist serializers, route exclusions — and provides
 * the logger port.
 */
@Module({
    imports: [
        PinoLoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                return {
                    pinoHttp: {
                        level: ENVIRONMENT_TO_LEVEL[config.getOrThrow<Environment>(ENV.NODE_ENV)],
                        serializers: {
                            // Whitelist, not denylist: a new header stays private until named here.
                            // The body is never logged (credentials, tokens, PII) and the URL drops
                            // its query string for the same reason — a query can carry a token.
                            req: (req: IncomingMessage & { id: unknown; remoteAddress: string }) => ({
                                id: req.id,
                                method: req.method,
                                url: req.url?.split('?')[0],
                                remoteAddress: req.remoteAddress,
                                userAgent: req.headers['user-agent'],
                            }),
                            // Response headers are dropped wholesale: Set-Cookie and any future
                            // token-bearing header would land there by default.
                            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
                            error: serializeError,
                        },
                        formatters: {
                            level: (label: string) => ({ level: label }),
                        },
                    },
                    // These routes answer no diagnostic question per request; `*splat`
                    // (path-to-regexp v8) covers the probes — the app's highest-frequency traffic.
                    exclude: [
                        { method: RequestMethod.ALL, path: ROUTE_HEALTH },
                        { method: RequestMethod.ALL, path: `${ROUTE_HEALTH}/*splat` },
                        { method: RequestMethod.ALL, path: `${VERSION_PREFIX}:version/${ROUTE_DOCS}` },
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
