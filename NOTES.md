# NOTES

Decisions, trade-offs, and what I left out.

---

## The shape of the audit trail

**Two tables, not one.** `audit_change_sets` holds one row per edit — who, when,
why. `audit_entries` holds one row per field that actually changed — old value,
new value.

The information splits along those lines naturally: *who/when/why* is a property
of the edit, *old → new* is a property of the field. Flattening it into a single
table would repeat the reason and the actor on every field row, and the UI would
then have to infer which rows belonged to the same edit by comparing timestamps
— a heuristic that breaks the moment two edits land in the same second. The
`change_set_id` makes the grouping a fact instead of a guess.

**Values are stored as display strings, not raw column values.** A method is
recorded as `SOP-CLN-021`, not as its uuid; a user as `Ravi Kumar`, not as an id.
The audience for this table is a person reading it during an audit, and making
them resolve a foreign key defeats the purpose. The cost is that a later rename
does not retroactively change the trail — which is arguably correct for an audit
record, since it says what the value *was called at the time*.

**`old_value` / `new_value` are `varchar(1000)`, sized from `notes`.** They have
to be at least as wide as the widest column they mirror. If they were narrower,
amending a long note would fail to be audited — a correctness bug in the exact
thing being graded.

**An edit that changes nothing writes nothing.** `diffRecord` returns an empty
array and `writeAudit` then creates no change set at all, so the record's
`updated_at` is not even touched. A trail full of entries that report no change
is a trail nobody will read.

**The diff is a pure function.** `api/src/audit/diff.ts` has no imports from the
rest of the app: no database, no clock, no user lookup. Every rule it enforces —
absent keys are not changes, a re-spelled timestamp is not a change, `''` and
`null` mean the same thing, only allow-listed fields are ever recorded — is
covered by a unit test that runs in milliseconds. The allow-list is an argument
rather than `Object.keys(after)` so that adding a bookkeeping column to the table
can never leak it into the audit trail.

## Pagination: keyset, not offset

Cursors over `(cleaned_at DESC, id DESC)`, with `(cleaned_at, id) < ($1, $2)` as
the page predicate. Two reasons, and the second is the real one:

1. **Cost.** `OFFSET n` makes Postgres walk and discard `n` rows. Page 500 of a
   cleaning log costs 500 pages of work. A cursor is an index range scan at any
   depth, and `cleaning_records_page_idx` matches the ORDER BY exactly.
2. **Correctness.** This is an append-heavy log read newest-first. With offsets,
   a cleaning logged while someone is paging shifts every later row by one, so
   the reader sees a row twice and misses another. For an audit report that is a
   defect, not a cosmetic issue. There is an integration test that inserts a row
   mid-walk and asserts every row is still yielded exactly once.

`limit` is clamped rather than rejected (default 20, max 100): a caller asking
for 10,000 rows gets a page, but can never make the database do unbounded work.
`hasMore` comes from fetching `limit + 1` rows, not from a `COUNT(*)` — on a
large log the count would cost more than the page, and would be stale by the
time it was returned.

Cursors are opaque base64url. The client must not construct one, because its
contents are a detail of the query's ORDER BY.

The trade-off keyset makes: **no page numbers, no jumping to page 7**. For a
"load more" audit log that is the right trade; for a table users expect to
random-access, it would not be. The UI is built as "Load more" to match.

## Raw SQL rather than an ORM

`pg` with parameterized queries. The three interesting pieces of this project —
the audit diff, tuple-comparison keyset pagination, and the append-only triggers
— are all clearer written directly than expressed through an ORM's query
builder, and the brief asks me to be able to explain every line.

Two places where that shows:

- Optional filters and cursors are written as nullable predicates
  (`where ($1::equipment_status is null or status = $1)`) rather than by
  concatenating SQL fragments. One query plan, no string building, nothing
  injectable.
- Partial updates use `coalesce($2, column)` where the column is `NOT NULL`,
  because there a `null` parameter can only mean "not supplied". `notes` is
  nullable, so it needs an explicit presence flag —
  `case when $5::boolean then $6 else notes end` — otherwise clearing a note
  would be indistinguishable from not touching it.

An ORM would have paid off if the schema were larger or if migrations needed to
be generated and rolled back. At six tables, it would mostly have added a layer
to explain.

## `varchar(n)` rather than `text`

Worth stating plainly because it is a common misconception: in PostgreSQL `text`
and `varchar(n)` use the same varlena storage and the same operators, and there
is **no performance difference** between them. If anything `varchar(n)` is
marginally slower on write, because the length constraint has to be checked.

I used sized `varchar` anyway, for data integrity rather than speed: a length
cap is a domain constraint at the last line of defence, so a bug that bypasses
request validation still cannot write a 4,000-character asset tag. Sizes are per
column and chosen from the domain — `varchar(20)` for an asset tag like
`MT-003`, `varchar(1000)` for floor observations, not one number applied
everywhere.

## Domain rules I chose to enforce, and why there

The brief's field list implies more rules than it states. Each of these is a real
requirement in a GMP context; the note is about *where* I enforced it.

**The audit trail is append-only, enforced by database triggers.** 21 CFR Part 11
requires that the trail can be neither edited nor deleted. I put this in the
database rather than in application code because an application-level guard is
bypassed by anything else that holds a connection — a migration, a psql session,
a second service. Two integration tests go around the API entirely and issue
`UPDATE` and `DELETE` directly, because that is the threat model.

**Four-eyes: the person who cleaned cannot verify.** Segregation of duties is the
reason `cleanedBy` and the acting user are tracked separately at all. Without it,
one person can sign off their own work and the `pending`/`verified` distinction
means nothing.

**`verifiedBy` is derived from the audit trail, not stored.** It is read back
from the change set that moved the record to `verified`. A stored column would be
a second source of truth that could drift from the trail, and the trail is the
record of authority. This makes the audit table load-bearing rather than
decorative. The lateral join is gated on the record's *current* status, so a
record that was verified and later reverted reports no verifier — presenting a
stale sign-off as current would be the worst kind of wrong.

**A substantive amendment withdraws the sign-off.** Changing what was cleaned,
when, or by whom means the earlier verification approved data that no longer
exists. The record returns to `pending` automatically, and the forced revert is
itself an audited change with a system-supplied reason. Editing only `notes` does
not trigger it.

**Withdrawing a verification by hand requires a reason.** It is exactly the
change an inspector will ask about.

**A record is always created `pending`.** Letting a caller create an
already-verified record would let one person perform and approve a cleaning in a
single request.

**`cleanedAt` cannot be in the future** (validated at the boundary, and again as
a `CHECK` constraint). Contemporaneous recording — the "C" in ALCOA. A minute of
slack absorbs clock skew between browser and server.

**Nothing is ever deleted.** Equipment is retired; `DELETE /equipment/:id`
performs that status change because it is what a client means, but the row
survives. There is no delete route for cleaning records at all.

**`cleaning_methods` is a lookup table.** `method` as free text was the weakest
part of the suggested model. In a real plant an operator selects an approved,
version-controlled SOP; they do not type prose into a legal record. Superseded
procedures stay in the table because historical records still reference them, but
they are not selectable for new work.

## Row locking

An amendment takes `SELECT ... FOR UPDATE` on the record before reading its
"before" state. Without it, two concurrent edits could each read the same
original value and each write an audit entry claiming to have changed it — the
trail would then be a plausible-looking lie. It is one line, and it is cheaper
than explaining that outcome later.

This is pessimistic locking, which serializes concurrent edits to the same
record. Optimistic concurrency (`If-Match` on a version column, 409 on conflict)
would be better UX for a form a person has had open for a while — see below.

## The front-end stack

**shadcn/ui with Tailwind, and react-hook-form + zod for the form.** The tables
and every control come from `components/ui`, which is generated by the shadcn
CLI into the repo rather than installed as a dependency — so the components are
editable source, not a black box behind a version number.

Two things about that are worth knowing, because both are places where the code
does not look like the shadcn documentation:

**`components/ui/form.tsx` is hand-written.** `shadcn add form` currently
resolves to a registry entry with no files attached, so the CLI adds nothing —
it reports success and writes not a single line. The file in this repo is the
same component API as the published one, with two adjustments for the
`base-nova` style: `cn` is imported from the `cn` package (as every other
generated file here does), and `FormControl` clones its child instead of using
Radix's `Slot`, which this style does not depend on.

**Selects pass an `items` map.** shadcn's current default style is built on
**Base UI**, not Radix, and Base UI's `Select.Value` renders the raw *value*
rather than the selected item's label. For a select whose values are uuids that
means a trigger displaying `e92550fd-6f4a-…` instead of a person's name — which
is exactly what happened on the first render. Passing
`items={{ [value]: label }}` to the root is the documented fix, and every
select in the app does it.

**Validation is duplicated on purpose.** `CleaningRecordForm` has its own zod
schema mirroring the API's. The server stays the authority — a browser check is
a courtesy to whoever is typing, not a guarantee — but it turns a failed round
trip into instant feedback. The client schema also carries the same
"not in the future" rule as the API, so the most likely mistake never leaves
the page. The two are small enough that a drift shows up in the integration
tests.

The cost of all of this is bundle size: 157 kB before, 427 kB after
(138 kB gzipped). For an internal tool behind a login that is a trade I would
make; for a public page I would look at it again.

## Structure

`audit/diff.ts` and `domain/status.ts` are pure and hold all the rules.
`services/` sequences them inside one transaction. `repos/` is SQL.
`routes/` is HTTP and validation. The point of the split is that the two things
worth reading closely — the diff and the status rules — can be understood and
tested without a database anywhere in sight.

The record write and its audit rows always commit together, through
`withTransaction`. A record cannot exist without the trail that explains it.

## Things I deliberately did not build

- **Real authentication.** The acting user comes from an `X-User-Id` header,
  resolved against the `users` table and rejected if unknown. It is a header,
  not a session — but it is a *resolved user row*, so the audit trail's "who" is
  always a real person. Replacing it means changing one middleware file; nothing
  downstream knows where the actor came from. Proper Part 11 electronic
  signatures (re-entering credentials at the moment of signing) would be the
  next step after real auth.
- **Docker / docker-compose.** Postgres was already installed locally, so a
  Node-based setup script that reuses the API's own connection settings was more
  useful than a container — if `db:setup` works, the API can connect. On a
  machine without Postgres, compose would be the better answer.
- **Optimistic concurrency.** No `version` column or `If-Match`. Two people
  editing the same record are serialized by the row lock rather than being told
  they conflicted.
- **A router in the front-end.** Two screens selected by state. A router is the
  right call the moment an audit record needs a shareable URL — genuinely
  valuable for this kind of tool — but it is not what the exercise is being read
  for, so I left it out rather than half-build it.
- **Audit on `equipment` as well as records.** The brief asks for it on cleaning
  records. `diffRecord` is generic over its field list, so extending it would
  mean adding an `entity_type` to the audit tables and calling the same function
  — the design allows for it and I stopped at the requirement.
- **Clean-hold / dirty-hold time.** Equipment cleaned but left idle past its
  clean hold time counts as dirty again. Modelling that (an interval on
  `equipment`, a derived `clean` / `expiring` / `expired` state) is the single
  most useful thing to add next, and it is why `cleanedAt` matters beyond being
  a timestamp.
- **Hash-chained audit rows** (each row carrying the hash of its predecessor) to
  make tampering detectable even with direct database access. The triggers stop
  the ordinary case; a chain would be defence in depth. I judged it past the
  point of over-building for a four-to-six hour exercise.
- **Shared types package.** `web/src/api/types.ts` mirrors the API's types by
  hand. A third workspace would remove the duplication and add a build graph;
  at this surface area the copy is cheaper, and a drift shows up immediately in
  the client functions.
- **An accessibility pass.** Tables and forms use real semantic elements and
  labels, but I have not tested with a screen reader or checked contrast
  properly.

## Assumptions I made where the brief was open

- `method` became a foreign key to a lookup table rather than free text.
- `cleanedBy` is a user reference, not a name string, so the four-eyes rule can
  compare identities.
- The audit endpoint returns change sets with their field entries nested, rather
  than a flat list of field changes, matching the two-table model.
- Equipment list is ordered by asset tag, which is how someone standing in front
  of a machine looks it up. `code` is unique, so that ordering is already total
  and its cursor needs no tie-breaker — unlike cleaning records, ordered by a
  timestamp that can repeat.
- `DELETE /equipment/:id` retires rather than deletes.

## If I had more time

In order: clean-hold-time warnings (turns the log from a record into a tool),
real auth with signature-on-verify, optimistic concurrency on the amend form,
audit coverage extended to equipment, and a router so an audit trail can be
linked to.
