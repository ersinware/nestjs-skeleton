/**
 * @file throttler-name.enum.ts
 * @description Enumeration representing rate limiting configuration names.
 */

/**
 * The named limiters configured on the throttler module. A name identifies ONE window — a limit over
 * a duration — not what a route wants: routes ask for a policy, which resolves to one or more of these.
 *
 * The two critical windows exist because a single window cannot answer both shapes of attack. A short
 * one stops a fast automated burst but resets often enough to leave a slow attacker effectively
 * unlimited; a long one caps the sustained total but is too coarse to notice a burst. Applied together
 * they bound both, so neither has to be tightened to the point where it rejects real users — which
 * matters here because the tracker is still an IP address, and an IP can be shared by an entire office.
 */
export enum ThrottlerName {
    DEFAULT = 'default',
    CRITICAL_BURST = 'critical-burst',
    CRITICAL_SUSTAINED = 'critical-sustained',
}
