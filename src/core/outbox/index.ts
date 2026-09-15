/**
 * @file index.ts
 * @description Public entry point of the outbox concern. Nothing outside may import past this barrel.
 */

export { OutboxModule } from 'src/core/outbox/module';
export { TOKEN_OUTBOX_WRITER_PORT, type IOutboxWriterPort } from 'src/core/outbox/port/outbox-writer.port';
