/**
 * @file noop-emailer.adapter.ts
 * @description No-op emailer bound in the test environment instead of the provider adapter.
 */

import { Injectable } from '@nestjs/common';
import type { IEmailerPort } from 'src/core/email/port/emailer.port';

/**
 * Emailer that discards every send. Bound under NODE_ENV=test so E2E runs and automated
 * fuzzing (Schemathesis) cannot exhaust provider quota or send real messages,
 * and the test environment needs no live provider credentials.
 */
@Injectable()
export class NoopEmailerAdapter implements IEmailerPort {
    /**
     * Discards the email without contacting any provider.
     */
    async sendEmail() {}
}
