import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/api/client';
import type { Equipment, EquipmentStatus } from '@/api/types';
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

interface Props {
  onSelect: (equipment: Equipment) => void;
}

const ALL = 'all';

// Base UI renders the raw value in the trigger unless given a
// value -> label map, so every Select here passes `items`.
const STATUS_LABELS = { [ALL]: 'All', active: 'Active', retired: 'Retired' };

export function EquipmentList({ onSelect }: Props): JSX.Element {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [status, setStatus] = useState<EquipmentStatus | typeof ALL>(ALL);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string | null, filter: EquipmentStatus | typeof ALL) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listEquipment({
        ...(filter === ALL ? {} : { status: filter }),
        cursor: from,
        limit: 20,
      });
      setEquipment((existing) => (from === null ? page.data : [...existing, ...page.data]));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load equipment');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null, status);
  }, [load, status]);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Equipment</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="equipment-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select
            items={STATUS_LABELS}
            value={status}
            onValueChange={(value) => setStatus(value as EquipmentStatus | typeof ALL)}
          >
            <SelectTrigger id="equipment-status" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{STATUS_LABELS[ALL]}</SelectItem>
              <SelectItem value="active">{STATUS_LABELS.active}</SelectItem>
              <SelectItem value="retired">{STATUS_LABELS.retired}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset tag</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Cleaning log</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {equipment.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>
                  <Badge variant={item.status === 'active' ? 'secondary' : 'outline'}>
                    {item.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => onSelect(item)}>
                    Cleaning log
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {equipment.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No equipment matches this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <div>
          <Button variant="outline" onClick={() => void load(cursor, status)} disabled={loading}>
            {loading ? 'Loading…' : 'Load more equipment'}
          </Button>
        </div>
      )}
    </section>
  );
}
