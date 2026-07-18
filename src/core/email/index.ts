/**
 * @file index.ts
 * @description Public entry point of the email concern. Nothing outside may import past this barrel.
 */

export * from 'src/core/email/adapter/emailer.adapter';
export * from 'src/core/email/email-payload.type';
export * from 'src/core/email/module';
export * from 'src/core/email/port/emailer.port';
