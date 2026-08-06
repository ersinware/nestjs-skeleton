/**
 * @file logger.port.ts
 * @description Structured-only logging contract, its payload envelope and its injection token.
 */

/**
 * Dependency injection token representing the {@link ILoggerPort} contract.
 */
export const TOKEN_LOGGER_PORT = Symbol('TOKEN_LOGGER_PORT');

/**
 * Closed envelope every log call carries. No index signature, so a caller can never write a key
 * pino reserves (`level`, `time`, `msg`, …); free-form keys live only under `data`.
 */
export type LogPayload = {
    readonly class: string;
    readonly method: string;
    readonly message: string;
    readonly error?: unknown;
    readonly data?: Record<string, unknown>;
};

/**
 * Structured-only logging contract: every level takes {@link LogPayload}, so an unstructured
 * string can never enter the stream. Deliberately three levels — `debug` and `fatal` have no
 * caller and would only invite level drift.
 */
export interface ILoggerPort {
    /**
     * Records an operationally significant event.
     */
    info(payload: LogPayload): void;

    /**
     * Records a self-healing failure whose cause is worth a forensic breadcrumb.
     */
    warn(payload: LogPayload): void;

    /**
     * Records a failure a human must act on. Pairs with the exception tracker, never replaces it.
     */
    error(payload: LogPayload): void;
}
