# Sanitrace — Equipment Cleaning Log

A small full-stack slice of a pharmaceutical-manufacturing system: a log of
equipment cleaning events with a **field-level audit trail**.

Equipment is cleaned between production runs, and every change to a cleaning
record has to be traceable for a regulatory audit — who changed it, when, and
what the value was before. That audit trail is the centre of this project.

- **Database** — PostgreSQL, plain SQL schema and seed
- **API** — Node + TypeScript + Express, raw parameterized SQL via `pg`, zod at the boundary
- **Front-end** — React + TypeScript (Vite), shadcn/ui + Tailwind, react-hook-form + zod

Design decisions and trade-offs are in [NOTES.md](NOTES.md).

---

## Prerequisites

| | |
|---|---|
| Node | 20 or newer (developed on 23.3) |
| PostgreSQL | 13 or newer, running locally (developed on 15.5) |

A Postgres superuser (or any role with `CREATEDB`) is needed once, to create the
database.

## 1. Install

```bash
npm install
```

One install at the repository root covers both workspaces (`api` and `web`).

## 2. Configure

```bash
cp .env.example .env
```

Then edit `.env` and set `PGPASSWORD` to your local Postgres password. The
defaults for host, port, user and database names work for a standard local
install:

```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_postgres_password
PGDATABASE=sanitrace
TEST_PGDATABASE=sanitrace_test
PORT=4000
WEB_ORIGIN=http://localhost:5173
```

`.env` is gitignored. A single file at the root serves both workspaces.

## 3. Set up the database

```bash
npm run db:setup
```

This creates the `sanitrace` database if it does not exist, applies
[`db/schema.sql`](db/schema.sql), then [`db/seed.sql`](db/seed.sql). It is safe
to re-run: the schema drops and recreates its own objects, so this is also how
you reset to a clean state.

```bash
npm run db:setup -- --no-seed   # schema only
npm run db:setup -- --test      # the test database
```

<details>
<summary>Prefer to run the SQL by hand (DBeaver, psql)?</summary>

```sql
CREATE DATABASE sanitrace;
```

Then, connected to `sanitrace`, run `db/schema.sql` followed by `db/seed.sql`.
Both are ordinary scripts with no placeholders.
</details>

The seed gives you 4 pieces of equipment, 6 cleaning procedures, 3 users, and 36
cleaning records — 30 of them on `MT-003`, which is enough to page through.

## 4. Run it

Two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- API — <http://localhost:4000> (health check at `/api/health`)
- Front-end — <http://localhost:5173>

Pick an **Acting as** user in the header. That choice is sent as `X-User-Id` on
every request, so `cleanedBy` and the audit trail's "who" are real. Switching
users is also how you exercise the four-eyes rule — see below.

## 5. Test

```bash
npm test
```

**88 tests.** 56 of them run with no database at all (the audit diff, the status
rules, the cursors, and the front-end's patch builder). The 32 integration tests
need Postgres running; they create and reset `sanitrace_test` themselves and
never touch `sanitrace`.

```bash
npm run test:api    # unit + integration
npm run test:web
npm run typecheck
```

---

## Things worth trying

Log in as **Priya Sharma** (operator), open `MT-003`, and log a cleaning. Then:

1. **Open its History.** The `create` change set lists every field with no old
   value — the record's origin.
2. **Amend just the notes.** The trail gains exactly one entry, for `notes`
   alone. Save again without changing anything and the trail does not grow at
   all.
3. **Try to verify your own record.** Still acting as Priya, set the status to
   `verified` — refused with `SELF_VERIFICATION_FORBIDDEN`. Switch to **Ravi
   Kumar** and it succeeds; the "Verified by" column fills in.
4. **Amend the method of that verified record.** The sign-off is withdrawn
   automatically and the record returns to `pending`, with the reason recorded.
5. **Withdraw a verification by hand.** Setting a verified record back to
   `pending` asks for a reason before it will save.
6. **Page through the log.** "Load more" walks the cursor; new cleanings logged
   meanwhile do not disturb the walk.

## API

All routes are under `/api`. Writes require an `X-User-Id` header.

| Method | Path | |
|---|---|---|
| GET | `/equipment` | `?status=&limit=&cursor=` |
| POST | `/equipment` | |
| GET | `/equipment/:id` | |
| PATCH | `/equipment/:id` | |
| DELETE | `/equipment/:id` | retires; never deletes |
| GET | `/equipment/:id/cleaning-records` | `?status=&limit=&cursor=` |
| POST | `/equipment/:id/cleaning-records` | |
| GET | `/cleaning-records/:id` | |
| PATCH | `/cleaning-records/:id` | accepts `reason` |
| GET | `/cleaning-records/:id/audit` | `?limit=&cursor=` |
| GET | `/cleaning-methods` | `?includeInactive=true` |
| GET | `/users` | |

Paginated responses:

```json
{ "data": [], "nextCursor": "eyJzb3J0...", "hasMore": true }
```

Errors, always in one shape:

```json
{ "error": { "code": "REASON_REQUIRED", "message": "...", "details": {} } }
```

| Code | Status | |
|---|---|---|
| `VALIDATION_FAILED` | 400 | body or query failed schema validation; `details` is keyed by field, with object-level failures under `_form` |
| `MALFORMED_JSON` | 400 | body is not valid JSON |
| `INVALID_CURSOR` | 400 | cursor is unreadable, forged, or belongs to another collection |
| `INVALID_PARAMETER` | 400 | a parameter could not be used by the query |
| `CONSTRAINT_VIOLATION` | 400 | a database rule rejected the value |
| `REASON_REQUIRED` | 400 | withdrawing a verification needs a reason |
| `USER_REQUIRED` | 401 | a write arrived with no `X-User-Id` |
| `UNKNOWN_USER` | 401 | `X-User-Id` does not match a user |
| `NOT_FOUND` | 404 | |
| `DUPLICATE_VALUE` | 409 | unique constraint; `details` names the field |
| `REFERENCE_MISSING` | 409 | a referenced row disappeared mid-write |
| `EQUIPMENT_RETIRED` | 409 | cannot log against retired equipment |
| `METHOD_INACTIVE` | 409 | the procedure is superseded |
| `SELF_VERIFICATION_FORBIDDEN` | 409 | four-eyes rule |
| `AUDIT_TRAIL_IMMUTABLE` | 409 | something tried to rewrite history |
| `PAYLOAD_TOO_LARGE` | 413 | body over 64 kB |

### By hand

```bash
curl "http://localhost:4000/api/users"
```

```bash
curl "http://localhost:4000/api/equipment?status=active"
```

```bash
curl "http://localhost:4000/api/equipment/<equipment-id>/cleaning-records?limit=5"
```

Writes need the `X-User-Id` header — every change to an audited record has to be
attributable, so a write without one is refused with `USER_REQUIRED` rather than
being recorded against nobody. Take an id from `/api/users`.

```bash
curl -X POST "http://localhost:4000/api/equipment/<equipment-id>/cleaning-records" -H "Content-Type: application/json" -H "X-User-Id: <user-id>" -d '{"cleanedBy":"<user-id>","cleanedAt":"2026-09-10T09:00:00Z","methodId":"<method-id>","notes":"Visual inspection passed."}'
```

```bash
curl -X PATCH "http://localhost:4000/api/cleaning-records/<record-id>" -H "Content-Type: application/json" -H "X-User-Id: <user-id>" -d '{"notes":"Second rinse required."}'
```

```bash
curl "http://localhost:4000/api/cleaning-records/<record-id>/audit"
```

## Layout

```
db/schema.sql                 tables, indexes, append-only audit triggers
db/seed.sql                   reference data and 36 cleaning records

api/src/audit/diff.ts         the field-level diff — pure, no I/O
api/src/domain/status.ts      four-eyes rule and status transitions — pure
api/src/pagination.ts         keyset cursors
api/src/services/            transaction orchestration
api/src/repos/               SQL
api/src/routes/              HTTP and validation

api/src/errors.ts             one response shape; Postgres and body-parser
                              failures translated here rather than leaking 500s

web/src/api/http.ts           transport: base URL, X-User-Id, ApiError, get/post/patch
web/src/api/client.ts         every call the app makes, one line each
web/src/hooks/usePaginatedList.ts   the load-more list state, written once
web/src/records/patch.ts      works out what a form submission changed — pure
web/src/components/AuditTrail.tsx        old → new, grouped by edit
web/src/components/CleaningRecordForm.tsx
web/src/components/ui/                   shadcn components (generated, except form.tsx)
web/src/pages/                           the two screens
```
