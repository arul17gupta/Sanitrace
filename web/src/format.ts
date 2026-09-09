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
