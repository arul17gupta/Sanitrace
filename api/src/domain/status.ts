import { AppError } from '../errors.js';
import type { CleaningStatus } from '../types.js';

/**
 * The status rules for a cleaning record.
 *
 * Like the audit diff, this is a pure function with no database access, so
 * every rule below is covered by a unit test rather than an end-to-end one.
 */

export interface TransitionInput {
  currentStatus: CleaningStatus;
  /** The user id in the record's `cleanedBy`, for the four-eyes check. */
  currentCleanedBy: string;
  /** Absent means the request did not ask to change the status. */
  requestedStatus?: CleaningStatus | undefined;
  /**
   * Whether this edit changes what was cleaned, when, or by whom.
   * See `SUBSTANTIVE_FIELDS` in audit/diff.ts.
   */
  substantiveChange: boolean;
  /** The user performing this edit. */
  actorId: string;
  reason?: string | null | undefined;
}

export interface TransitionResult {
  nextStatus: CleaningStatus;
  /**
   * True when the system reverted the record to `pending` rather than the
   * caller asking for it. The caller records this as an audited field change
   * with a system-supplied reason.
   */
  forcedRevert: boolean;
}

export const FORCED_REVERT_REASON =
  'Verification withdrawn automatically: a substantive field was amended after sign-off.';

export function evaluateTransition(input: TransitionInput): TransitionResult {
  const { currentStatus, currentCleanedBy, actorId, substantiveChange, reason } = input;
  const requested = input.requestedStatus ?? currentStatus;

  // A substantive amendment to a signed-off record withdraws the sign-off. The
  // earlier verification approved data that no longer exists, so carrying it
  // forward would make the record claim an approval it never received.
  if (currentStatus === 'verified' && substantiveChange && requested === 'verified') {
    return { nextStatus: 'pending', forcedRevert: true };
  }

  // Four-eyes: whoever performed the cleaning cannot be the one who approves
  // it. This is the core GMP segregation-of-duties rule, and it is the reason
  // `cleanedBy` and the acting user are tracked separately at all.
  if (currentStatus === 'pending' && requested === 'verified') {
    if (actorId === currentCleanedBy) {
      throw new AppError(
        409,
        'SELF_VERIFICATION_FORBIDDEN',
        'A cleaning record cannot be verified by the person who performed the cleaning.',
      );
    }
    return { nextStatus: 'verified', forcedRevert: false };
  }

  // Withdrawing a verification by hand is allowed, but it is exactly the kind
  // of change an inspector will ask about, so it must carry a reason.
  if (currentStatus === 'verified' && requested === 'pending') {
    if (reason === null || reason === undefined || reason.trim() === '') {
      throw new AppError(
        400,
        'REASON_REQUIRED',
        'Withdrawing a verification requires a reason.',
      );
    }
    return { nextStatus: 'pending', forcedRevert: false };
  }

  // Same status in, same status out -- including the no-op case, which must not
  // manufacture an audit entry.
  return { nextStatus: requested, forcedRevert: false };
}
