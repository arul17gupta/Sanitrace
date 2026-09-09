-- Sanitrace — seed data
--
-- Enough rows to page through (30 records on MT-003) and to demonstrate the
-- audit trail without touching the API first. The audit rows written here
-- mirror exactly what api/src/audit/writer.ts produces at runtime:
-- one change-set header per edit, one entry per changed field.

begin;

-- ---------------------------------------------------------------------------
-- People. Cleaning is performed by operators and verified by a supervisor,
-- so the four-eyes rule (verifier must differ from the person who cleaned)
-- holds for every seeded record.
-- ---------------------------------------------------------------------------
insert into users (name, role) values
    ('Arun Nair',    'operator'),
    ('Priya Sharma', 'operator'),
    ('Ravi Kumar',   'supervisor');

-- ---------------------------------------------------------------------------
-- Approved cleaning procedures. SOP-CLN-009 is inactive: superseded
-- procedures stay in the table because historical records still reference
-- them, but they must not be selectable for new work.
-- ---------------------------------------------------------------------------
insert into cleaning_methods (code, name, type, version, is_active) values
    ('SOP-CLN-009', 'Rinse only - superseded',             'manual',  1, false),
    ('SOP-CLN-014', 'Manual wash - non-dedicated vessels', 'manual',  3, true),
    ('SOP-CLN-021', 'CIP Cycle A - aqueous products',      'cip',     2, true),
    ('SOP-CLN-022', 'CIP Cycle B - extended hot rinse',    'cip',     1, true),
    ('SOP-CLN-030', 'Solvent flush - IPA',                 'solvent', 4, true),
    ('SOP-CLN-041', 'Dry brush and vacuum',                'dry',     1, true);

-- ---------------------------------------------------------------------------
-- Equipment. BLN-005 is retired rather than deleted: its cleaning history
-- must survive for the regulatory retention period.
-- ---------------------------------------------------------------------------
insert into equipment (name, code, status) values
    ('Mixing Tank 3',     'MT-003',  'active'),
    ('Tablet Press A',    'TP-A',    'active'),
    ('Fluid Bed Dryer 2', 'FBD-002', 'active'),
    ('V-Blender 5',       'BLN-005', 'retired');

-- ---------------------------------------------------------------------------
-- Cleaning records, staggered backwards in time so keyset pagination has
-- something real to walk. Every third record is verified.
-- ---------------------------------------------------------------------------
with ops as (
    select array_agg(id order by name) as ids from users where role = 'operator'
),
mth as (
    select array_agg(id order by code) as ids
    from cleaning_methods
    where is_active
),
tgt as (
    select e.id as equipment_id, x.n_records
    from (values ('MT-003', 30), ('TP-A', 4), ('FBD-002', 2)) as x(code, n_records)
    join equipment e on e.code = x.code
)
insert into cleaning_records
    (equipment_id, cleaned_by, cleaned_at, method_id, notes, status, created_at, updated_at)
select
    t.equipment_id,
    ops.ids[1 + (g.n % array_length(ops.ids, 1))],
    ts.cleaned_at,
    mth.ids[1 + (g.n % array_length(mth.ids, 1))],
    case g.n % 4
        when 0 then 'Visual inspection passed, no visible residue.'
        when 1 then 'Final WFI rinse conductivity within limit.'
        when 2 then null
        else 'Gasket inspected; swab sample sent to QC for TOC analysis.'
    end,
    (case when g.n % 3 = 0 then 'verified' else 'pending' end)::cleaning_status,
    ts.cleaned_at + interval '25 minutes',
    ts.cleaned_at + interval '25 minutes'
from tgt t
cross join lateral generate_series(0, t.n_records - 1) as g(n)
cross join ops
cross join mth
cross join lateral (
    select now() - interval '30 minutes' - (g.n * interval '19 hours 7 minutes')
        as cleaned_at
) ts;

-- ---------------------------------------------------------------------------
-- Audit: the 'create' change set for every record. Values are stored
-- human-readable (a method as 'SOP-CLN-014', a user as their name) because an
-- inspector reads the trail directly and must not have to resolve a uuid.
-- Records seeded as verified were still created pending -- the transition is
-- a separate change set below.
-- ---------------------------------------------------------------------------
with cs as (
    insert into audit_change_sets (record_id, action, reason, changed_by, changed_at)
    select r.id, 'create', null, r.cleaned_by, r.created_at
    from cleaning_records r
    returning id, record_id
)
insert into audit_entries (change_set_id, field, old_value, new_value)
select cs.id, v.field, null, v.new_value
from cs
join cleaning_records r on r.id = cs.record_id
join cleaning_methods m on m.id = r.method_id
join users cu           on cu.id = r.cleaned_by
cross join lateral (values
    ('cleanedBy', cu.name),
    ('cleanedAt', to_char(r.cleaned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    ('method',    m.code),
    ('notes',     r.notes),
    ('status',    'pending')
) as v(field, new_value)
where v.new_value is not null;

-- ---------------------------------------------------------------------------
-- Audit: the verification change set. This is also what makes verifiedBy
-- derivable -- the API reads it from the trail rather than from a duplicate
-- column on the record.
-- ---------------------------------------------------------------------------
with cs as (
    insert into audit_change_sets (record_id, action, reason, changed_by, changed_at)
    select
        r.id,
        'update',
        'Verified after visual inspection of equipment.',
        (select id from users where role = 'supervisor' order by name limit 1),
        r.created_at + interval '2 hours'
    from cleaning_records r
    where r.status = 'verified'
    returning id, record_id
)
insert into audit_entries (change_set_id, field, old_value, new_value)
select cs.id, 'status', 'pending', 'verified'
from cs;

-- ---------------------------------------------------------------------------
-- One record carries a realistic correction, so the audit trail in the UI
-- shows a non-trivial multi-field diff straight after seeding.
-- ---------------------------------------------------------------------------
with target as (
    select r.id, m.code as old_code, r.notes as old_notes
    from cleaning_records r
    join cleaning_methods m on m.id = r.method_id
    join equipment e        on e.id = r.equipment_id
    where e.code = 'MT-003'
      and r.status = 'verified'
      and m.code <> 'SOP-CLN-021'
    order by r.cleaned_at desc
    limit 1
),
newm as (
    select id, code from cleaning_methods where code = 'SOP-CLN-021'
),
upd as (
    update cleaning_records r
       set method_id  = newm.id,
           notes      = 'Corrected: the automated CIP cycle was run, not a manual wash.',
           updated_at = r.updated_at + interval '3 hours'
      from target t, newm
     where r.id = t.id
    returning r.id, t.old_code, newm.code as new_code,
              t.old_notes, r.notes as new_notes, r.updated_at
),
cs as (
    insert into audit_change_sets (record_id, action, reason, changed_by, changed_at)
    select
        u.id,
        'update',
        'Operator selected the wrong SOP; corrected to the approved CIP cycle.',
        (select id from users where role = 'supervisor' order by name limit 1),
        u.updated_at
    from upd u
    returning id, record_id
)
insert into audit_entries (change_set_id, field, old_value, new_value)
select cs.id, v.field, v.old_value, v.new_value
from cs
join upd u on u.id = cs.record_id
cross join lateral (values
    ('method', u.old_code,  u.new_code),
    ('notes',  u.old_notes, u.new_notes)
) as v(field, old_value, new_value);

commit;
