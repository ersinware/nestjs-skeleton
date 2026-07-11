/**
 * @file logger.module.ts
 * @description NestJS module configuring Pino logger globally.
 */

import { Global, Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger, LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV, Environment } from 'src/core/config';
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
                        redact: [
                            // Sensitive Request Headers
                            'req.headers.authorization',
                            'req.headers.cookie',
                            'req.headers["x-api-key"]',
                            'req.headers["x-refresh-token"]',
                            'req.headers["x-access-token"]',
                            'req.headers.session',

                            // Sensitive Response Headers
                            'res.headers["set-cookie"]',
                            'res.headers.cookie',

                            // Sensitive Body Keys (Direct)
                            'req.body.password',
                            'req.body.passwordConfirmation',
                            'req.body.currentPassword',
                            'req.body.newPassword',
                            'req.body.oldPassword',
                            'req.body.pin',
                            'req.body.cvv',
                            'req.body.cvc',
                            'req.body.cardNumber',
                            'req.body.creditCard',
                            'req.body.ssn',
                            'req.body.tckn',
                            'req.body.secret',
                            'req.body.clientSecret',
                            'req.body.apiKey',
                            'req.body.token',
                            'req.body.accessToken',
                            'req.body.refreshToken',
                            'req.body.otp',
                            'req.body.verificationCode',
                            'req.body.securityCode',
                            'req.body.pass',

                            // Sensitive Body Keys (Nested 1-Level)
                            'req.body.*.password',
                            'req.body.*.passwordConfirmation',
                            'req.body.*.currentPassword',
                            'req.body.*.newPassword',
                            'req.body.*.oldPassword',
                            'req.body.*.pin',
                            'req.body.*.cvv',
                            'req.body.*.cvc',
                            'req.body.*.cardNumber',
                            'req.body.*.creditCard',
                            'req.body.*.ssn',
                            'req.body.*.tckn',
                            'req.body.*.secret',
                            'req.body.*.clientSecret',
                            'req.body.*.apiKey',
                            'req.body.*.token',
                            'req.body.*.accessToken',
                            'req.body.*.refreshToken',
                            'req.body.*.otp',
                            'req.body.*.verificationCode',
                            'req.body.*.securityCode',
                            'req.body.*.pass',
                        ],
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
            useExisting: Logger,
        },
    ],
    exports: [PinoLoggerModule, TOKEN_LOGGER_PORT],
})
export class LoggerModule {}
