/** Shared display helpers. Kept in one place so the audit trail and the tables
 * render the same value the same way. */

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : dateTime.format(parsed);
}

/**
 * An `<input type="datetime-local">` speaks local wall-clock time with no zone,
 * so the two conversions below are where the UI and the API agree on what a
 * timestamp means. Getting this wrong would silently shift every cleaning time
 * by the browser's offset.
 */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

/** The field names in the audit trail, as a person would read them. */
const FIELD_LABELS: Record<string, string> = {
  cleanedBy: 'Cleaned by',
  cleanedAt: 'Cleaned at',
  method: 'Method',
  notes: 'Notes',
  status: 'Status',
};

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

/** A cleared value must be visibly absent, not an empty gap in the table. */
export const orDash = (value: string | null): string => (value === null ? '—' : value);

/** Audit fields holding a timestamp, so only those get reformatted for display. */
const TIMESTAMP_FIELDS = new Set(['cleanedAt']);

/**
 * How an audited value is shown.
 *
 * The trail stores timestamps in ISO form, which is the right thing to store
 * but reads badly next to the formatted dates everywhere else in the UI. Only
 * fields known to hold a timestamp are reformatted -- sniffing every value for
 * something ISO-shaped would eventually mangle a note. Callers keep the exact
 * stored string as a tooltip, so nothing is hidden.
 */
export function auditValue(field: string, value: string | null): string {
  if (value === null) return '—';
  return TIMESTAMP_FIELDS.has(field) ? formatTimestamp(value) : value;
}

/**
 * The exact stored string, but only where it differs from what is displayed.
 * A tooltip that repeats the text underneath it is just noise.
 */
export function auditTitle(field: string, value: string | null): string | undefined {
  if (value === null) return undefined;
  return auditValue(field, value) === value ? undefined : value;
}
