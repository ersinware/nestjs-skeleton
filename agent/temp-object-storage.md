# TEMP — Object Storage

> Temporary holding file. This content was removed from `architecture.md` for later review. It is not yet an approved standalone guide.

## Current Rules

- `core/storage` is technical only. Owning workflows authorize uploads and choose keys, limits, and cache policy; do not expose a standalone upload/signing API.
- Use one S3 client with an endpoint reachable by backend and browser. Never rewrite presigned URLs; sign required upload headers and return them to clients. Conditional writes prevent overwrites, not URL reuse after deletion.
- Persist and return object keys; frontend configuration owns CDN URLs. Cache metadata never authorizes reads; protected objects require access control compatible with cache revocation.
- Permanent objects are immutable: replacements use new version keys; retries reuse the same key. Storage and database changes are not atomic, so cleanup must be resumable and occur only after the replacement commits or is superseded; persist cleanup identities with the mutation.
- Avatar workflows must preserve currently selected and in-flight selected objects, including older avatars reselected by valid proofs. Soft deletion retains Admin/User avatars; a missing writer result does not prove physical deletion, so orphan reconciliation must protect references on soft-deleted rows.
