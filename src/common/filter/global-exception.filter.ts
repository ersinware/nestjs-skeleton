import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DatabaseError, WrappedError } from '../interface/database-error.interface';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
    constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp(),
            response = ctx.getResponse<unknown>();

        let statusCode = HttpStatus.INTERNAL_SERVER_ERROR,
            messages: string[] = ['An unexpected internal server error occurred.'],
            statusText = 'Internal Server Error';

        if (exception instanceof HttpException) {
            statusCode = exception.getStatus();

            const resObj = exception.getResponse();

            if ((ctx.getRequest<{ url?: string }>()?.url || '').includes('/health')) {
                this.httpAdapterHost.httpAdapter.reply(
                    response,
                    {
                        error: resObj,
                    },
                    statusCode,
                );

                return;
            }

            const statusName = HttpStatus[statusCode];

            statusText =
                typeof statusName === 'string'
                    ? statusName
                          .toLowerCase()
                          .replace(/_/g, ' ')
                          .split(' ')
                          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                          .join(' ')
                    : exception.name;

            if (typeof resObj === 'object' && resObj !== null) {
                const _resObj = resObj as Record<string, unknown>,
                    message = _resObj['message'];

                if (typeof _resObj['error'] === 'string') {
                    statusText = _resObj['error'];
                }

                if (Array.isArray(message)) {
                    messages = message.map((message) => String(message));
                } else if (typeof message === 'string') {
                    messages = [message];
                } else {
                    messages = [exception.message];
                }
            } else if (typeof resObj === 'string') {
                messages = [resObj];
            } else {
                messages = [exception.message];
            }
        } else {
            const _error = this.getDatabaseError(exception);

            if (_error) {
                switch (_error.code) {
                    case '23505':
                        statusCode = HttpStatus.CONFLICT;
                        messages = [this.formatUniqueViolationMessage(_error.detail)];
                        statusText = 'Conflict';

                        break;
                    case '23503':
                        statusCode = HttpStatus.CONFLICT;
                        messages = [
                            'Foreign key constraint violation. A related record does not exist or is still referenced.',
                        ];
                        statusText = 'Conflict';

                        break;
                    default:
                        console.error('Unhandled database exception:', exception);

                        break;
                }
            } else {
                console.error('Unhandled exception:', exception);
            }
        }

        this.httpAdapterHost.httpAdapter.reply(
            response,
            {
                error: {
                    statusCode,
                    message: messages,
                    statusText,
                },
            },
            statusCode,
        );
    }

    private getDatabaseError(exception: unknown): DatabaseError | null {
        if (!exception || typeof exception !== 'object') {
            return null;
        }

        const error = exception as WrappedError & DatabaseError;

        if (typeof error.code === 'string' && error.code.length === 5) {
            return error;
        }

        if (error.cause && typeof error.cause === 'object') {
            const cause = error.cause;

            if (typeof cause.code === 'string' && cause.code.length === 5) {
                return cause;
            }
        }

        return null;
    }

    private formatUniqueViolationMessage(detail: unknown): string {
        if (typeof detail === 'string') {
            const match = detail.match(/Key \((.*?)\)=\((.*?)\) already exists/);

            if (match && match.length === 3) {
                return `The ${match[1]} '${match[2]}' is already in use.`;
            }
        }

        return 'Resource already exists.';
    }
}
