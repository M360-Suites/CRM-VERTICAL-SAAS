import mongoose from 'mongoose';

const contactModel = { updateMany: jest.fn(), updateOne: jest.fn() };
const recipientModel = { findOneAndUpdate: jest.fn() };
const broadcastModel = { updateOne: jest.fn() };
const runModel = { findOneAndUpdate: jest.fn() };

jest.mock('../src/models/Contact', () => ({ Contact: contactModel }));
jest.mock('../src/models/BroadcastRecipient', () => ({ BroadcastRecipient: recipientModel }));
jest.mock('../src/models/Broadcast', () => ({ Broadcast: broadcastModel }));
jest.mock('../src/models/TriggerRun', () => ({ TriggerRun: runModel }));
jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test' } }));
jest.mock('../src/config/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { applySesEvent, verifySnsMessage } from '../src/controllers/emailEventsController';

const orgId = new mongoose.Types.ObjectId();
const broadcastId = new mongoose.Types.ObjectId();

describe('SES events', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks a hard bounce on the broadcast and opts the address out everywhere', async () => {
    recipientModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ organization_id: orgId, broadcast_id: broadcastId })
    });

    await applySesEvent({
      eventType: 'Bounce',
      mail: { messageId: 'm-1' },
      bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'Dead@Example.com' }] }
    });

    expect(broadcastModel.updateOne).toHaveBeenCalledWith({ _id: broadcastId }, { $inc: { 'stats.bounced': 1 } });
    const [filter, update] = contactModel.updateMany.mock.calls[0];
    expect(filter.organization_id).toBeUndefined();
    expect(filter.email.$options).toBe('i');
    expect(update.$set).toMatchObject({ email_opt_out: true, email_opt_out_reason: 'bounced' });
  });

  it('scopes complaints to the sending organization', async () => {
    recipientModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    runModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ organization_id: orgId }) });

    await applySesEvent({
      notificationType: 'Complaint',
      mail: { messageId: 'm-2' },
      complaint: { complainedRecipients: [{ emailAddress: 'angry@example.com' }] }
    });

    expect(contactModel.updateMany.mock.calls[0][0].organization_id).toBe(orgId);
    expect(contactModel.updateMany.mock.calls[0][1].$set.email_opt_out_reason).toBe('complained');
  });

  it('ignores soft bounces', async () => {
    await applySesEvent({ eventType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'x@y.z' }] } });
    expect(contactModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects SNS messages whose certificate is not hosted by AWS', async () => {
    await expect(
      verifySnsMessage({
        Type: 'Notification',
        MessageId: '1',
        TopicArn: 'arn',
        Message: '{}',
        Timestamp: 'now',
        SignatureVersion: '1',
        Signature: 'abc',
        SigningCertURL: 'https://evil.example.com/cert.pem'
      })
    ).resolves.toBe(false);
  });
});
