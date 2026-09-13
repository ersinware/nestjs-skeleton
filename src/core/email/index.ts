/**
 * @file index.ts
 * @description Public entry point of the email concern. Nothing outside may import past this barrel.
 */

export { escapeHtml } from 'src/core/email/html-escape.util';
export { EmailModule } from 'src/core/email/module';
export { TOKEN_EMAILER_PORT, type EmailPayload, type IEmailerPort } from 'src/core/email/port/emailer.port';
