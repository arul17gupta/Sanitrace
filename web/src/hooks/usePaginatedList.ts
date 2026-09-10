import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import type { Page } from '@/api/types';

/**
 * One "load more" list: the rows so far, whether there are more, and the
 * loading and error flags that go with them.
 *
 * Written once because all three lists in this app -- equipment, cleaning
 * records, and a record's audit history -- need exactly the same five pieces of
 * state and the same fetch-and-append logic. Each screen used to declare
 * `cursor`, `hasMore`, `loading`, `error` and a rows array of its own, plus a
 * near-identical callback and effect. That is three chances to fix a bug in one
 * place and leave it in the other two.
 *
 * The cursor is deliberately *not* exposed. A caller only ever wants "give me
 * the next page", never the token itself, and keeping it in here means no
 * component can page with a stale one.
 */

export interface PaginatedList<T> {
  /** Every row loaded so far, in order. */
  items: T[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  /** Fetches the next page and appends it. */
  loadMore: () => void;
  /** Throws the list away and re-reads from the first page. */
  reload: () => void;
}

/**
 * @param loadPage Fetches one page, given the cursor to start after (`null`
 *   for the first page). Wrap it in `useCallback` keyed on whatever the query
 *   depends on -- a filter, an id -- and the list resets and re-reads whenever
 *   that changes.
 * @param fallbackMessage Shown when the failure is not an `ApiError`, which in
 *   practice means the network or the server is unreachable.
 */
export function usePaginatedList<T>(
  loadPage: (cursor: string | null) => Promise<Page<T>>,
  fallbackMessage = 'Could not load this list',
): PaginatedList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Identifies the newest request so that a slower earlier one cannot apply its
   * result on top of it.
   *
   * This is a real hazard rather than a theoretical one: change a filter twice
   * in quick succession and the first response can arrive last, leaving the
   * screen showing rows that do not match the selected filter.
   */
  const latestRequest = useRef(0);

  const run = useCallback(
    async (from: string | null, append: boolean): Promise<void> => {
      const requestId = latestRequest.current + 1;
      latestRequest.current = requestId;

      setLoading(true);
      setError(null);

      try {
        const page = await loadPage(from);
        if (requestId !== latestRequest.current) return; // superseded
        setItems((existing) => (append ? [...existing, ...page.data] : page.data));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (caught) {
        if (requestId !== latestRequest.current) return;
        setError(caught instanceof ApiError ? caught.message : fallbackMessage);
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    },
    [loadPage, fallbackMessage],
  );

  // A new `loadPage` means the query itself changed, so the rows already on
  // screen belong to a different question. Start again from the first page.
  useEffect(() => {
    void run(null, false);
  }, [run]);

  const loadMore = useCallback(() => {
    void run(cursor, true);
  }, [run, cursor]);

  const reload = useCallback(() => {
    void run(null, false);
  }, [run]);

  return { items, loading, error, hasMore, loadMore, reload };
}
