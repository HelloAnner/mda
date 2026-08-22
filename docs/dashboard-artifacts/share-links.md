# Public Dashboard Share Links

## Purpose

A Share Link is a revocable access policy for exactly one immutable Publication. It never points to a Draft, Checkpoint, mutable Dashboard pointer, Agent Session, or Preview.

The public URL directly renders the published dashboard page:

```text
GET /s/<opaque-token>/
```

It does not expose a management shell, redirect to an API response, or invoke Pi.

## Lifecycle

```text
immutable Publication
        │
        │ create public Share Link
        ▼
active ───────────────→ revoked
   │
   └── time passes ───→ expired
```

Revocation is final. Expiry is evaluated from authoritative server time on every request.

## Token Security

- Tokens contain at least 256 bits of HMAC output encoded with base64url.
- PostgreSQL stores only SHA-256 token digests.
- The raw token is derived inside the Control Plane from a deployment secret and Share Link ID so an idempotent create retry can reproduce the same one-time response without storing plaintext.
- Token digest lookup is indexed and tenant-independent only for the public delivery decision.
- API responses and logs never expose token digests, signing keys, artifact keys, or credentials.
- A token authorizes only one Share Link and its fixed Publication.

The authorized create response contains the raw URL. Ordinary list and show responses return metadata without the raw token or URL.

## Access Policy

The first public mode is `public` and is permitted only when the Publication has no Query Bindings. This allows static or clearly labeled fixture-data dashboards.

When Query Revisions exist, public-live sharing must additionally verify that every pinned Query Revision is explicitly approved for anonymous execution. Until that backend slice exists, a Publication with declared Queries cannot be created, so it cannot accidentally become public.

Authenticated and snapshot modes remain separate future policies rather than aliases for public access.

## Persistence

`share_links` records:

- Tenant, Dashboard, immutable Publication, and access mode.
- Opaque token digest.
- Active or revoked state and optimistic version.
- Optional expiry.
- Creator, creation time, revoker, and revocation time.

The target Publication ID is immutable. Updating expiry or repointing a Share Link is not allowed in the first release; create another link instead.

## APIs

```text
POST /api/publications/:publicationId/share-links
GET  /api/dashboards/:dashboardId/share-links
GET  /api/share-links/:shareLinkId
POST /api/share-links/:shareLinkId/revoke
GET  /s/:token/
GET  /s/:token/*
```

Create accepts an optional `expiresInSeconds` bounded between one minute and one year. Revoke is idempotent.

Public delivery resolves the token digest, verifies active state and expiry, loads the fixed Publication bundle, then serves `index.html` or a normalized relative asset.

## Browser Security

Shared pages receive:

- Strict content-type allowlisting and `nosniff`.
- No referrer.
- A restrictive CSP with no external connections for static Publications.
- CSP sandboxing without same-origin privilege.
- No cookies, management access token, Object Storage credential, or permanent Runtime token.
- Immutable asset caching and no-store HTML.
- No access to source archives, Pi history, logs, or other Publication objects.

The bundle uses relative asset paths, so every asset remains under the same tokenized URL prefix.

## CLI

```text
mda share create --publication <publication-id> [--expires <duration>]
mda share list --dashboard <dashboard-id>
mda share show <share-link-id>
mda share revoke <share-link-id>
```

Durations accept `m`, `h`, and `d`, such as `30m`, `24h`, or `7d`. Create prints the direct public URL in human mode and returns `{ shareLink, url }` in JSON mode.

## Acceptance Criteria

1. Every Share Link points to one immutable Publication.
2. Create is idempotent and stores no plaintext token.
3. The URL directly renders `index.html` plus all relative assets.
4. Malformed, unknown, expired, and revoked tokens cannot read any bundle byte.
5. A token for one link cannot access another Publication.
6. Public requests receive no source, Session, credentials, or management APIs.
7. Public HTML has restrictive CSP, sandboxing, no-referrer, and no-store headers.
8. Revocation takes effect on the next request without rebuilding or deleting the Publication.
9. CLI create, list, show, and revoke work against the newest deployment.
10. A real browser renders the public link at desktop and mobile widths with no console errors.
