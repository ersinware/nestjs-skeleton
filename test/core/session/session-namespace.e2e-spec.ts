/**
 * @file session-namespace.e2e-spec.ts
 * @description Verifies principal-scoped session isolation through the production port and real Redis.
 */

import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import {
    RotateOutcome,
    SessionModule,
    TOKEN_SESSION_PORT,
    type ISessionPort,
    type SessionRegistration,
} from 'src/core/security/session';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { PrincipalType } from 'src/shared/domain/principal';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

describe('Principal-scoped Redis sessions', () => {
    let module: TestingModule;
    let sessions: ISessionPort;
    let redis: Redis;
    const keys = new Set<string>();

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, envFilePath: resolveEnvFilePath(), validate: validateConfig }),
                SessionModule,
            ],
        }).compile();
        await module.init();
        sessions = module.get(TOKEN_SESSION_PORT);
        redis = module.get(TOKEN_SESSION_CONNECTION);
    });

    afterEach(async () => {
        // Delete exact run-owned keys individually; principals need not share a cluster slot.
        for (const key of keys) {
            await redis.del(key);
        }
        keys.clear();
    });

    afterAll(async () => {
        await module?.close();
    });

    /**
     * Tracks the exact principal namespace used by the fixture, including its consumed credential marker.
     *
     * @param id Shared principal identifier.
     * @param principalType Owning context.
     * @param version Initial access floor.
     * @returns Registration with the same sid and jti across principal kinds.
     */
    function registration(id: string, principalType: PrincipalType, version: number): SessionRegistration {
        const prefix = `auth:{${principalType}:${id}}`;
        keys.add(`${prefix}:version`);
        keys.add(`${prefix}:session:sid`);
        keys.add(`${prefix}:rotated:sid:original`);
        keys.add(`${prefix}:rotated:sid:replacement`);
        return {
            principalType,
            sid: 'sid',
            refreshTokenJti: 'original',
            sessionVersion: version,
            sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
            refreshExpiresAt: Math.floor(Date.now() / 1000) + 1800,
        };
    }

    it.each([
        [PrincipalType.USER, PrincipalType.ADMIN],
        [PrincipalType.ADMIN, PrincipalType.USER],
    ])('isolates %s version synchronization and revocation from %s with the same id', async (type, otherType) => {
        const id = randomUUID();
        const session = registration(id, type, 8);
        const other = registration(id, otherType, 1);
        expect(await sessions.openSession(id, session)).toBe(true);
        expect(await sessions.openSession(id, other)).toBe(true);
        expect(await sessions.getVersion(id, type)).toBe(8);
        expect(await sessions.getVersion(id, otherType)).toBe(1);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);

        await sessions.setVersion(id, type, 9);
        await sessions.setVersion(id, type, 2);
        expect(await sessions.getVersion(id, type)).toBe(9);
        expect(await sessions.isSessionActive(id, type, session.sid, 8)).toBe(false);
        expect(await sessions.rotateSession(id, 'original', session)).toBe(RotateOutcome.SESSION_CLOSED);
        expect(await sessions.openSession(id, { ...session, sid: 'rejected' })).toBe(false);
        expect(await sessions.getVersion(id, otherType)).toBe(1);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        expect(await sessions.rotateSession(id, 'original', { ...other, refreshTokenJti: 'replacement' })).toBe(
            RotateOutcome.ROTATED,
        );
    });

    it.each([
        [PrincipalType.USER, PrincipalType.ADMIN],
        [PrincipalType.ADMIN, PrincipalType.USER],
    ])('isolates %s rotation markers, reuse closure, and logout from %s', async (type, otherType) => {
        const id = randomUUID();
        const session = registration(id, type, 1);
        const other = registration(id, otherType, 1);
        const replacement = { ...session, refreshTokenJti: 'replacement' };
        expect(await sessions.openSession(id, session)).toBe(true);
        expect(await sessions.openSession(id, other)).toBe(true);
        expect(await sessions.openSession(id, session)).toBe(false);
        expect(await sessions.rotateSession(id, 'original', replacement)).toBe(RotateOutcome.ROTATED);
        expect(await sessions.rotateSession(id, 'original', replacement)).toBe(RotateOutcome.CONCURRENT_REPLAY);
        expect(await redis.exists(`auth:{${otherType}:${id}}:rotated:sid:original`)).toBe(0);
        expect(await sessions.rotateSession(id, 'original', { ...other, refreshTokenJti: 'replacement' })).toBe(
            RotateOutcome.ROTATED,
        );

        // Expire only this principal's grace marker to exercise reuse outside grace without a timed wait.
        await redis.del(`auth:{${type}:${id}}:rotated:sid:original`);
        expect(await sessions.rotateSession(id, 'original', replacement)).toBe(RotateOutcome.REUSE_DETECTED);
        expect(await sessions.isSessionActive(id, type, session.sid, 1)).toBe(false);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        expect(await sessions.getVersion(id, type)).toBe(1);

        await sessions.closeSession(id, type, session.sid);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        await sessions.closeSession(id, otherType, other.sid);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(false);
        expect(await sessions.rotateSession(id, 'replacement', other)).toBe(RotateOutcome.SESSION_CLOSED);
    });

    it.each([
        [PrincipalType.USER, PrincipalType.ADMIN],
        [PrincipalType.ADMIN, PrincipalType.USER],
    ])('logs out a live %s session without closing the same-id %s session', async (type, otherType) => {
        const id = randomUUID();
        const session = registration(id, type, 1);
        const other = registration(id, otherType, 1);
        expect(await sessions.openSession(id, session)).toBe(true);
        expect(await sessions.openSession(id, other)).toBe(true);
        await sessions.closeSession(id, type, session.sid);
        expect(await sessions.isSessionActive(id, type, session.sid, 1)).toBe(false);
        expect(await sessions.rotateSession(id, 'original', session)).toBe(RotateOutcome.SESSION_CLOSED);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        expect(await sessions.rotateSession(id, 'original', { ...other, refreshTokenJti: 'replacement' })).toBe(
            RotateOutcome.ROTATED,
        );
    });

    it('denies a missing principal version even when the other kind has a live session', async () => {
        const id = randomUUID();
        const session = registration(id, PrincipalType.ADMIN, 1);
        registration(id, PrincipalType.USER, 1);
        expect(await sessions.openSession(id, session)).toBe(true);
        expect(await sessions.getVersion(id, PrincipalType.USER)).toBeNull();
        expect(await sessions.isSessionActive(id, PrincipalType.USER, session.sid, 1)).toBe(false);
        await redis.del(`auth:{${PrincipalType.ADMIN}:${id}}:version`);
        expect(await sessions.isSessionActive(id, PrincipalType.ADMIN, session.sid, 1)).toBe(false);
    });
});
