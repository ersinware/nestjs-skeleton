/**
 * @file emailer.port.ts
 * @description Outbound contract for sending transactional emails, with its payload shape.
 */

/**
 * Dependency injection token representing the {@link IEmailerPort} contract.
 */
export const TOKEN_EMAILER_PORT = Symbol();

/**
 * Describes a payload conflict under an existing logical email delivery identity.
 */
export const EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE = 'The logical email delivery payload changed.';

/**
 * Data required to send one email.
 */
export type EmailPayload = {
    /**
     * The target recipient email address.
     */
    readonly to: string;

    /**
     * The email subject.
     */
    readonly subject: string;

    /**
     * The HTML body of the email.
     */
    readonly body: string;
};

/**
 * Identifies one queued email delivery independently of a provider. The complete
 * payload must retain the same semantics for every retry and redrive of this identity.
 */
export type EmailDeliveryIdentity = {
    /**
     * The queue that owns this delivery.
     */
    readonly queueName: string;

    /**
     * The owner-assigned identity retained across job retries.
     */
    readonly deliveryId: string;
};

/**
 * Contract for sending transactional emails, keeping the provider swappable behind the port.
 */
export interface IEmailerPort {
    /**
     * Sends an email.
     *
     * @param data The recipient, subject, and body of the email
     * @param delivery The owning queue and stable delivery identity
     * @throws {ResourceConflictException} When the provider has already observed different payload under this logical delivery identity.
     * @throws {DependencyUnavailableException} When a recognized provider availability, rate-limit, or concurrent-request failure prevents delivery.
     * @throws {SystemException} When delivery fails for configuration, quota, validation, or ambiguous/unrecognized reasons.
     */
    sendEmail(data: EmailPayload, delivery: EmailDeliveryIdentity): Promise<void>;
}
