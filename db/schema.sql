-- Sanitrace — Equipment Cleaning Log schema
--
-- Re-runnable: drops in reverse dependency order, then recreates.
--
-- A note on string types: in PostgreSQL `text` and `varchar(n)` share the same
-- varlena storage and the same operators, so there is no performance difference
-- between them (`varchar(n)` costs a few extra cycles on write for the length
-- check). The sized types below are therefore a *domain constraint* — a last
-- line of defence so that a bug bypassing request validation still cannot
-- write a 4,000-character asset tag.

begin;

drop table if exists audit_entries;
drop table if exists audit_change_sets;
drop table if exists cleaning_records;
drop table if exists cleaning_methods;
drop table if exists equipment;
drop table if exists users;
drop function if exists audit_append_only();
drop type if exists cleaning_status;
drop type if exists equipment_status;

create extension if not exists pgcrypto;   -- gen_random_uuid()

create type equipment_status as enum ('active', 'retired');
create type cleaning_status  as enum ('pending', 'verified');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table users (
    id   uuid primary key default gen_random_uuid(),
    name varchar(100) not null,
    role varchar(20)  not null default 'operator'
         constraint users_role_valid check (role in ('operator', 'supervisor'))
);

-- ---------------------------------------------------------------------------
-- Equipment. Never hard-deleted: retired equipment must keep its cleaning
-- history for the regulatory retention period.
-- ---------------------------------------------------------------------------
create table equipment (
    id         uuid primary key default gen_random_uuid(),
    name       varchar(100) not null,
    code       varchar(20)  not null unique,   -- asset tag on the machine, e.g. 'MT-003'
    status     equipment_status not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Approved, versioned cleaning procedures. An operator selects an approved
-- SOP; they do not type prose into what is a legal record.
-- ---------------------------------------------------------------------------
create table cleaning_methods (
    id        uuid primary key default gen_random_uuid(),
    code      varchar(30)  not null unique,    -- 'SOP-CLN-014'
    name      varchar(100) not null,
    type      varchar(10)  not null
              constraint cleaning_methods_type_valid
              check (type in ('cip', 'manual', 'solvent', 'dry')),
    version   int     not null default 1,
    is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- One row per cleaning event. No delete path: an audit-controlled GMP log is
-- append-and-amend only, and every amendment is captured in the audit trail.
-- ---------------------------------------------------------------------------
create table cleaning_records (
    id           uuid primary key default gen_random_uuid(),
    equipment_id uuid not null references equipment(id),
    cleaned_by   uuid not null references users(id),
    cleaned_at   timestamptz  not null,
    method_id    uuid not null references cleaning_methods(id),
    notes        varchar(1000),                -- floor observations need room
    status       cleaning_status not null default 'pending',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),

    -- Contemporaneous recording (the "C" in ALCOA): you cannot record a
    -- cleaning that has not happened yet.
    --
    -- Compared against updated_at, not created_at. created_at is frozen at
    -- insert, so comparing to it would reject a legitimate later correction:
    -- a record written last week could never have its cleaning time amended to
    -- yesterday, even though yesterday is firmly in the past. updated_at is
    -- set to now() on every write, so the invariant this expresses is
    -- "a cleaning time may not be in the future as of when the row was last
    -- written" -- which is the rule actually intended.
    constraint cleaning_records_not_future
        check (cleaned_at <= updated_at + interval '1 minute')
);

-- Serves the keyset page exactly:
--   where equipment_id = $1 [and status = $2]
--   order by cleaned_at desc, id desc
create index cleaning_records_page_idx
    on cleaning_records (equipment_id, cleaned_at desc, id desc);

create index cleaning_records_status_page_idx
    on cleaning_records (equipment_id, status, cleaned_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Audit trail, in two tables.
--
-- who / when / why is per *edit*  -> audit_change_sets (one row)
-- old -> new       is per *field* -> audit_entries     (one row per change)
--
-- Repeating the reason on every field row would be denormalized, and grouping
-- field rows in the UI by timestamp alone would be a heuristic rather than a
-- fact. The change-set id makes the grouping explicit.
-- ---------------------------------------------------------------------------
create table audit_change_sets (
    id         uuid primary key default gen_random_uuid(),
    record_id  uuid not null references cleaning_records(id),
    action     varchar(10) not null
               constraint audit_change_sets_action_valid
               check (action in ('create', 'update')),
    reason     varchar(500),
    changed_by uuid not null references users(id),
    changed_at timestamptz not null default now()
);

create index audit_change_sets_record_idx
    on audit_change_sets (record_id, changed_at desc, id desc);

-- old_value / new_value are sized from the widest column they mirror
-- (cleaning_records.notes, 1000). If they were narrower, editing a long note
-- would fail to be audited -- a correctness bug in the audit trail itself.
create table audit_entries (
    id            bigserial primary key,
    change_set_id uuid not null references audit_change_sets(id),
    field         varchar(50) not null,
    old_value     varchar(1000),
    new_value     varchar(1000)
);

create index audit_entries_change_set_idx on audit_entries (change_set_id);

-- ---------------------------------------------------------------------------
-- 21 CFR Part 11 requires that the audit trail be neither editable nor
-- deletable. This is enforced in the database rather than in application code,
-- because an application-level guard is bypassed by anything else that holds a
-- connection -- a migration, a psql session, a second service.
-- ---------------------------------------------------------------------------
create or replace function audit_append_only() returns trigger as $$
begin
    raise exception
        'audit trail is append-only (21 CFR Part 11): % attempted on %',
        tg_op, tg_table_name;
end;
$$ language plpgsql;

create trigger audit_change_sets_no_update before update on audit_change_sets
    for each row execute function audit_append_only();
create trigger audit_change_sets_no_delete before delete on audit_change_sets
    for each row execute function audit_append_only();
create trigger audit_entries_no_update before update on audit_entries
    for each row execute function audit_append_only();
create trigger audit_entries_no_delete before delete on audit_entries
    for each row execute function audit_append_only();

commit;
