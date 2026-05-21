import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const response = context.switchToHttp().getResponse<FastifyReply>();

        if (response.statusCode === 204 || response.statusCode === 304) {
            return next.handle();
        }

        return next.handle().pipe(
            map((data: unknown) => ({
                data: data ?? null,
            })),
        );
    }
}
