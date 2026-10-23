import mongoose from 'mongoose';

const contactModel = { updateMany: jest.fn(), updateOne: jest.fn() };
const recipientModel = { findOneAndUpdate: jest.fn() };
const broadcastModel = { updateOne: jest.fn() };
const runModel = { updateOne: jest.fn() };

jest.mock('../src/models/Contact', () => ({ Contact: contactModel }));
jest.mock('../src/models/BroadcastRecipient', () => ({ BroadcastRecipient: recipientModel }));
jest.mock('../src/models/Broadcast', () => ({ Broadcast: broadcastModel }));
jest.mock('../src/models/TriggerRun', () => ({ TriggerRun: runModel }));
jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test', SENDER_WEBHOOK_SECRET: 'hook-secret' } }));
jest.mock('../src/config/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { applySenderBounce, handleSenderWebhook } from '../src/controllers/emailEventsController';

const orgId = new mongoose.Types.ObjectId();
const broadcastId = new mongoose.Types.ObjectId();

const mockRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Sender.net bounces', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks the broadcast recipient bounced and opts the address out everywhere', async () => {
    recipientModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ organization_id: orgId, broadcast_id: broadcastId })
    });

    await applySenderBounce({ data: { email: 'Dead@Example.com', emailId: 'e-1' } });

    expect(recipientModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ message_id: 'e-1' });
    expect(broadcastModel.updateOne).toHaveBeenCalledWith({ _id: broadcastId }, { $inc: { 'stats.bounced': 1 } });
    const [filter, update] = contactModel.updateMany.mock.calls[0];
    expect(filter.organization_id).toBeUndefined();
    expect(filter.email.$options).toBe('i');
    expect(update.$set).toMatchObject({ email_opt_out: true, email_opt_out_reason: 'bounced' });
  });

  it('notes the bounce on a trigger run when no broadcast matches', async () => {
    recipientModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await applySenderBounce({ email: 'gone@example.com', email_id: 'e-2' });

    expect(runModel.updateOne).toHaveBeenCalledWith({ message_id: 'e-2' }, { $set: { error: 'Hard bounce' } });
    expect(contactModel.updateMany).toHaveBeenCalled();
  });

  it('ignores soft bounces', async () => {
    await applySenderBounce({ email: 'full@example.com', bounce_type: 'soft' });
    expect(contactModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects requests without the webhook secret', async () => {
    const res = mockRes();
    await handleSenderWebhook({ query: { secret: 'wrong' }, body: { email: 'a@b.c' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(contactModel.updateMany).not.toHaveBeenCalled();
  });

  it('accepts requests with the webhook secret', async () => {
    const res = mockRes();
    await handleSenderWebhook({ query: { secret: 'hook-secret' }, body: { email: 'a@b.c' } } as never, res as never);
    expect(res.json).toHaveBeenCalledWith({ status: true });
    expect(contactModel.updateMany).toHaveBeenCalled();
  });
});
