/**
 * @file email.service.spec.ts
 * @description Unit tests for EmailService verifying BullMQ job submission.
 */

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service';
import { JOB_NAME_WELCOME_ADMIN, QUEUE_NAME_EMAIL } from '../constant/email.constant';

describe('EmailService', () => {
    const mockQueue = {
        add: vi.fn(),
    };

    let service: EmailService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailService,
                {
                    provide: getQueueToken(QUEUE_NAME_EMAIL),
                    useValue: mockQueue,
                },
            ],
        }).compile();

        service = module.get<EmailService>(EmailService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('sendAdminWelcomeEmail', () => {
        it('should successfully add a welcome-admin job to the queue', async () => {
            const data = {
                email: 'newadmin@example.com',
                name: 'New Admin',
                password: 'Password123!',
            };

            mockQueue.add.mockResolvedValueOnce({});

            await expect(service.sendAdminWelcomeEmail(data)).resolves.toBeUndefined();
            expect(mockQueue.add).toHaveBeenCalledWith(JOB_NAME_WELCOME_ADMIN, data, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            });
        });
    });
});
