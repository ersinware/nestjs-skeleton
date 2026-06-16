/**
 * @file email.processor.spec.ts
 * @description Unit tests for EmailProcessor.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailProcessor } from './email.processor';
import { GmailService } from '../service/gmail.service';
import type { Job } from 'bullmq';
import { JOB_NAME_WELCOME_ADMIN } from '../constant/email.constant';
import type { WelcomeAdminJobData } from '../type/email.type';
import * as Sentry from '@sentry/nestjs';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

describe('EmailProcessor', () => {
    const mockGmailService = {
            sendEmail: vi.fn(),
        },
        mockLogger = {
            error: vi.fn(),
        };

    let processor: EmailProcessor;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailProcessor,
                {
                    provide: GmailService,
                    useValue: mockGmailService,
                },
                {
                    provide: Logger,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        processor = module.get<EmailProcessor>(EmailProcessor);
    });

    it('should be defined', () => {
        expect(processor).toBeDefined();
    });

    describe('process', () => {
        it('should compile template and call GmailService when job name is JOB_NAME_WELCOME_ADMIN', async () => {
            const jobData = {
                    email: 'admin@example.com',
                    name: 'Admin Name',
                    password: 'Password123!',
                } satisfies WelcomeAdminJobData,
                job = {
                    name: JOB_NAME_WELCOME_ADMIN,
                    data: jobData,
                } as Job<WelcomeAdminJobData, unknown, string>;

            mockGmailService.sendEmail.mockResolvedValueOnce(undefined);

            await expect(processor.process(job)).resolves.toBeUndefined();
            expect(mockGmailService.sendEmail).toHaveBeenCalledWith(
                jobData.email,
                'Welcome to NestJS Skeleton',
                expect.stringContaining(jobData.password),
            );
        });

        it('should throw an error and not call GmailService when job name is unknown', async () => {
            const job = {
                name: 'unknown-job',
                data: {},
            } as Job<WelcomeAdminJobData, unknown, string>;

            await expect(processor.process(job)).rejects.toThrow(Error);
            expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
        });
    });

    describe('onFailed', () => {
        it('should log the failure and capture in Sentry when a job fails', () => {
            const error = new Error();

            processor.onFailed(
                {
                    id: '123',
                    name: JOB_NAME_WELCOME_ADMIN,
                } as Job<WelcomeAdminJobData, unknown, string>,
                error,
            );

            const [loggedObject] = mockLogger.error.mock.calls[0] as [{ error: Error }];
            expect(loggedObject.error).toBeInstanceOf(Error);
            expect(Sentry.captureException).toHaveBeenCalledWith(error);
        });
    });
});
