/**
 * @file upload-error.ts
 * @description Categorized S3 and workflow API response failures.
 */

/**
 * Categorized browser or HTTP failure with optional provider code.
 */
export class UploadError extends Error {
    /**
     * HTTP status, when a response was received.
     */
    readonly status: number | undefined;
    /**
     * S3 or API error code, when present.
     */
    readonly code: string | undefined;
    /**
     * True when the request could have succeeded despite a lost response.
     */
    readonly ambiguous: boolean;

    /**
     * Builds a failure that the scheduler can classify.
     *
     * @param message Readable failure description.
     * @param status HTTP status, if known.
     * @param code Provider error code, if known.
     * @param ambiguous Whether the response could have been lost.
     */
    constructor(message: string, status?: number, code?: string, ambiguous = false) {
        super(message);
        this.name = 'UploadError';
        this.status = status;
        this.code = code;
        this.ambiguous = ambiguous;
    }
}

/**
 * Extracts a readable error from S3 XML, JSON, or an empty body.
 *
 * @param status HTTP status.
 * @param body Raw response body.
 * @returns Categorized upload error.
 */
export function parseUploadError(status: number, body: string): UploadError {
    let code: string | undefined;
    let message: string | undefined;
    try {
        const json: unknown = JSON.parse(body);
        if (typeof json === 'object' && json !== null) {
            const record = json as Record<string, unknown>;
            const error = typeof record['error'] === 'object' && record['error'] !== null ? record['error'] : json;
            const detail = error as Record<string, unknown>;
            code = typeof detail['code'] === 'string' ? detail['code'] : undefined;
            message = typeof detail['message'] === 'string' ? detail['message'] : undefined;
        }
    } catch {
        code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1];
        message = /<Message>([^<]*)<\/Message>/.exec(body)?.[1];
    }
    return new UploadError(message || `Upload request failed (HTTP ${status}).`, status, code);
}

/**
 * Reads a workflow API's data/error envelope without assuming a JSON error body.
 *
 * @param response Workflow HTTP response.
 * @returns Data from a successful envelope.
 */
export async function parseUploadApiResponse<T>(response: Response): Promise<T> {
    const body = await response.text();
    if (!response.ok) {
        throw parseUploadError(response.status, body);
    }
    let value: unknown;
    try {
        value = JSON.parse(body);
    } catch {
        throw new UploadError('Upload API returned an invalid JSON response.');
    }
    if (typeof value !== 'object' || value === null || !('data' in value)) {
        throw new UploadError('Upload API response has no data.');
    }
    return (value as { data: T }).data;
}
