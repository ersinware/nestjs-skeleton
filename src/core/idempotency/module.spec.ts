/**
 * @file module.spec.ts
 * @description Guards the shared hashing boundary against independent idempotency cryptography or secrets.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Idempotency hashing boundary', () => {
    it('does not implement HMAC directly or configure an independent secret', () => {
        const root = join(process.cwd(), 'src/core/idempotency');
        const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
            (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
        );
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const source = readFileSync(join(root, file), 'utf8');
            expect(source, file).not.toMatch(/\bcreateHmac\b/);
            expect(source, file).not.toMatch(/idempotency[\w-]*secret|secret[\w-]*idempotency/i);
        }
    });

    it('does not declare idempotency-specific secrets in application configuration', () => {
        for (const file of [
            'src/core/config/environment/env.constant.ts',
            'src/core/config/environment/env.validation.ts',
            '.env.example',
            '.env.test',
        ]) {
            const source = readFileSync(join(process.cwd(), file), 'utf8');
            expect(source, file).not.toMatch(
                /IDEMPOTENCY[^\n]*(?:SECRET|HASHING_KEY)|(?:SECRET|HASHING_KEY)[^\n]*IDEMPOTENCY/i,
            );
        }
    });
});
