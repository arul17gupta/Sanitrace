import { useCallback } from 'react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { auditTitle, auditValue, fieldLabel, formatTimestamp } from '@/format';
import { usePaginatedList } from '@/hooks/usePaginatedList';

interface Props {
  recordId: string;
}

/**
 * The audit history for one record.
 *
 * Grouped by change set rather than by timestamp: the API tells us which field
 * changes belong to the same edit, so the UI does not have to guess from the
 * clock. Each group is one thing a person did, with the reason they gave.
 *
 * The groups stay a real <ol>/<li> list -- it is a list of edits, and keeping
 * the semantics means the structure is navigable rather than a stack of divs.
 */
export function AuditTrail({ recordId }: Props): JSX.Element {
  const loadPage = useCallback(
    (cursor: string | null) => api.listAudit(recordId, { cursor, limit: 10 }),
    [recordId],
  );

  const history = usePaginatedList(loadPage, 'Could not load the audit trail');

  return (
    <section className="mt-8 grid gap-4" aria-label="Audit trail">
      <h3 className="font-heading text-base font-semibold tracking-tight">Audit trail</h3>

      {history.error !== null && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {history.error}
        </p>
      )}

      {history.items.length === 0 && !history.loading && history.error === null && (
        <p className="text-sm text-muted-foreground">No history for this record.</p>
      )}

      <ol className="grid gap-3">
        {history.items.map((changeSet) => (
          <li key={changeSet.id}>
            <Card className="gap-0 py-4">
              <CardHeader className="gap-1 px-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={changeSet.action === 'create' ? 'secondary' : 'outline'}>
                    {changeSet.action}
                  </Badge>
                  <span className="font-medium">{changeSet.changedByName}</span>
                  <time dateTime={changeSet.changedAt} className="text-muted-foreground">
                    {formatTimestamp(changeSet.changedAt)}
                  </time>
                </div>
                {changeSet.reason !== null && (
                  <p className="text-sm text-muted-foreground italic">{changeSet.reason}</p>
                )}
              </CardHeader>

              <CardContent className="overflow-x-auto px-4 pt-2">
                <Table className="text-sm">
                  <TableBody>
                    {changeSet.entries.map((entry) => (
                      <TableRow key={entry.id} className="border-0 hover:bg-transparent">
                        <TableHead className="h-auto w-36 py-1 align-top font-normal text-muted-foreground">
                          {fieldLabel(entry.field)}
                        </TableHead>
                        {/* `title` carries the exact stored string, so formatting a
                            timestamp for display never hides what was recorded.

                            The width limit sits on a block child rather than the
                            cell, because `max-width` on a <td> is ignored by the
                            automatic table layout. Wrapped rather than clamped --
                            an inspector has to be able to read the whole value. */}
                        <TableCell
                          className="py-1 align-top text-destructive line-through"
                          title={auditTitle(entry.field, entry.oldValue)}
                        >
                          <span className="block max-w-80 whitespace-normal break-words">
                            {auditValue(entry.field, entry.oldValue)}
                          </span>
                        </TableCell>
                        <TableCell aria-hidden="true" className="w-6 py-1 text-center align-top text-muted-foreground">
                          &rarr;
                        </TableCell>
                        <TableCell
                          className="py-1 align-top font-medium"
                          title={auditTitle(entry.field, entry.newValue)}
                        >
                          <span className="block max-w-80 whitespace-normal break-words">
                            {auditValue(entry.field, entry.newValue)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      {history.hasMore && (
        <div>
          <Button variant="outline" size="sm" onClick={history.loadMore} disabled={history.loading}>
            {history.loading ? 'Loading…' : 'Load older history'}
          </Button>
        </div>
      )}
    </section>
  );
}
