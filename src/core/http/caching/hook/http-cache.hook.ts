/**
 * @file http-cache.hook.ts
 * @description Fastify `onSend` hook completing the HTTP cache contract: a `Cache-Control` on every response, an `ETag` / `304` on cacheable reads.
 */

import { createHash } from 'crypto';
import type { DoneFuncWithErrOrRes, FastifyReply, FastifyRequest } from 'fastify';
import { HEADER_CACHE_CONTROL, HttpCachePolicy } from 'src/core/http/caching/http-cache-policy.enum';
import { isSafeMethod } from 'src/core/http/caching/safe-method.util';

/**
 * Validator header carrying the body's fingerprint.
 */
const HEADER_ETAG = 'etag';

/**
 * Conditional request header the client returns its stored `ETag` in.
 */
const HEADER_IF_NONE_MATCH = 'if-none-match';

/**
 * The validator half of HTTP caching, placed where every response passes — including those no
 * interceptor sees (guard refusals, unmatched routes):
 *
 * - A response without `Cache-Control`, or with an error status, leaves as `no-store`; a route's
 *   policy describes its resource, not the filter's error body.
 * - A `200` to GET/HEAD under a storing policy gets a weak `ETag` of the serialized body and
 *   answers a bodiless `304` when `If-None-Match` already holds it.
 *
 * The tag fingerprints the body, not an entity version: it saves the transfer, never the query.
 * Weak because the comparison is over the JSON rendering, not exact bytes.
 *
 * @param request The incoming request, read for its method and `If-None-Match`.
 * @param reply The outgoing reply, whose cache headers and status are written here.
 * @param payload The serialized body about to be sent.
 * @param done Continues sending; passed `null` to drop the body on a `304`.
 */
export function httpCacheHook(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
    done: DoneFuncWithErrOrRes,
) {
    if (reply.statusCode >= 400 || !reply.hasHeader(HEADER_CACHE_CONTROL)) {
        reply.header(HEADER_CACHE_CONTROL, HttpCachePolicy.NO_STORE);
    }

    const isValidatable =
        isSafeMethod(request.method) &&
        reply.statusCode === 200 &&
        reply.getHeader(HEADER_CACHE_CONTROL) !== HttpCachePolicy.NO_STORE &&
        (typeof payload === 'string' || Buffer.isBuffer(payload));

    if (!isValidatable) {
        done();

        return;
    }

    const etag = `W/"${createHash('sha1').update(payload).digest('base64url')}"`;

    reply.header(HEADER_ETAG, etag);

    if (matchesIfNoneMatch(request.headers[HEADER_IF_NONE_MATCH], etag)) {
        // RFC 9110 § 15.4.5: a 304 carries the validator but no representation headers or body.
        reply.code(304).removeHeader('content-type').removeHeader('content-length');
        done(null, null);

        return;
    }

    done();
}

/**
 * Weak comparison of `If-None-Match` against the response's entity-tag (RFC 9110 § 13.1.2): `*`
 * matches anything, otherwise any listed tag whose opaque part equals ours.
 *
 * @param header The raw `If-None-Match` value, absent on an unconditional request.
 * @param etag The entity-tag computed for this response.
 * @returns `true` when the client already holds the current representation.
 */
function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
    if (!header) {
        return false;
    }

    if (header.trim() === '*') {
        return true;
    }

    const opaqueTag = stripWeakPrefix(etag);

    return header.split(',').some((candidate) => stripWeakPrefix(candidate.trim()) === opaqueTag);
}

/**
 * Drops the `W/` weakness indicator so tags compare on their opaque part alone.
 *
 * @param tag An entity-tag, strong or weak.
 * @returns The quoted opaque tag.
 */
function stripWeakPrefix(tag: string): string {
    return tag.startsWith('W/') ? tag.slice(2) : tag;
}
