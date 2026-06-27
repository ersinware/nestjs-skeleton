/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file email.processor.spec.ts
 * @description Unit tests for EmailProcessor.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailProcessor } from './email.processor';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';
import type { Job } from 'bullmq';
import { JOB_WELCOME_ADMIN, TOKEN_MAILER_SERVICE } from 'src/common/port/email/email.constant';
import type { WelcomeAdminJobData } from 'src/common/port/email/welcome-admin-job-data.interface';
import * as Sentry from '@sentry/nestjs';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

describe('EmailProcessor', () => {
    const mockMailerService = {
            sendEmail: vi.fn(),
        },
        mockLogger: ILoggerService = {
            error: vi.fn(),
            log: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        };

    let processor: EmailProcessor;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailProcessor,
                {
                    provide: TOKEN_MAILER_SERVICE,
                    useValue: mockMailerService,
                },
                {
                    provide: TOKEN_LOGGER_SERVICE,
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
        it('should compile template and call MailerService when job name is JOB_WELCOME_ADMIN', async () => {
            const jobData = {
                    email: 'admin@example.com',
                    name: 'Admin Name',
                    password: 'Password123!',
                } satisfies WelcomeAdminJobData,
                job = {
                    name: JOB_WELCOME_ADMIN,
                    data: jobData,
                } as Job<WelcomeAdminJobData, unknown, string>;

            mockMailerService.sendEmail.mockResolvedValueOnce(undefined);

            await expect(processor.process(job)).resolves.toBeUndefined();
            expect(mockMailerService.sendEmail).toHaveBeenCalledWith(
                jobData.email,
                'Welcome',
                expect.stringContaining(jobData.password),
            );
        });

        it('should throw an error and not call MailerService when job name is unknown', async () => {
            const job = {
                name: 'unknown-job',
                data: {},
            } as Job<WelcomeAdminJobData, unknown, string>;

            await expect(processor.process(job)).rejects.toThrow(Error);
            expect(mockMailerService.sendEmail).not.toHaveBeenCalled();
        });
    });

    describe('onFailed', () => {
        it('should log the failure and capture in Sentry when a job fails', () => {
            const error = new Error();

            processor.onFailed(
                {
                    id: '123',
                    name: JOB_WELCOME_ADMIN,
                } as Job<WelcomeAdminJobData, unknown, string>,
                error,
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: EmailProcessor.name,
                    method: processor.onFailed.name,
                    error,
                    jobId: '123',
                    jobName: JOB_WELCOME_ADMIN,
                }),
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(error);
        });
    });
});
