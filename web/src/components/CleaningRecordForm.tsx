import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError, api } from '@/api/client';
import type { CleaningMethod, CleaningRecord, CleaningStatus, User } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { isoToLocalInput, localInputToIso } from '@/format';
import {
  buildRecordPatch,
  isSubstantive,
  type RecordFormShape,
  type RecordPatch,
} from '@/records/patch';

interface Props {
  equipmentId: string;
  users: User[];
  methods: CleaningMethod[];
  /** Absent for a new record. */
  record?: CleaningRecord | undefined;
  onSaved: (record: CleaningRecord) => void;
  onCancel: () => void;
}

const userLabel = (user: User): string => `${user.name} — ${user.role}`;
const methodLabel = (method: CleaningMethod): string =>
  `${method.code} — ${method.name} (v${method.version})`;

// Base UI renders the raw value in the trigger unless given a
// value -> label map; uuid-valued selects need one to show a name.
const STATUS_LABELS = { pending: 'pending', verified: 'verified' };

/**
 * Client-side schema.
 *
 * These rules deliberately mirror the API's zod schema rather than replacing
 * it: the server stays the authority, because a browser check is only a
 * courtesy to whoever is typing. Duplicating the rules here is what turns a
 * round trip into instant feedback -- and the two are small enough that a drift
 * shows up in the integration tests.
 */
const recordSchema = z.object({
  cleanedBy: z.string().uuid('Select who performed the cleaning'),
  cleanedAt: z
    .string()
    .min(1, 'Enter when the cleaning finished')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'That is not a valid date and time')
    // Contemporaneous recording: you cannot log a cleaning that has not
    // happened yet. A minute of slack absorbs clock skew.
    .refine(
      (value) => Date.parse(value) <= Date.now() + 60_000,
      'A cleaning cannot be recorded in the future',
    ),
  methodId: z.string().uuid('Select the procedure that was followed'),
  notes: z.string().max(1000, 'Keep notes under 1000 characters'),
  status: z.enum(['pending', 'verified']),
  reason: z.string().max(500, 'Keep the reason under 500 characters'),
});

type RecordFormValues = z.infer<typeof recordSchema>;

export function CleaningRecordForm({
  equipmentId,
  users,
  methods,
  record,
  onSaved,
  onCancel,
}: Props): JSX.Element {
  const isEdit = record !== undefined;

  const form = useForm<RecordFormValues>({
    resolver: zodResolver(recordSchema),
    defaultValues: {
      cleanedBy: record?.cleanedBy ?? users[0]?.id ?? '',
      cleanedAt: isoToLocalInput(record?.cleanedAt ?? new Date().toISOString()),
      methodId: record?.methodId ?? methods[0]?.id ?? '',
      notes: record?.notes ?? '',
      status: record?.status ?? 'pending',
      reason: '',
    },
  });

  const values = form.watch();

  const userItems = Object.fromEntries(users.map((user) => [user.id, userLabel(user)]));
  const methodItems = Object.fromEntries(
    methods.map((method) => [method.id, methodLabel(method)]),
  );

  // Delegates to a pure module so the rule can be tested without
  // rendering: see records/patch.ts and its tests.
  function buildPatch(input: RecordFormValues): RecordPatch {
    if (record === undefined) return {};
    return buildRecordPatch(record, input satisfies RecordFormShape);
  }

  const pendingPatch = buildPatch(values);

  const willWithdrawVerification =
    isEdit &&
    record.status === 'verified' &&
    values.status !== 'pending' &&
    isSubstantive(pendingPatch);

  const reasonRequired = isEdit && record.status === 'verified' && values.status === 'pending';

  async function onSubmit(input: RecordFormValues): Promise<void> {
    // The server enforces this too; asking here saves a round trip that can
    // only fail.
    if (reasonRequired && input.reason.trim() === '') {
      form.setError('reason', {
        message: 'A reason is required to withdraw a verification',
      });
      return;
    }

    try {
      if (record === undefined) {
        const created = await api.createRecord(equipmentId, {
          cleanedBy: input.cleanedBy,
          cleanedAt: localInputToIso(input.cleanedAt),
          methodId: input.methodId,
          notes: input.notes.trim() === '' ? null : input.notes.trim(),
        });
        onSaved(created);
        return;
      }

      const patch = buildPatch(input);
      if (Object.keys(patch).length === 0) {
        onCancel();
        return;
      }

      const updated = await api.updateRecord(record.id, {
        ...patch,
        ...(input.reason.trim() === '' ? {} : { reason: input.reason.trim() }),
      });
      onSaved(updated);
    } catch (caught) {
      applyServerError(caught);
    }
  }

  /** Maps the API's error codes onto the field they belong to. */
  function applyServerError(caught: unknown): void {
    if (!(caught instanceof ApiError)) {
      form.setError('root', { message: 'Save failed. Please try again.' });
      return;
    }

    if (caught.code === 'VALIDATION_FAILED' && caught.details !== undefined) {
      for (const [field, messages] of Object.entries(caught.details)) {
        const message = messages?.[0];
        if (message !== undefined && field in recordSchema.shape) {
          form.setError(field as keyof RecordFormValues, { message });
        }
      }
      return;
    }

    if (caught.code === 'REASON_REQUIRED') {
      form.setError('reason', { message: caught.message });
      return;
    }

    if (caught.code === 'SELF_VERIFICATION_FORBIDDEN') {
      form.setError('status', {
        message:
          'A cleaning cannot be verified by the person who performed it. Switch to another user to verify.',
      });
      return;
    }

    form.setError('root', { message: caught.message });
  }

  const rootError = form.formState.errors.root?.message;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">
          {isEdit ? 'Amend cleaning record' : 'Log a cleaning'}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-5 md:max-w-2xl"
            noValidate
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="cleanedBy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cleaned by</FormLabel>
                    <Select items={userItems} value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a person" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {userLabel(user)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cleanedAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cleaned at</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        max={isoToLocalInput(new Date().toISOString())}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="methodId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <Select items={methodItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a procedure" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {methods.map((method) => (
                        <SelectItem key={method.id} value={method.id}>
                          {methodLabel(method)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Only approved, current procedures are listed.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Visual inspection passed, no visible residue."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isEdit && (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      items={STATUS_LABELS}
                      value={field.value}
                      onValueChange={(value) => field.onChange(value as CleaningStatus)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="verified">verified</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {willWithdrawVerification && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                This record is verified. Amending what was cleaned, when, or by whom withdraws
                the sign-off and returns the record to <strong>pending</strong>.
              </p>
            )}

            {(reasonRequired || form.formState.errors.reason !== undefined) && (
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for change</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Swab result came back out of specification."
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Withdrawing a verification is recorded in the audit trail with this reason.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {rootError !== undefined && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {rootError}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? 'Saving…'
                  : isEdit
                    ? 'Save amendment'
                    : 'Log cleaning'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
