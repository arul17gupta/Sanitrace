import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditChangeSet, Page } from '../api/types';
import { AuditTrail } from './AuditTrail';

// vi.mock factories are hoisted above the module body, so the spy has to be
// created in a hoisted block or it is still in its temporal dead zone when the
// mocked module is first imported.
const { listAudit } = vi.hoisted(() => ({ listAudit: vi.fn() }));

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  api: { listAudit },
}));

const changeSet = (overrides: Partial<AuditChangeSet>): AuditChangeSet => ({
  id: 'cs-1',
  recordId: 'rec-1',
  action: 'update',
  reason: null,
  changedBy: 'user-1',
  changedByName: 'Ravi Kumar',
  changedAt: '2026-09-09T14:22:00.000Z',
  entries: [],
  ...overrides,
});

const page = (data: AuditChangeSet[]): Page<AuditChangeSet> => ({
  data,
  nextCursor: null,
  hasMore: false,
});

beforeEach(() => {
  listAudit.mockReset();
});

describe('AuditTrail', () => {
  it('renders each field change as old to new, grouped under who changed it', async () => {
    listAudit.mockResolvedValue(
      page([
        changeSet({
          reason: 'Operator selected the wrong SOP.',
          entries: [
            { id: 1, field: 'method', oldValue: 'SOP-CLN-014', newValue: 'SOP-CLN-021' },
            { id: 2, field: 'status', oldValue: 'verified', newValue: 'pending' },
          ],
        }),
      ]),
    );

    render(<AuditTrail recordId="rec-1" />);

    const group = await screen.findByRole('listitem');

    expect(within(group).getByText('Ravi Kumar')).toBeInTheDocument();
    expect(within(group).getByText('Operator selected the wrong SOP.')).toBeInTheDocument();

    // Field labels are humanised, and both sides of each change are shown.
    const methodRow = within(group).getByRole('row', { name: /Method/ });
    expect(within(methodRow).getByText('SOP-CLN-014')).toBeInTheDocument();
    expect(within(methodRow).getByText('SOP-CLN-021')).toBeInTheDocument();

    const statusRow = within(group).getByRole('row', { name: /Status/ });
    expect(within(statusRow).getByText('verified')).toBeInTheDocument();
    expect(within(statusRow).getByText('pending')).toBeInTheDocument();
  });

  it('shows a cleared value as an explicit dash rather than a blank cell', async () => {
    // A note that was erased must be visibly erased -- an empty cell reads as
    // "nothing recorded" instead of "someone removed this".
    listAudit.mockResolvedValue(
      page([
        changeSet({
          entries: [{ id: 1, field: 'notes', oldValue: 'Swab sent to QC.', newValue: null }],
        }),
      ]),
    );

    render(<AuditTrail recordId="rec-1" />);

    const notesRow = await screen.findByRole('row', { name: /Notes/ });
    expect(within(notesRow).getByText('Swab sent to QC.')).toBeInTheDocument();
    expect(within(notesRow).getByText('—')).toBeInTheDocument();
  });

  it('shows a create entry with no old value', async () => {
    listAudit.mockResolvedValue(
      page([
        changeSet({
          action: 'create',
          entries: [{ id: 1, field: 'method', oldValue: null, newValue: 'SOP-CLN-014' }],
        }),
      ]),
    );

    render(<AuditTrail recordId="rec-1" />);

    expect(await screen.findByText('create')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Method/ });
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('SOP-CLN-014')).toBeInTheDocument();
  });

  it('reports an empty history', async () => {
    listAudit.mockResolvedValue(page([]));

    render(<AuditTrail recordId="rec-1" />);

    expect(await screen.findByText('No history for this record.')).toBeInTheDocument();
  });
});
