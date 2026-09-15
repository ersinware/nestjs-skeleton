/**
 * @file delivery-routes.type.ts
 * @description Producer-supplied event routing, independent of the queue vendor.
 */

/**
 * Dependency injection token representing the {@link DeliveryRoutes} configuration.
 * Injects only the current producer's routes into its publisher.
 */
export const TOKEN_DELIVERY_ROUTES = Symbol('TOKEN_DELIVERY_ROUTES');

/**
 * Context-local routing supplied at module composition; queue names are stable consumer identities.
 */
export type DeliveryRoutes = {
    /**
     * Producer-owned delivery schema.
     */
    readonly schema: string;

    /**
     * Explicit nonempty target list per versioned event type.
     */
    readonly events: Readonly<Record<string, readonly [string, ...string[]]>>;
};
