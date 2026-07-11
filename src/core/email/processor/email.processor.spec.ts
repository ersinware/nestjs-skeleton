/**
 * @file email.processor.spec.ts
 * @description Unit tests for EmailProcessor.
 */

import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { JOB_SEND_EMAIL } from 'src/core/email/constant';
import { TOKEN_EMAILER_PORT } from 'src/core/email/port';
import type { EmailPayload } from 'src/core/email/type';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailProcessor } from '.';

describe('EmailProcessor', () => {
    const mockMailerPort = {
        sendEmail: vi.fn(),
    };

    let processor: EmailProcessor;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailProcessor,
                {
                    provide: TOKEN_EMAILER_PORT,
                    useValue: mockMailerPort,
                },
            ],
        }).compile();

        processor = module.get<EmailProcessor>(EmailProcessor);
    });

    it('should be defined', () => {
        expect(processor).toBeDefined();
    });

    describe('process', () => {
        it('should compile template and call MailerService when job name is JOB_SEND_EMAIL', async () => {
            const jobData: EmailPayload = {
                    to: 'admin@example.com',
                    subject: 'Welcome',
                    body: 'Hello World',
                },
                job = {
                    name: JOB_SEND_EMAIL,
                    data: jobData,
                } as Job<EmailPayload, unknown, string>;

            mockMailerPort.sendEmail.mockResolvedValueOnce(undefined);

            await expect(processor.process(job)).resolves.toBeUndefined();
            expect(mockMailerPort.sendEmail).toHaveBeenCalledWith(jobData);
        });

        it('should throw an error and not call MailerService when job name is unknown', async () => {
            const job = {
                name: 'unknown-job',
                data: {},
            } as Job<EmailPayload, unknown, string>;

            await expect(processor.process(job)).rejects.toThrow(Error);
            expect(mockMailerPort.sendEmail).not.toHaveBeenCalled();
        });
    });
});
