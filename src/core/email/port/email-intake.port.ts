/**
 * @file email-intake.port.ts
 * @description Public intake contract for enqueuing an email for durable asynchronous delivery.
 */
import type { EmailPayload } from 'src/core/email/type';

/**
 * Dependency injection token representing the email intake port.
 */
export const TOKEN_EMAIL_INTAKE_PORT = Symbol('TOKEN_EMAIL_INTAKE_PORT');

/**
 * Public entry point other modules use to send an email. The intent is recorded durably before any
 * dispatch, so delivery survives a Redis/BullMQ loss.
 */
export interface IEmailIntakePort {
    /**
     * Records an email intent for durable asynchronous delivery. The `dedupKey` makes a repeated
     * intake idempotent.
     *
     * @param data - The email payload containing recipient, subject, and body.
     * @param dedupKey - Deterministic idempotency key for the email intent.
     */
    queueEmail(data: EmailPayload, dedupKey: string): Promise<void>;
}
