import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { evaluateTransition, type TransitionInput } from './status.js';

const PRIYA = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';

const base: TransitionInput = {
  currentStatus: 'pending',
  currentCleanedBy: PRIYA,
  substantiveChange: false,
  actorId: RAVI,
};

describe('four-eyes rule', () => {
  it('lets a second person verify', () => {
    expect(evaluateTransition({ ...base, requestedStatus: 'verified' })).toEqual({
      nextStatus: 'verified',
      forcedRevert: false,
    });
  });

  it('refuses verification by the person who performed the cleaning', () => {
    // Segregation of duties: the operator who cleaned the equipment cannot also
    // release it. Without this, one person could sign off their own work.
    expect(() =>
      evaluateTransition({ ...base, actorId: PRIYA, requestedStatus: 'verified' }),
    ).toThrowError(AppError);

    try {
      evaluateTransition({ ...base, actorId: PRIYA, requestedStatus: 'verified' });
      expect.unreachable('expected a self-verification failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('SELF_VERIFICATION_FORBIDDEN');
      expect((error as AppError).status).toBe(409);
    }
  });

  it('still refuses when the record author edits their own record into verified', () => {
    expect(() =>
      evaluateTransition({
        ...base,
        actorId: PRIYA,
        requestedStatus: 'verified',
        substantiveChange: true,
      }),
    ).toThrowError(/cannot be verified by the person/i);
  });
});

describe('withdrawing a verification', () => {
  const verified: TransitionInput = { ...base, currentStatus: 'verified' };

  it('requires a reason', () => {
    try {
      evaluateTransition({ ...verified, requestedStatus: 'pending' });
      expect.unreachable('expected a missing-reason failure');
    } catch (error) {
      expect((error as AppError).code).toBe('REASON_REQUIRED');
      expect((error as AppError).status).toBe(400);
    }
  });

  it('rejects a blank reason', () => {
    expect(() =>
      evaluateTransition({ ...verified, requestedStatus: 'pending', reason: '   ' }),
    ).toThrowError(/requires a reason/i);
  });

  it('allows it with a reason', () => {
    expect(
      evaluateTransition({
        ...verified,
        requestedStatus: 'pending',
        reason: 'Swab result came back out of specification.',
      }),
    ).toEqual({ nextStatus: 'pending', forcedRevert: false });
  });
});

describe('re-verification after a substantive amendment', () => {
  const verified: TransitionInput = { ...base, currentStatus: 'verified' };

  it('withdraws the sign-off when what was cleaned, when, or by whom changes', () => {
    // The earlier verification approved data that no longer exists, so keeping
    // the record verified would claim an approval it never received.
    expect(evaluateTransition({ ...verified, substantiveChange: true })).toEqual({
      nextStatus: 'pending',
      forcedRevert: true,
    });
  });

  it('leaves the sign-off intact when only the notes change', () => {
    expect(evaluateTransition({ ...verified, substantiveChange: false })).toEqual({
      nextStatus: 'verified',
      forcedRevert: false,
    });
  });
});

describe('no-op transitions', () => {
  it('keeps pending when nothing is requested', () => {
    expect(evaluateTransition(base)).toEqual({ nextStatus: 'pending', forcedRevert: false });
  });

  it('keeps pending when pending is requested again', () => {
    expect(evaluateTransition({ ...base, requestedStatus: 'pending' })).toEqual({
      nextStatus: 'pending',
      forcedRevert: false,
    });
  });

  it('keeps verified when verified is requested again and nothing substantive changed', () => {
    expect(
      evaluateTransition({
        ...base,
        currentStatus: 'verified',
        requestedStatus: 'verified',
      }),
    ).toEqual({ nextStatus: 'verified', forcedRevert: false });
  });
});
