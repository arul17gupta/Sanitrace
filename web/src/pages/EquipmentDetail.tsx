import { useCallback, useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { api } from '@/api/client';
import type { CleaningMethod, CleaningRecord, CleaningStatus, Equipment, User } from '@/api/types';
import { AuditTrail } from '@/components/AuditTrail';
import { CleaningRecordForm } from '@/components/CleaningRecordForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatTimestamp, orDash } from '@/format';
import { usePaginatedList } from '@/hooks/usePaginatedList';

interface Props {
  equipment: Equipment;
  users: User[];
  methods: CleaningMethod[];
  onBack: () => void;
}

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; record: CleaningRecord };

const ALL = 'all';

// See UserPicker: Base UI needs a value -> label map to render a label.
const STATUS_LABELS = { [ALL]: 'All', pending: 'Pending', verified: 'Verified' };

export function EquipmentDetail({ equipment, users, methods, onBack }: Props): JSX.Element {
  /**
   * Three pieces of state, each a genuinely different thing: which rows the
   * user wants to see, whether the form is open and in which mode, and which
   * record's history is expanded. The list itself -- rows, cursor, loading,
   * error -- lives in usePaginatedList.
   */
  const [status, setStatus] = useState<CleaningStatus | typeof ALL>(ALL);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [auditFor, setAuditFor] = useState<string | null>(null);

  const loadPage = useCallback(
    (cursor: string | null) =>
      api.listRecords(equipment.id, {
        ...(status === ALL ? {} : { status }),
        cursor,
        limit: 10,
      }),
    [equipment.id, status],
  );

  const records = usePaginatedList(loadPage, 'Could not load cleaning records');

  const handleSaved = (): void => {
    setForm({ mode: 'closed' });
    // Re-read from the first page: an amendment can change the record's status
    // and its position is fixed by cleanedAt, so a local patch would be a guess.
    records.reload();
  };

  return (
    <section className="grid gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeftIcon /> All equipment
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="flex items-baseline gap-2 font-heading text-lg font-semibold tracking-tight">
          <span className="font-mono text-sm text-muted-foreground">{equipment.code}</span>
          {equipment.name}
        </h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="record-status" className="text-xs text-muted-foreground">
              Status
            </Label>
            <Select
              items={STATUS_LABELS}
              value={status}
              onValueChange={(value) => setStatus(value as CleaningStatus | typeof ALL)}
            >
              <SelectTrigger id="record-status" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{STATUS_LABELS[ALL]}</SelectItem>
                <SelectItem value="pending">{STATUS_LABELS.pending}</SelectItem>
                <SelectItem value="verified">{STATUS_LABELS.verified}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => setForm({ mode: 'create' })}
            disabled={equipment.status === 'retired'}
            title={
              equipment.status === 'retired'
                ? 'Retired equipment is out of service'
                : 'Log a cleaning'
            }
          >
            Log a cleaning
          </Button>
        </div>
      </div>

      {form.mode === 'create' && (
        <CleaningRecordForm
          equipmentId={equipment.id}
          users={users}
          methods={methods}
          onSaved={handleSaved}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}

      {form.mode === 'edit' && (
        <CleaningRecordForm
          equipmentId={equipment.id}
          users={users}
          methods={methods}
          record={form.record}
          onSaved={handleSaved}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}

      {records.error !== null && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {records.error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cleaned at</TableHead>
              <TableHead>Cleaned by</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Verified by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.items.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="whitespace-nowrap">
                  {formatTimestamp(record.cleanedAt)}
                </TableCell>
                <TableCell>{record.cleanedByName}</TableCell>
                <TableCell className="font-mono text-xs">{record.methodCode}</TableCell>
                {/* Notes are free text, so this column needs two overrides that
                    the other columns do not.

                    `whitespace-normal` undoes the `whitespace-nowrap` in
                    shadcn's TableCell -- a good default for dates and badges,
                    but it stopped a long note wrapping, so it ran as one line
                    over the Status column. And the width limit sits on a child
                    because `max-width` on a <td> is ignored by the automatic
                    table layout. Clamped to two lines to keep rows scannable,
                    with the whole note on hover. */}
                <TableCell className="align-top text-muted-foreground">
                  <div
                    className="line-clamp-2 max-w-72 whitespace-normal break-words"
                    title={record.notes ?? undefined}
                  >
                    {orDash(record.notes)}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={record.status === 'verified' ? 'secondary' : 'outline'}>
                    {record.status}
                  </Badge>
                </TableCell>
                <TableCell>{orDash(record.verifiedByName)}</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm({ mode: 'edit', record })}
                  >
                    Amend
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuditFor(auditFor === record.id ? null : record.id)}
                  >
                    {auditFor === record.id ? 'Hide history' : 'History'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {records.items.length === 0 && !records.loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No cleaning records for this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {records.hasMore && (
        <div>
          <Button variant="outline" onClick={records.loadMore} disabled={records.loading}>
            {records.loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {auditFor !== null && <AuditTrail recordId={auditFor} />}
    </section>
  );
}
