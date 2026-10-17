/**
 * @file audit.adapter.spec.ts
 * @description Verifies durable-completion marking and isolation of refusal evidence between audit contexts.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuditAdapter } from 'src/core/observability/audit/adapter/audit.adapter';
import { getAuditContext, isExceptionAudited, runWithAuditContext } from 'src/core/observability/audit/audit-context';
import { AccessDeniedException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('AuditAdapter refusal completion', () => {
    const input = { action: 'ADMIN_ACTIVATION_FAILED', reason: 'ACCOUNT_BANNED' },
        context = { remoteAddress: '127.0.0.1', route: '/admin/activate', method: 'POST' };

    it('marks only after acceptance and never persists the exception or tracking set', async () => {
        let accept!: () => void;
        const accepted = new Promise<void>((resolve) => {
                accept = resolve;
            }),
            values = vi.fn().mockReturnValue(accepted),
            adapter = new AuditAdapter({ insert: () => ({ values }) } as unknown as NodePgDatabase),
            error = new AccessDeniedException();

        await runWithAuditContext(context, async () => {
            const pending = adapter.record(input, { markExceptionAsAudited: error });
            expect(isExceptionAudited(error)).toBe(false);
            accept();
            await pending;
            expect(isExceptionAudited(error)).toBe(true);
            expect(getAuditContext()).toEqual(context);
            expect(values.mock.calls[0]![0]).toEqual({
                ...context,
                ...input,
                traceId: null,
                occurredAt: expect.any(Date) as unknown,
                id: expect.stringMatching(
                    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
                ) as unknown,
            });
        });
        expect(isExceptionAudited(error)).toBe(false);
    });

    it('does not mark when persistence fails', async () => {
        const failure = new Error('audit insert failed'),
            adapter = new AuditAdapter({
                insert: () => ({ values: vi.fn().mockRejectedValue(failure) }),
            } as unknown as NodePgDatabase),
            error = new AccessDeniedException();

        await runWithAuditContext(context, async () => {
            await expect(adapter.record(input, { markExceptionAsAudited: error })).rejects.toBe(failure);
            expect(isExceptionAudited(error)).toBe(false);
        });
    });

    it('keeps concurrent request marks separate even for the same exception object', async () => {
        const adapter = new AuditAdapter({
                insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
            } as unknown as NodePgDatabase),
            error = new AccessDeniedException();
        let recorded!: () => void;
        const ready = new Promise<void>((resolve) => {
            recorded = resolve;
        });

        await Promise.all([
            runWithAuditContext(context, async () => {
                await adapter.record(input, { markExceptionAsAudited: error });
                recorded();
                expect(isExceptionAudited(error)).toBe(true);
            }),
            runWithAuditContext(context, async () => {
                await ready;
                expect(isExceptionAudited(error)).toBe(false);
            }),
        ]);
    });
});
