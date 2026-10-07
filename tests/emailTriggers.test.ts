import mongoose from 'mongoose';

const lean = <T>(value: T) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) });

const stageModel = { findOne: jest.fn() };
const triggerModel = { find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() };
const runModel = { create: jest.fn(), updateOne: jest.fn(), findOneAndUpdate: jest.fn() };
const dealModel = { findOne: jest.fn() };
const templateModel = { findOne: jest.fn() };
const organizationModel = { findById: jest.fn() };
const sendSesEmail = jest.fn();

jest.mock('../src/models/Pipeline', () => ({ PipelineStage: stageModel }));
jest.mock('../src/models/EmailTrigger', () => ({ EmailTrigger: triggerModel }));
jest.mock('../src/models/TriggerRun', () => ({ TriggerRun: runModel }));
jest.mock('../src/models/Deal', () => ({ Deal: dealModel }));
jest.mock('../src/models/EmailTemplate', () => ({ EmailTemplate: templateModel }));
jest.mock('../src/models/Organization', () => ({ Organization: organizationModel }));
jest.mock('../src/utils/sesMailer', () => ({ sendSesEmail: (...args: unknown[]) => sendSesEmail(...args) }));
jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test', BACKEND_URL: 'https://api.test' } }));
jest.mock('../src/config/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { processTriggerRun, queueDealTriggers } from '../src/services/triggerService';

const orgId = new mongoose.Types.ObjectId();
const dealId = new mongoose.Types.ObjectId();
const stageId = new mongoose.Types.ObjectId();
const otherStageId = new mongoose.Types.ObjectId();
const pipelineId = new mongoose.Types.ObjectId();
const templateId = new mongoose.Types.ObjectId();

describe('queueDealTriggers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queues a delayed run for a matching stage trigger and skips other stages', async () => {
    stageModel.findOne.mockReturnValue(lean({ _id: stageId, pipeline_id: pipelineId, is_won: false, is_lost: false }));
    const matching = { _id: new mongoose.Types.ObjectId(), event: 'deal.stage_entered', stage_id: stageId, delay_minutes: 60 };
    const otherStage = { _id: new mongoose.Types.ObjectId(), event: 'deal.stage_entered', stage_id: otherStageId, delay_minutes: 0 };
    triggerModel.find.mockReturnValue(lean([matching, otherStage]));
    dealModel.findOne.mockReturnValue(lean({ value: 100 }));

    const before = Date.now();
    await queueDealTriggers({ organizationId: orgId, dealId, stageId });

    expect(triggerModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true, event: { $in: ['deal.stage_entered'] } })
    );
    expect(runModel.create).toHaveBeenCalledTimes(1);
    const run = runModel.create.mock.calls[0][0];
    expect(String(run.trigger_id)).toBe(String(matching._id));
    expect(run.dedupe_key).toBe(`${matching._id}:${dealId}:deal.stage_entered:${stageId}`);
    expect(run.send_at.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
  });

  it('fires won and created events, respecting min_deal_value and pipeline', async () => {
    stageModel.findOne.mockReturnValue(lean({ _id: stageId, pipeline_id: pipelineId, is_won: true, is_lost: false }));
    const won = { _id: new mongoose.Types.ObjectId(), event: 'deal.won', min_deal_value: 50 };
    const tooSmall = { _id: new mongoose.Types.ObjectId(), event: 'deal.won', min_deal_value: 5000 };
    const otherPipeline = { _id: new mongoose.Types.ObjectId(), event: 'deal.created', pipeline_id: new mongoose.Types.ObjectId() };
    triggerModel.find.mockReturnValue(lean([won, tooSmall, otherPipeline]));
    dealModel.findOne.mockReturnValue(lean({ value: 100 }));

    await queueDealTriggers({ organizationId: orgId, dealId, stageId, isNew: true });

    expect(triggerModel.find.mock.calls[0][0].event.$in).toEqual(['deal.created', 'deal.stage_entered', 'deal.won']);
    expect(runModel.create).toHaveBeenCalledTimes(1);
    expect(String(runModel.create.mock.calls[0][0].trigger_id)).toBe(String(won._id));
  });

  it('ignores duplicate runs and never throws', async () => {
    stageModel.findOne.mockReturnValue(lean({ _id: stageId, pipeline_id: pipelineId, is_won: false, is_lost: false }));
    triggerModel.find.mockReturnValue(lean([{ _id: new mongoose.Types.ObjectId(), event: 'deal.stage_entered', stage_id: stageId }]));
    dealModel.findOne.mockReturnValue(lean({ value: 0 }));
    runModel.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));

    await expect(queueDealTriggers({ organizationId: orgId, dealId, stageId })).resolves.toBeUndefined();

    stageModel.findOne.mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(queueDealTriggers({ organizationId: orgId, dealId, stageId })).resolves.toBeUndefined();
  });
});

describe('processTriggerRun', () => {
  const run = {
    _id: new mongoose.Types.ObjectId(),
    organization_id: orgId,
    trigger_id: new mongoose.Types.ObjectId(),
    deal_id: dealId,
    stage_id: stageId,
    event: 'deal.stage_entered'
  } as any;

  const populatedDeal = (overrides: Record<string, unknown> = {}) => {
    const value = {
      _id: dealId,
      title: 'Website redesign',
      value: 500,
      stage_id: { _id: stageId, name: 'Proposal' },
      contact_id: { _id: new mongoose.Types.ObjectId(), first_name: 'Ada', last_name: 'L', email: 'ada@example.com' },
      owner_id: { display_name: 'Grace', email: 'grace@co.test' },
      ...overrides
    };
    const chain: any = { populate: jest.fn(() => chain), lean: jest.fn().mockResolvedValue(value) };
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    triggerModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: run.trigger_id, is_active: true, template_id: templateId, recipient: 'contact' })
    });
    templateModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ subject: 'Hi {{contact.first_name}}', html: '<p>{{stage.name}}</p>' })
    });
    organizationModel.findById.mockReturnValue(lean({ name: 'Acme' }));
    sendSesEmail.mockResolvedValue('ses-123');
  });

  it('renders and sends to the contact with an unsubscribe link', async () => {
    dealModel.findOne.mockReturnValue(populatedDeal());

    await expect(processTriggerRun(run)).resolves.toEqual({ status: 'sent' });

    const email = sendSesEmail.mock.calls[0][0];
    expect(email).toMatchObject({ to: 'ada@example.com', subject: 'Hi Ada', fromName: 'Acme', replyTo: 'grace@co.test' });
    expect(email.html).toContain('<p>Proposal</p>');
    expect(email.unsubscribeUrl).toMatch(/^https:\/\/api\.test\/api\/v1\/public\/email\/unsubscribe/);
    expect(runModel.updateOne).toHaveBeenCalledWith(
      { _id: run._id },
      { $set: expect.objectContaining({ status: 'sent', ses_message_id: 'ses-123' }) }
    );
    expect(triggerModel.updateOne).toHaveBeenCalled();
  });

  it('skips when the deal has already left the stage', async () => {
    dealModel.findOne.mockReturnValue(populatedDeal({ stage_id: { _id: otherStageId, name: 'Won' } }));

    await expect(processTriggerRun(run)).resolves.toMatchObject({ status: 'skipped' });
    expect(sendSesEmail).not.toHaveBeenCalled();
  });

  it('skips contacts who unsubscribed', async () => {
    dealModel.findOne.mockReturnValue(
      populatedDeal({ contact_id: { _id: new mongoose.Types.ObjectId(), first_name: 'A', last_name: 'B', email: 'a@b.c', email_opt_out: true } })
    );

    await expect(processTriggerRun(run)).resolves.toMatchObject({ status: 'skipped', error: 'Contact has unsubscribed' });
    expect(sendSesEmail).not.toHaveBeenCalled();
  });

  it('records SES failures', async () => {
    dealModel.findOne.mockReturnValue(populatedDeal());
    sendSesEmail.mockRejectedValueOnce(new Error('Throttling'));

    await expect(processTriggerRun(run)).resolves.toEqual({ status: 'failed', error: 'Throttling' });
  });
});
