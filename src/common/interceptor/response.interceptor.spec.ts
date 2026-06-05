import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, it, expect } from 'vitest';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
    const interceptor = new ResponseInterceptor();

    /**
     * Helper to create a mocked NestJS ExecutionContext with a specific response status code.
     *
     * @param statusCode HTTP response status code to return.
     * @returns Mocked ExecutionContext instance.
     */
    function createMockContext(statusCode: number): ExecutionContext {
        return {
            switchToHttp: () => ({
                getResponse: () => ({
                    statusCode,
                }),
            }),
        } as unknown as ExecutionContext;
    }

    /**
     * Helper to create a mocked CallHandler returning specific data as an observable stream.
     *
     * @param data Data payload to return.
     * @returns Mocked CallHandler instance.
     */
    function createMockHandler(data: unknown): CallHandler {
        return {
            handle: () => of(data),
        } as CallHandler;
    }

    it('should be defined', () => {
        expect(interceptor).toBeDefined();
    });

    it('should return handler.handle() unmodified when the response status code is 204', async () => {
        expect(
            await firstValueFrom(interceptor.intercept(createMockContext(204), createMockHandler('no-content-data'))),
        ).toBe('no-content-data');
    });

    it('should return handler.handle() unmodified when the response status code is 304', async () => {
        expect(
            await firstValueFrom(interceptor.intercept(createMockContext(304), createMockHandler('not-modified-data'))),
        ).toBe('not-modified-data');
    });

    it('should wrap the returned data in a data object when data is present', async () => {
        expect(
            await firstValueFrom(interceptor.intercept(createMockContext(200), createMockHandler({ id: 1 }))),
        ).toEqual({
            data: { id: 1 },
        });
    });

    it('should wrap the returned data as null when the returned value is null', async () => {
        expect(await firstValueFrom(interceptor.intercept(createMockContext(200), createMockHandler(null)))).toEqual({
            data: null,
        });
    });

    it('should wrap the returned data as null when the returned value is undefined', async () => {
        expect(
            await firstValueFrom(interceptor.intercept(createMockContext(200), createMockHandler(undefined))),
        ).toEqual({
            data: null,
        });
    });
});
