/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file email.service.spec.ts
 * @description Unit tests for EmailService verifying BullMQ job submission.
 */

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_WELCOME_ADMIN, QUEUE_EMAIL } from 'src/common/port/email/email.constant';
import type { WelcomeAdminJobData } from 'src/common/port/email/welcome-admin-job-data.interface';
import { EmailService } from './email.service';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import * as Sentry from '@sentry/nestjs';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

describe('EmailService', () => {
    const mockQueue = {
            add: vi.fn(),
        },
        mockLogger = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        } as unknown as ILoggerService;

    let service: EmailService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailService,
                {
                    provide: getQueueToken(QUEUE_EMAIL),
                    useValue: mockQueue,
                },
                {
                    provide: TOKEN_LOGGER_SERVICE,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        service = module.get<EmailService>(EmailService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('queueWelcomeAdminEmail', () => {
        it('should successfully add a welcome-admin job to the queue when triggered', async () => {
            const data: WelcomeAdminJobData = {
                email: 'newadmin@example.com',
                name: 'New Admin',
                password: 'Password123!',
            };

            mockQueue.add.mockResolvedValueOnce({});

            await expect(service.queueWelcomeAdminEmail(data)).resolves.toBeUndefined();
            expect(mockQueue.add).toHaveBeenCalledWith(JOB_WELCOME_ADMIN, data, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            });
        });

        it('should catch error, log it, and send to Sentry if emailQueue.add fails', async () => {
            const data: WelcomeAdminJobData = {
                email: 'newadmin@example.com',
                name: 'New Admin',
                password: 'Password123!',
            };

            const mockError = new Error('Redis is down');
            mockQueue.add.mockRejectedValueOnce(mockError);

            await expect(service.queueWelcomeAdminEmail(data)).resolves.toBeUndefined();

            expect(mockQueue.add).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(expect.any(LogPayload));
            expect(Sentry.captureException).toHaveBeenCalledWith(mockError);
        });
    });
});
