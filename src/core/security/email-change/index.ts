/**
 * @file index.ts
 * @description Public entry point of the email-change security concern. Nothing outside may import past this barrel.
 */

export {
    EMAIL_CONFIRMATION_TOKEN_TYPE,
    TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT,
} from 'src/core/security/email-change/email-confirmation-token';
export type { EmailConfirmationTokenPayload } from 'src/core/security/email-change/email-confirmation-token';
export { EmailChangeModule } from 'src/core/security/email-change/module';
