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
}
