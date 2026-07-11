/**
 * @file email.adapter.spec.ts
 * @description Unit tests for EmailQueueAdapter verifying BullMQ job submission.
 */

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { JOB_SEND_EMAIL, QUEUE_EMAIL } from 'src/core/email/constant';
import type { EmailPayload } from 'src/core/email/type';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailQueueAdapter } from '.';

describe('EmailQueueAdapter', () => {
    const mockQueue = {
        add: vi.fn(),
    };

    let service: EmailQueueAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailQueueAdapter,
                {
                    provide: getQueueToken(QUEUE_EMAIL),
                    useValue: mockQueue,
                },
            ],
        }).compile();

        service = module.get<EmailQueueAdapter>(EmailQueueAdapter);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('queueEmail', () => {
        it('should successfully add a job to the queue when triggered', async () => {
            const payload: EmailPayload = {
                to: 'test@example.com',
                subject: 'Test Subject',
                body: '<h1>Test Body</h1>',
            };

            await service.queueEmail(payload, 'test-job-123');

            expect(mockQueue.add).toHaveBeenCalledTimes(1);
            expect(mockQueue.add).toHaveBeenCalledWith(JOB_SEND_EMAIL, payload, {
                jobId: 'test-job-123',
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 24 * 3600, count: 1000 },
                removeOnFail: false,
            });
        });

        it('should rethrow error if emailQueue.add fails', async () => {
            const data: EmailPayload = {
                to: 'newadmin@example.com',
                subject: 'Welcome',
                body: 'Hello World',
            };

            const mockError = new Error('Redis is down');
            mockQueue.add.mockRejectedValueOnce(mockError);

            await expect(service.queueEmail(data, 'test-job-fail')).rejects.toThrow(mockError);

            expect(mockQueue.add).toHaveBeenCalled();
        });
    });
});
