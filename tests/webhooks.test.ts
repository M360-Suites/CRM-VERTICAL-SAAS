import express from 'express';
import request from 'supertest';

const socialAccountModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
const notificationModel = { create: jest.fn() };
const emitNotification = jest.fn();

jest.mock('../src/config', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/SocialAccount', () => ({ SocialAccount: socialAccountModel }));
jest.mock('../src/models/Notification', () => ({ Notification: notificationModel }));
jest.mock('../src/services/socketService', () => ({ emitNotification }));

import webhookRoutes from '../src/routes/webhookRoutes';

const app = express();
app.use(express.json());
app.use('/webhooks', webhookRoutes);

describe('Unipile webhook API', () => {
  let consoleLog: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLog = jest.spyOn(console, 'log').mockImplementation();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('acknowledges unrelated events without creating data', async () => {
    const response = await request(app).post('/webhooks/unipile').send({ event: 'account_updated' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: true });
    expect(notificationModel.create).not.toHaveBeenCalled();
  });

  it('records a successfully created social account', async () => {
    socialAccountModel.findOneAndUpdate.mockResolvedValue({ _id: 'account-record' });

    const response = await request(app).post('/webhooks/unipile').send({
      status: 'CREATION_SUCCESS', account_id: 'unipile-account', name: 'user-1', account_type: 'WHATSAPP'
    });

    expect(response.status).toBe(200);
    expect(socialAccountModel.findOneAndUpdate).toHaveBeenCalledWith(
      { accountId: 'unipile-account' },
      expect.objectContaining({ userId: 'user-1', provider: 'whatsapp', status: 'connected' }),
      { upsert: true, new: true }
    );
  });

  it('creates and emits a notification for a known incoming message', async () => {
    socialAccountModel.findOne.mockResolvedValue({ userId: 'user-1', provider: 'whatsapp' });
    notificationModel.create.mockResolvedValue({ _id: 'notification-1', title: 'Ada: Hello there', created_at: new Date('2026-01-01') });

    const response = await request(app).post('/webhooks/unipile').send({
      event: 'message_received', account_id: 'unipile-account', sender: { name: 'Ada' }, content: 'Hello there', conversation_id: 'conversation-1'
    });

    expect(response.status).toBe(200);
    expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', provider: 'whatsapp', type: 'new_message', title: 'Ada: Hello there', metadata: expect.objectContaining({ accountId: 'unipile-account' })
    }));
    expect(emitNotification).toHaveBeenCalledWith('user-1', expect.objectContaining({ provider: 'whatsapp', title: 'Ada: Hello there' }));
  });
});
