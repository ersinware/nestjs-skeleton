/**
 * @file emailer.adapter.spec.ts
 * @description Verifies Resend delivery requests, retry keys, and provider failures without network access.
 */

import { ConfigService } from '@nestjs/config';
import { EmailerAdapter } from 'src/core/email/adapter/emailer.adapter';
import type { EmailDeliveryIdentity, EmailPayload } from 'src/core/email/port/emailer.port';
import { SystemException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('EmailerAdapter', () => {
    const data: EmailPayload = {
        to: 'recipient@example.com',
        subject: 'Account notification',
        body: '<p>Hello</p>',
    };
    const delivery: EmailDeliveryIdentity = {
        queueName: 'user-activation',
        deliveryId: '01960000-0000-7000-8000-000000000011',
    };
    const fetchMock = vi.fn<typeof fetch>();
    let adapter: EmailerAdapter;

    beforeEach(() => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response(JSON.stringify({ id: 'email-id' }), { status: 200 })),
        );
        vi.stubGlobal('fetch', fetchMock);
        adapter = new EmailerAdapter(
            new ConfigService({ EMAIL_API_KEY: 're_test_key', EMAIL_FROM_ADDRESS: 'sender@example.com' }),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends the requested email with the configured sender and a stable retry key', async () => {
        await adapter.sendEmail(data, delivery);
        await adapter.sendEmail(data, delivery);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, options] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://api.resend.com/emails');
        expect(options?.method).toBe('POST');
        expect(JSON.parse(options?.body as string)).toEqual({
            from: 'sender@example.com',
            to: data.to,
            subject: data.subject,
            html: data.body,
        });
        const firstKey = new Headers(options?.headers).get('Idempotency-Key');
        const secondKey = new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Idempotency-Key');
        expect(firstKey).toMatch(/^user-activation\/01960000-0000-7000-8000-000000000011\/[a-f0-9]{64}$/);
        expect(secondKey).toBe(firstKey);
    });

    it.each([
        [{ ...data, to: 'other@example.com' }, delivery],
        [{ ...data, subject: 'Changed subject' }, delivery],
        [{ ...data, body: '<p>Changed</p>' }, delivery],
        [data, { ...delivery, queueName: 'admin-invite' }],
        [data, { ...delivery, deliveryId: 'another-delivery' }],
    ] as const)('uses a new key when the outgoing request changes', async (changedData, changedDelivery) => {
        await adapter.sendEmail(data, delivery);
        await adapter.sendEmail(changedData, changedDelivery);

        const firstKey = new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Idempotency-Key');
        const secondKey = new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Idempotency-Key');
        expect(secondKey).not.toBe(firstKey);
    });

    it('propagates provider rejection as a system failure for job retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ name: 'validation_error', message: 'Invalid recipient', statusCode: 422 }), {
                status: 422,
            }),
        );

        await expect(adapter.sendEmail(data, delivery)).rejects.toThrow(SystemException);
    });

    it('propagates network failure as a system failure for job retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));

        await expect(adapter.sendEmail(data, delivery)).rejects.toThrow(SystemException);
    });
});
