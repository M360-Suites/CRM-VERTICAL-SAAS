import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

const stageId = new mongoose.Types.ObjectId().toString();
const messageId = new mongoose.Types.ObjectId().toString();
const organizationId = new mongoose.Types.ObjectId().toString();
const userId = new mongoose.Types.ObjectId().toString();
const otherUserId = new mongoose.Types.ObjectId().toString();
const thirdUserId = new mongoose.Types.ObjectId().toString();

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });
const populateAndLean = <T>(value: T) => ({
  populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) })
});

const stageMessageModel = {
  find: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
  exists: jest.fn()
};
const pipelineStageModel = { findOne: jest.fn() };
const notificationModel = { create: jest.fn() };
const userModel = { find: jest.fn() };
const selectLean = <T>(value: T) => ({ select: jest.fn().mockReturnValue(lean(value)) });

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) {
      res.status(401).json({ status: false, message: 'No token provided' });
      return;
    }

    (req as Request & { user?: unknown }).user = {
      id: userId,
      email: 'tester@example.com',
      display_name: 'Test User',
      role: req.header('x-test-role') || 'admin',
      organization_id: organizationId
    };
    next();
  }
}));
jest.mock('../src/models/StageMessage', () => ({ StageMessage: stageMessageModel }));
jest.mock('../src/models/Pipeline', () => ({ PipelineStage: pipelineStageModel }));
jest.mock('../src/models/Notification', () => ({ Notification: notificationModel }));
jest.mock('../src/models/User', () => ({ User: userModel }));
jest.mock('../src/services/socketService', () => ({ emitStageMessage: jest.fn() }));
jest.mock('../src/utils/email', () => ({ sendStageCommentEmail: jest.fn() }));

import stageMessageRoutes from '../src/routes/stageMessageRoutes';

const app = express();
app.use(express.json());
app.use('/pipeline/stages', stageMessageRoutes);

const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

describe('stage messages API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app).get(`/pipeline/stages/${stageId}/messages`);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ status: false, message: 'No token provided' });
  });

  it('lists messages with pagination and formatted sender data', async () => {
    const message = {
      _id: messageId,
      stage_id: stageId,
      sender_id: { _id: userId, display_name: 'Test User', email: 'tester@example.com', avatar_url: 'avatar.png' },
      content: 'First update',
      edited: false,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01')
    };
    stageMessageModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue(lean([message])) }) })
      })
    });
    stageMessageModel.countDocuments.mockResolvedValue(1);

    const response = await authenticated(request(app).get(`/pipeline/stages/${stageId}/messages?page=2&limit=10`));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 1, page: 2, limit: 10, total_pages: 1 });
    expect(response.body.data.data[0]).toMatchObject({ id: messageId, content: 'First update', is_owner: true });
    expect(stageMessageModel.find).toHaveBeenCalledWith(expect.objectContaining({ stage_id: stageId }));
  });

  it('rejects an empty message before writing to the database', async () => {
    const response = await authenticated(request(app).post(`/pipeline/stages/${stageId}/messages`)).send({ content: '  ' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'content is required' });
    expect(stageMessageModel.create).not.toHaveBeenCalled();
  });

  it('creates a message and returns the saved API representation', async () => {
    const created = { _id: messageId, created_at: new Date('2026-01-01') };
    const populated = { ...created, stage_id: stageId, sender_id: { _id: userId, display_name: 'Test User', email: 'tester@example.com' }, content: 'Hello team', edited: false };
    stageMessageModel.create.mockResolvedValue(created);
    stageMessageModel.findById.mockReturnValue(populateAndLean(populated));
    pipelineStageModel.findOne.mockReturnValue({ select: jest.fn().mockReturnValue(lean({ name: 'Qualified', assignees: [] })) });
    notificationModel.create.mockResolvedValue([]);

    const response = await authenticated(request(app).post(`/pipeline/stages/${stageId}/messages`)).send({ content: '  Hello team  ' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: true, message: 'Message posted successfully', data: { id: messageId, content: 'Hello team' } });
    expect(stageMessageModel.create).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello team' }));
  });

  it('updates a message belonging to the current user', async () => {
    stageMessageModel.findOne.mockReturnValue({ select: jest.fn().mockReturnValue(lean({ sender_id: userId })) });
    stageMessageModel.findOneAndUpdate.mockReturnValue(populateAndLean({
      _id: messageId, stage_id: stageId, sender_id: { _id: userId, email: 'tester@example.com' }, content: 'Updated', edited: true
    }));

    const response = await authenticated(request(app).patch(`/pipeline/stages/${stageId}/messages/${messageId}`)).send({ content: 'Updated' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Message updated successfully', data: { content: 'Updated', edited: true } });
    expect(stageMessageModel.findOneAndUpdate).toHaveBeenCalledWith(expect.any(Object), { $set: { content: 'Updated', edited: true } }, { new: true });
  });

  it('prevents a non-owner from deleting a message', async () => {
    pipelineStageModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue(lean({ _id: stageId, name: 'Qualified', assignees: [userId] }))
    });
    stageMessageModel.findOne.mockReturnValue({ select: jest.fn().mockReturnValue(lean({ sender_id: otherUserId })) });

    const response = await authenticated(request(app).delete(`/pipeline/stages/${stageId}/messages/${messageId}`)).set('x-test-role', 'sales_rep');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ status: false, message: 'You can only delete your own messages' });
    expect(stageMessageModel.deleteOne).not.toHaveBeenCalled();
  });

  describe('mentions', () => {
    const createdMessage = (mentions: string[]) => {
      const created = { _id: messageId, created_at: new Date('2026-01-01') };
      stageMessageModel.create.mockResolvedValue(created);
      stageMessageModel.findById.mockReturnValue(populateAndLean({
        ...created, stage_id: stageId, sender_id: { _id: userId, email: 'tester@example.com' }, content: 'Hi @Ada', mentions, edited: false
      }));
    };

    it('stores mentions and sends mentioned users a mention notification', async () => {
      createdMessage([otherUserId]);
      pipelineStageModel.findOne.mockReturnValue(selectLean({ name: 'Qualified', assignees: [otherUserId, thirdUserId] }));
      userModel.find.mockReturnValue(selectLean([{ _id: new mongoose.Types.ObjectId(otherUserId) }]));
      notificationModel.create.mockResolvedValue([]);

      const response = await authenticated(request(app).post(`/pipeline/stages/${stageId}/messages`))
        .send({ content: 'Hi @Ada', mentions: [otherUserId, { id: userId }, 'not-an-id'] });

      expect(response.status).toBe(201);
      expect(response.body.data.mentions).toEqual([otherUserId]);
      // The sender and invalid IDs never reach the user lookup
      expect(userModel.find.mock.calls[0][0]._id.$in.map(String)).toEqual([otherUserId]);
      expect(stageMessageModel.create.mock.calls[0][0].mentions.map(String)).toEqual([otherUserId]);

      const [assigneeNotifications] = notificationModel.create.mock.calls[0];
      expect(assigneeNotifications).toHaveLength(1);
      expect(assigneeNotifications[0]).toMatchObject({ type: 'stage_message' });
      expect(String(assigneeNotifications[0].userId)).toBe(thirdUserId);

      const [mentionNotifications] = notificationModel.create.mock.calls[1];
      expect(mentionNotifications).toHaveLength(1);
      expect(mentionNotifications[0]).toMatchObject({ type: 'mention', title: 'Test User mentioned you in Qualified' });
      expect(String(mentionNotifications[0].userId)).toBe(otherUserId);
    });

    it('rejects mentions that are not an array', async () => {
      const response = await authenticated(request(app).post(`/pipeline/stages/${stageId}/messages`))
        .send({ content: 'Hi', mentions: otherUserId });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('mentions must be an array of user IDs');
      expect(stageMessageModel.create).not.toHaveBeenCalled();
    });

    it('lets a user who was mentioned open the stage discussion without being assigned', async () => {
      pipelineStageModel.findOne.mockReturnValue(selectLean({ _id: stageId, name: 'Qualified', assignees: [] }));
      stageMessageModel.exists.mockResolvedValue({ _id: messageId });
      stageMessageModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue(lean([])) }) })
        })
      });
      stageMessageModel.countDocuments.mockResolvedValue(0);

      const response = await authenticated(request(app).get(`/pipeline/stages/${stageId}/messages`)).set('x-test-role', 'sales_rep');

      expect(response.status).toBe(200);
      expect(stageMessageModel.exists.mock.calls[0][0]).toMatchObject({ stage_id: stageId });
    });

    it('blocks an unassigned user who was never mentioned', async () => {
      pipelineStageModel.findOne.mockReturnValue(selectLean({ _id: stageId, name: 'Qualified', assignees: [] }));
      stageMessageModel.exists.mockResolvedValue(null);

      const response = await authenticated(request(app).get(`/pipeline/stages/${stageId}/messages`)).set('x-test-role', 'sales_rep');

      expect(response.status).toBe(403);
    });

    it('notifies only users newly mentioned by an edit', async () => {
      stageMessageModel.findOne.mockReturnValue(selectLean({ sender_id: userId, mentions: [new mongoose.Types.ObjectId(otherUserId)] }));
      userModel.find.mockReturnValue(selectLean([
        { _id: new mongoose.Types.ObjectId(otherUserId) },
        { _id: new mongoose.Types.ObjectId(thirdUserId) }
      ]));
      stageMessageModel.findOneAndUpdate.mockReturnValue(populateAndLean({
        _id: messageId, stage_id: stageId, sender_id: { _id: userId, email: 'tester@example.com' }, content: 'Hi both', edited: true
      }));
      pipelineStageModel.findOne.mockReturnValue(selectLean({ name: 'Qualified' }));
      notificationModel.create.mockResolvedValue([]);

      const response = await authenticated(request(app).patch(`/pipeline/stages/${stageId}/messages/${messageId}`))
        .send({ content: 'Hi both', mentions: [otherUserId, thirdUserId] });

      expect(response.status).toBe(200);
      expect(stageMessageModel.findOneAndUpdate.mock.calls[0][1].$set.mentions.map(String)).toEqual([otherUserId, thirdUserId]);
      const [notifications] = notificationModel.create.mock.calls[0];
      expect(notifications).toHaveLength(1);
      expect(String(notifications[0].userId)).toBe(thirdUserId);
    });
  });
});
