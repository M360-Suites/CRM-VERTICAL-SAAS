import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

/**
 * Shared mocks for route-contract tests. Controllers are replaced so each suite
 * verifies the HTTP contract without a MongoDB connection or third-party API.
 */
export const mockAuthentication = () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) {
      res.status(401).json({ status: false, message: 'No token provided' });
      return;
    }
    (req as Request & { user?: unknown }).user = { role: req.header('x-test-role') || 'admin' };
    next();
  },
  authorize: (...roles: string[]) => (req: Request & { user?: { role: string } }, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ status: false, message: "You don't have permission to perform this action" });
      return;
    }
    next();
  }
});

export const mockControllerStub = (name: string): jest.Mock => jest.fn((_req: Request, res: Response) =>
  res.status(name.startsWith('create') ? 201 : 200).json({ status: true, handler: name })
);

export const createApp = (path: string, router: express.Router): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
};

export const authenticated = (request: import('supertest').Test) => request.set('Authorization', 'Bearer qa-token');
