/**
 * @file processor.spec.ts
 * @description Unit tests for OutboxProcessor.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError, type Job } from 'bullmq';
import { TOKEN_EVENT_BUS_PORT } from 'src/core/event-bus/event-bus.port';
import { TOKEN_LOGGER_PORT } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT } from 'src/core/observability/tracker';
import { NonRetriableEventError } from 'src/core/outbox/exception';
import { TOKEN_OUTBOX_LEDGER_PORT } from 'src/core/outbox/port/outbox-ledger.port';
import type { ClaimedOutboxEvent } from 'src/core/outbox/type';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxProcessor } from '.';

describe('OutboxProcessor', () => {
    const event: ClaimedOutboxEvent = {
        id: 'outbox-1',
        type: 'user.created',
        aggregateId: 'aggregate-1',
    };

    const mockEventBusPort = {
        emitAsync: vi.fn(),
    };

    const mockOutboxLedgerPort = {
        markPublished: vi.fn(),
        markDead: vi.fn(),
    };

    const mockLoggerPort = {
        error: vi.fn(),
    };

    const mockExceptionTrackerPort = {
        captureException: vi.fn(),
    };

    let processor: OutboxProcessor;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OutboxProcessor,
                { provide: TOKEN_EVENT_BUS_PORT, useValue: mockEventBusPort },
                { provide: TOKEN_OUTBOX_LEDGER_PORT, useValue: mockOutboxLedgerPort },
                { provide: TOKEN_LOGGER_PORT, useValue: mockLoggerPort },
                { provide: TOKEN_EXCEPTION_TRACKER_PORT, useValue: mockExceptionTrackerPort },
                { provide: ConfigService, useValue: { get: vi.fn() } },
            ],
        }).compile();

        processor = module.get<OutboxProcessor>(OutboxProcessor);
    });

    it('should be defined', () => {
        expect(processor).toBeDefined();
    });

    describe('process', () => {
        it('should dispatch the event and mark it published', async () => {
            const job = { data: event } as Job<ClaimedOutboxEvent>;

            mockEventBusPort.emitAsync.mockResolvedValueOnce(undefined);
            mockOutboxLedgerPort.markPublished.mockResolvedValueOnce(undefined);

            await expect(processor.process(job)).resolves.toBeUndefined();

            expect(mockEventBusPort.emitAsync).toHaveBeenCalledWith(event.type, {
                id: event.aggregateId,
                eventId: event.id,
            });
            expect(mockOutboxLedgerPort.markPublished).toHaveBeenCalledWith([event.id]);
        });

        it('should not mark published when dispatch fails', async () => {
            const job = { data: event } as Job<ClaimedOutboxEvent>;

            mockEventBusPort.emitAsync.mockRejectedValueOnce(new Error('dispatch failed'));

            await expect(processor.process(job)).rejects.toThrow(Error);
            expect(mockOutboxLedgerPort.markPublished).not.toHaveBeenCalled();
        });

        it('should convert a non-retriable consumer error into an UnrecoverableError', async () => {
            const job = { data: event } as Job<ClaimedOutboxEvent>;

            mockEventBusPort.emitAsync.mockRejectedValueOnce(new NonRetriableEventError('poison event'));

            await expect(processor.process(job)).rejects.toThrow(UnrecoverableError);
            expect(mockOutboxLedgerPort.markPublished).not.toHaveBeenCalled();
        });
    });

    describe('onFailed', () => {
        it('should do nothing while retry attempts remain', async () => {
            const job = {
                data: event,
                attemptsMade: 2,
                opts: { attempts: 5 },
            } as Job<ClaimedOutboxEvent>;

            await processor.onFailed(job, new Error('transient'));

            expect(mockLoggerPort.error).not.toHaveBeenCalled();
        });

        it('should dead-letter the event once retries are exhausted', async () => {
            const job = {
                data: event,
                attemptsMade: 5,
                opts: { attempts: 5 },
            } as Job<ClaimedOutboxEvent>;
            const error = new Error('permanent failure');

            mockOutboxLedgerPort.markDead.mockResolvedValueOnce(undefined);

            await processor.onFailed(job, error);

            expect(mockLoggerPort.error).toHaveBeenCalled();
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(error);
            expect(mockOutboxLedgerPort.markDead).toHaveBeenCalledWith([event.id], error.message);
        });
    });
});
