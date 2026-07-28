/**
 * @file index.ts
 * @description Public entry point of the session concern. Nothing outside may import past this barrel.
 * Adapters are deliberately NOT exported: they are bound to their ports inside the module, so a
 * consumer can only reach the contract surface — never an adapter class.
 */

export * from 'src/core/security/session/module';
export * from 'src/core/security/session/port/session.port';
export * from 'src/core/security/session/port/state-cleaner.port';
export * from 'src/core/security/session/port/state-health.port';
export * from 'src/core/security/session/rotate-outcome.enum';
