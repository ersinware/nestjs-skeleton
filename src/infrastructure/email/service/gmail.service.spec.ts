/**
 * @file gmail.service.spec.ts
 * @description Unit tests for GmailService verifying Google OAuth2 setup and email payload generation.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ENV } from 'src/common/config/constant/env.constant';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Environment } from 'src/common/config/enum/environment.enum';
import { GmailService } from './gmail.service';

const mocks = vi.hoisted(() => {
    const send = vi.fn();

    return {
        send,
        gmail: vi.fn(() => ({
            users: {
                messages: {
                    send,
                },
            },
        })),
        OAuth2: vi.fn().mockImplementation(function () {
            return {
                setCredentials: vi.fn(),
            };
        }),
    };
});

vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: mocks.OAuth2,
        },
        gmail: mocks.gmail,
    },
}));

describe('GmailService', () => {
    const mockConfigService = {
        getOrThrow: vi.fn((key: string) => {
            switch (key) {
                case ENV.GMAIL_USER_EMAIL:
                    return 'sender@example.com';
                case ENV.GMAIL_CLIENT_ID:
                    return 'client-id';
                case ENV.GMAIL_CLIENT_SECRET:
                    return 'client-secret';
                case ENV.GMAIL_REFRESH_TOKEN:
                    return 'refresh-token';
                default:
                    return '';
            }
        }),
    };

    let service: GmailService, configService: ConfigService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GmailService,
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
            ],
        }).compile();

        service = module.get<GmailService>(GmailService);
        configService = module.get<ConfigService>(ConfigService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('sendEmail', () => {
        it('should format raw email string and dispatch via Google API messages send method when NODE_ENV is not test', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            mocks.send.mockResolvedValueOnce({});

            await expect(
                service.sendEmail('recipient@example.com', 'Test Subject', '<p>Hello</p>'),
            ).resolves.toBeUndefined();

            expect(mocks.send).toHaveBeenCalledWith({
                userId: 'me',
                requestBody: {
                    raw: expect.any(String) as string,
                },
            });
        });

        it('should bypass sending email when NODE_ENV is test', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.TEST);

            await expect(
                service.sendEmail('recipient@example.com', 'Test Subject', '<p>Hello</p>'),
            ).resolves.toBeUndefined();

            expect(mocks.send).not.toHaveBeenCalled();
        });
    });
});
