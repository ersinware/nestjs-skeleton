/**
 * @file emailer.adapter.spec.ts
 * @description Unit tests for EmailerAdapter verifying Google OAuth2 setup and email payload generation.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ENV, Environment } from 'src/core/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailerAdapter } from '.';

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

describe('EmailerAdapter', () => {
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

    let adapter: EmailerAdapter, configService: ConfigService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmailerAdapter,
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
            ],
        }).compile();

        adapter = module.get<EmailerAdapter>(EmailerAdapter);
        configService = module.get<ConfigService>(ConfigService);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('sendEmail', () => {
        it('should format raw email string and dispatch via Google API messages send method when NODE_ENV is not test', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            mocks.send.mockResolvedValueOnce({});

            await expect(
                adapter.sendEmail({ to: 'recipient@example.com', subject: 'Test Subject', body: '<p>Hello</p>' }),
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
                adapter.sendEmail({ to: 'recipient@example.com', subject: 'Test Subject', body: '<p>Hello</p>' }),
            ).resolves.toBeUndefined();

            expect(mocks.send).not.toHaveBeenCalled();
        });
    });
});
