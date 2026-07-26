/**
 * @file trust-proxy.util.ts
 * @description Interprets the validated `TRUST_PROXY` setting into the value the HTTP adapter is
 * constructed with, so the client IP every downstream decision is keyed on cannot be dictated by the
 * client itself.
 */

import { ENV } from 'src/core/config/environment/environment.constant';
import { TRUST_PROXY_PATTERN } from 'src/core/config/environment/environment.validation';

/**
 * Reads `TRUST_PROXY` and interprets it for the Fastify adapter.
 *
 * This is the ONE place `process.env` is read directly rather than through `ConfigService`, and the
 * exception is structural rather than a shortcut: the HTTP adapter is constructed as an argument to
 * `NestFactory.create`, so it exists before the DI container that owns `ConfigService` does — the same
 * position `src/instrument.ts` already reads from.
 *
 * That ordering also decides the division of labour here. WHAT IS ACCEPTABLE is stated once, as
 * constraints on `EnvironmentVariables`, where every other variable's contract lives; those run during
 * `ConfigModule` init, moments after this function. This function only has to interpret, and to stay
 * safe in the meantime: a value outside the accepted shapes — `true` above all — resolves to "trust
 * nothing" rather than reaching the adapter. Boot still fails a moment later with the env class's
 * explanatory message, but at no instant does an adapter exist that believes a forged
 * `X-Forwarded-For`.
 *
 * @returns The value to hand Fastify: `false`, or the comma-separated proxy IP/CIDR list it parses.
 */
export function resolveTrustProxy(): boolean | string {
    const value = process.env[ENV.TRUST_PROXY]?.trim();

    if (!value || value === 'false' || !TRUST_PROXY_PATTERN.test(value)) {
        return false;
    }

    return value;
}
