# Portfolio 1.1 CMS Testing and Publication Readiness

## Status

The Supabase CLI is available as a project dependency. This Windows environment has Node.js 22.15.0 and npm 10.9.2, but no Docker Desktop or local PostgreSQL server. The local Supabase stack and its pgTAP suite therefore have not been run here. No production project has been linked or contacted.

The static-content validator in `scripts/validate-content.mjs` is the current public-content contract. The repository does not yet contain strict JSON Schema definitions for every collection. The exporter below is a deterministic, validated preview for already-approved snapshots, not a complete publisher or a replacement for a formal schema.

## Repeatable local database test

On an administrator-approved Windows machine with Docker Desktop:

```powershell
npm ci
npx supabase start
npm run test:db
npx supabase stop
```

Run these commands from the repository root in an unlinked local checkout. Do not link the production project, run `db push`, or use a production database password. `supabase start` applies the local migrations; `npm run test:db` runs `supabase test db` against that local database.

The SQL tests are in `supabase/tests/portfolio_cms.test.sql`. They exercise table RLS and direct grants, server-only ordering RPC execution, storage bucket visibility/read-policy boundaries, import order, deterministic append, reorder transactions, optimistic-concurrency rejection, version restoration, and version/audit immutability. `tests/supabase-security.test.mjs` separately tests the Edge Function owner and TOTP gates using mocks. Mocked tests are not evidence of live Auth, MFA, database, or Storage behavior.

If local containers cannot be approved, request an isolated non-production Supabase test project with disposable data and separate keys. Never use the production project as a test environment. Keep any local test credentials outside the repository and out of logs.

## Test coverage boundaries

| Area | Local code coverage | Required live verification |
|---|---|---|
| Migrations, RLS, SQL RPCs, versions, audit | pgTAP suite; run with `npm run test:db` | Execute against local Supabase before any hosted review |
| Owner/non-owner and MFA-sensitive Edge actions | Node mock tests, including no-AAL2/no-TOTP rejection | Real local Auth users, verified TOTP, owner and non-owner JWTs against locally served functions |
| Storage bucket permissions | pgTAP checks bucket visibility and absence of broad read policies | Upload an approved test image; verify anonymous/private object reads fail, owner preview succeeds through a short-lived signed URL, and approval alone copies it to the public-read bucket |
| Concurrency | Expected-order pgTAP stale-token test and mocked HTTP conflict test | Two concurrent local requests with the same expected order; exactly one may succeed |
| Public build/export | Serializer tests call the existing `validateContent` validator | Validate generated candidate files and assets in the publication pull request |

These are not production checks. No hosted migration, Edge Function, Auth, RLS, or Storage operation is authorized by this document.
The pgTAP ordering assertions exercise stale snapshots sequentially; they are not a two-session concurrency test.

## Database migration safety notes

The additive `20261124010000_portfolio_cms_integrity.sql` migration validates existing media bucket settings and fails instead of changing them. Required configuration:

| Bucket | Public | Size limit | Allowed MIME types |
|---|---:|---:|---|
| `portfolio-media-private` | `false` | 10 MiB | PNG, JPEG, WebP |
| `portfolio-media-public` | `true` | 10 MiB | PNG, JPEG, WebP |

Before applying migrations, inspect the existing bucket configuration and Storage policies using a read-only SQL session:

```sql
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('portfolio-media-private', 'portfolio-media-public');

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects';

select bucket_id, count(*) as object_count
from storage.objects
where bucket_id in ('portfolio-media-private', 'portfolio-media-public')
group by bucket_id;
```

If the private bucket is public or either bucket has a different limit or MIME allowlist, stop. Review object inventory, access policies, and callers before manually reconciling; do not blindly flip visibility or replace settings because existing public assets may depend on them. The migration performs no bucket updates. Its validation function raises an error on drift and is not executable by application roles.

The migration also replaces version-ID-only foreign keys with deferred composite foreign keys, ensuring a CMS record's draft and published versions belong to that same record. It aborts if existing pointers are inconsistent rather than repairing them silently.

CMS versions and audit events now revoke application-role `UPDATE`, `DELETE`, and `TRUNCATE`; statement-level triggers also reject truncation. These protections do not make history tamper-proof against the database owner or a superuser, who can alter privileges or disable triggers. `portfolio_alert_slots` is operational notification-deduplication data, not a message/audit log: entries older than 90 days are lazily removed on a subsequent insert. The interval preserves a useful troubleshooting window while old slots cannot affect the current 15-minute alert deduplication window.

## Ordering contract

`cms_records.collection_order` is a zero-based integer, unique within each `record_type`. Every `publicBaseline` row carries an explicit zero-based `collectionOrder` copied from its source JSON array. The seed RPC rejects duplicate or gapped positions and synchronizes existing baseline rows from that field. Existing records receive a deterministic migration fallback ordered by creation time, record key, and ID, because an old database cannot reconstruct a JSON array order it never stored. After applying the additive ordering migration in a test environment, re-import the current public baseline before editing or exporting. Non-baseline records are retained after baseline entries in their previous deterministic order.

New records append at the next collection position under a transaction-scoped lock. The dashboard's Up/Down controls submit both the observed ID order and the requested full order. The server serializes reorder requests per collection, rejects stale observed orders, verifies the requested IDs contain every record of that type exactly once, updates atomically, and appends an immutable audit event containing the before/after ID sequences. Restoring a content version does not alter `collection_order`. CMS ordering changes do not publish or modify the static site.

## Deterministic preview export

`serializeApprovedCmsRecords()` in `scripts/export-public-content.mjs` takes an explicit projection of records with exactly these fields:

- `recordType`
- `recordKey`
- `collectionOrder`
- `publishedVersionId`
- `publicPayload`

This helper is only a deterministic in-memory serializer, not an approval boundary. It currently checks that `publishedVersionId` is a UUID, but cannot prove that the separately supplied `publicPayload` belongs to that version or that the CMS record is currently publishable; the input also has no record publication state. The adapter that eventually reads Supabase must join each record to its `published_version_id`, pass that exact immutable version's payload, and reject archived/unpublished record states before invoking this helper. Until that trusted adapter and state contract exist, do not treat helper output as approved publication data. Draft visibility, private fields, duplicate record/order, order gaps, invalid references, or repository-validator failure abort serialization. The serializer returns the nine current public JSON collections in memory; it never writes files, reads credentials, calls Supabase, or publishes.

The existing validator is not a strict schema: it does not define allowed keys for every content type. The serializer therefore only claims compatibility with the current CMS validation plus repository `validate-content.mjs`; it does not claim a formal, closed-world JSON Schema. Before enabling publication, define versioned schemas and tests for each collection, including approved-media path mapping, archive/removal semantics, and how an approved version becomes the new `published_version_id`.

## Future secure publishing pipeline

1. **Owner dashboard:** the existing owner signs in through Supabase Auth and verifies TOTP. The server independently checks the owner ID and AAL2/TOTP for every mutation.
2. **Private draft:** the dashboard saves immutable CMS versions with optimistic concurrency. Drafts remain private and the static site remains unchanged.
3. **Explicit approval:** require a fresh MFA-protected confirmation of a specific immutable version and its content digest. An approval must not mean “whatever draft is current later.”
4. **Server-side GitHub App:** a private worker retrieves that exact version, validates references and private fields, maps approved media into repository-relative assets, serializes explicit collection order, and creates or resumes a dedicated branch.
5. **Pull request:** open/update a PR for that branch; never write directly to `main`. PR CI runs `npm test`, `npm run validate`, `npm run privacy-check`, `npm run dashboard:build`, and `npm run build`.
6. **Approved merge:** require passing checks and protected-branch review. The merge commit is the publication approval boundary.
7. **GitHub Pages:** the existing workflow deploys after the approved merge. Mark the CMS attempt `live` only after observing the matching merge SHA and successful Pages deployment.

### Permissions and credential boundaries

- Install the GitHub App only on this repository. Grant the minimum required: Contents read/write to create a branch/commit and Pull requests read/write to open/update a PR. Grant Checks or Actions read only if needed to observe CI. Do not grant repository administration, branch-protection bypass, or permission to merge.
- Keep the App private key and webhook secret only in server-side Supabase Function secrets. Mint short-lived installation tokens on the server. Verify webhook signatures and expected repository, branch, PR, head SHA, and workflow identity.
- Never put App credentials in React, generated static assets, repository variables, browser storage, logs, or public CI artifacts. The Pages workflow should use its existing narrowly scoped `GITHUB_TOKEN` only for deployment.

### Failure handling, idempotency, audit, and status

- Bind each attempt to an idempotency key, approved version ID, and content digest. The same key returns the existing attempt/PR; retry after a timeout must not create another branch or PR. A different approved version requires a new key.
- Use server-owned, monotonic transitions: `prepared` → `checks_pending` → (`checks_failed` or `ready_to_merge`) → `merged` → `deployment_pending` → `live`. A valid explicit cancellation or terminal error may transition a nonterminal attempt to `cancelled` or `failed`. Ignore duplicate/out-of-order webhooks and reject mismatched SHAs.
- A PR, passing CI, merge, or queued deployment is not live success. Surface failure or pending status accurately; never report success until the corresponding Pages deployment is confirmed.
- Append an immutable audit event for approval/version/digest, attempt creation, branch/PR, CI outcome, merge SHA, deployment run, and final state. Do not log tokens, private keys, or full content bodies.
- Retries and failures keep drafts private and do not alter the public site. Public changes occur only after a protected merge and deployment.

## Release blockers

1. The local pgTAP suite has not been run because Docker/PostgreSQL are unavailable in this environment.
2. Live local Auth/TOTP, Edge Function, Storage signed-URL, and concurrent-request checks remain to be executed in an isolated Supabase environment.
3. Strict, versioned JSON Schemas and approved-media-to-repository mapping are not defined.
4. No publication approval transition updates `published_version_id`; GitHub App publication is not implemented.
5. Publication ordering, archive/removal semantics, webhook verification, protected-branch rules, and deployment confirmation require implementation and review before any release.
