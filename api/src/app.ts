import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { errorHandler } from './errors.js';
import { attachCurrentUser } from './middleware/currentUser.js';
import { equipmentRouter } from './routes/equipment.js';
import { cleaningRecordsRouter, equipmentRecordsRouter } from './routes/cleaningRecords.js';
import { methodsRouter, usersRouter } from './routes/reference.js';

/**
 * The app is built separately from the server so the integration tests can
 * mount it with supertest without binding a port.
 */
export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: config.webOrigin, allowedHeaders: ['Content-Type', 'X-User-Id'] }));
  app.use(express.json({ limit: '64kb' }));
  app.use(attachCurrentUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // The nested records router is mounted on the same prefix as equipment, so
  // /api/equipment/:id/cleaning-records reads as the sub-resource it is.
  app.use('/api/equipment', equipmentRecordsRouter);
  app.use('/api/equipment', equipmentRouter);
  app.use('/api/cleaning-records', cleaningRecordsRouter);
  app.use('/api/cleaning-methods', methodsRouter);
  app.use('/api/users', usersRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route' } });
  });

  app.use(errorHandler);

  return app;
}
