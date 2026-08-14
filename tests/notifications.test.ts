import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const userId = '507f1f77bcf86cd799439011';
const notificationModel = {
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn()
};

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) {
      res.status(401).json({ status: false, message: 'No token provided' });
      return;
    }
    (req as Request & { user?: unknown }).user = { id: userId };
    next();
  }
}));
jest.mock('../src/models/Notification', () => ({ Notification: notificationModel }));

import notificationRoutes from '../src/routes/notificationRoutes';

const app = express();
app.use(express.json());
app.use('/notifications', notificationRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

describe('notifications API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires authentication', async () => {
    expect((await request(app).get('/notifications')).status).toBe(401);
  });

  it('lists notifications with pagination', async () => {
    notificationModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'notification-1', read: false }]) }) })
      })
    });
    notificationModel.countDocuments.mockResolvedValue(1);

    const response = await authenticated(request(app).get('/notifications?page=2&limit=10'));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, data: { total: 1, page: 2, limit: 10, total_pages: 1 } });
    expect(notificationModel.find).toHaveBeenCalledWith({ userId });
  });

  it('marks one of the current user’s notifications as read', async () => {
    notificationModel.findOneAndUpdate.mockResolvedValue({ _id: 'notification-1', userId, read: true });

    const response = await authenticated(request(app).patch('/notifications/notification-1/read'));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Notification marked as read', data: { read: true } });
    expect(notificationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'notification-1', userId },
      { read: true },
      { new: true }
    );
  });

  it('returns 404 when the notification does not belong to the current user', async () => {
    notificationModel.findOneAndUpdate.mockResolvedValue(null);

    const response = await authenticated(request(app).patch('/notifications/other-user-notification/read'));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: false, message: 'Notification not found' });
  });

  it('marks all unread notifications for the current user as read', async () => {
    notificationModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const response = await authenticated(request(app).patch('/notifications/read-all'));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'All notifications marked as read' });
    expect(notificationModel.updateMany).toHaveBeenCalledWith({ userId, read: false }, { $set: { read: true } });
  });
});
