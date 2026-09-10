import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@/api/types';
import { usePaginatedList } from './usePaginatedList';

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {},
}));

const page = <T,>(data: T[], nextCursor: string | null): Page<T> => ({
  data,
  nextCursor,
  hasMore: nextCursor !== null,
});

/** A loader backed by fixed pages, keyed by the cursor used to reach them. */
function pagedLoader(pages: Record<string, Page<string>>) {
  return vi.fn((cursor: string | null) => Promise.resolve(pages[cursor ?? 'first'] as Page<string>));
}

describe('usePaginatedList', () => {
  it('loads the first page on mount', async () => {
    const loadPage = pagedLoader({ first: page(['a', 'b'], 'c1') });

    const { result } = renderHook(() => usePaginatedList(loadPage));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(true);
    expect(loadPage).toHaveBeenCalledWith(null);
  });

  it('appends the next page rather than replacing', async () => {
    const loadPage = pagedLoader({
      first: page(['a', 'b'], 'c1'),
      c1: page(['c', 'd'], null),
    });

    const { result } = renderHook(() => usePaginatedList(loadPage));
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.items).toEqual(['a', 'b', 'c', 'd']);
    // The cursor is never handed out; the hook remembered it.
    expect(loadPage).toHaveBeenLastCalledWith('c1');
  });

  it('reload throws the list away and re-reads the first page', async () => {
    const loadPage = pagedLoader({
      first: page(['a', 'b'], 'c1'),
      c1: page(['c', 'd'], null),
    });

    const { result } = renderHook(() => usePaginatedList(loadPage));
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(4));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));
  });

  it('starts again when the query changes', async () => {
    // A new loadPage means the query changed, so rows already on screen answer
    // a different question.
    const active = pagedLoader({ first: page(['active-1'], null) });
    const retired = pagedLoader({ first: page(['retired-1'], null) });

    const { result, rerender } = renderHook(({ loader }) => usePaginatedList(loader), {
      initialProps: { loader: active },
    });
    await waitFor(() => expect(result.current.items).toEqual(['active-1']));

    rerender({ loader: retired });

    await waitFor(() => expect(result.current.items).toEqual(['retired-1']));
  });

  it('ignores a slow earlier response that resolves after a newer one', async () => {
    // The hazard: flip a filter twice and the first request can land last,
    // leaving rows on screen that do not match the selected filter.
    let releaseSlow: (value: Page<string>) => void = () => {};
    const slow = vi.fn(
      () => new Promise<Page<string>>((resolve) => { releaseSlow = resolve; }),
    );
    const fast = pagedLoader({ first: page(['from-the-newer-query'], null) });

    const { result, rerender } = renderHook(({ loader }) => usePaginatedList(loader), {
      initialProps: { loader: slow as (cursor: string | null) => Promise<Page<string>> },
    });

    rerender({ loader: fast as (cursor: string | null) => Promise<Page<string>> });
    await waitFor(() => expect(result.current.items).toEqual(['from-the-newer-query']));

    // Now let the first, superseded request finish.
    await act(async () => {
      releaseSlow(page(['from-the-stale-query'], null));
      await Promise.resolve();
    });

    expect(result.current.items).toEqual(['from-the-newer-query']);
  });

  it('reports a failure and stops loading', async () => {
    const loadPage = vi.fn(() => Promise.reject(new Error('network down')));

    const { result } = renderHook(() =>
      usePaginatedList(
        loadPage as unknown as (cursor: string | null) => Promise<Page<string>>,
        'Could not load equipment',
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load equipment');
    expect(result.current.items).toEqual([]);
  });

  it('clears a previous error on a successful reload', async () => {
    const loadPage = vi
      .fn<(cursor: string | null) => Promise<Page<string>>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(page(['a'], null));

    const { result } = renderHook(() => usePaginatedList(loadPage));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.items).toEqual(['a']);
  });

  it('reports an empty list without an error', async () => {
    const loadPage = pagedLoader({ first: page([], null) });

    const { result } = renderHook(() => usePaginatedList(loadPage));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
