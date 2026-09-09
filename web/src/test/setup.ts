import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library only registers its own automatic cleanup when Vitest globals
 * are enabled. This project imports `describe`/`it` explicitly, so cleanup has
 * to be wired up here -- without it the DOM accumulates across tests and
 * queries start matching elements from an earlier render.
 */
afterEach(cleanup);
