/**
 * StageMessage controller
 * Handles the internal discussion/comment thread on a pipeline stage
 * Stage assignees, users mentioned in the thread, and admins/sales managers can read and post
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { StageMessage } from '../models/StageMessage';
import { PipelineStage } from '../models/Pipeline';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { AuthRequest, ApiResponse } from '../types';
import { requireOrganization } from '../utils/tenant';
import { emitStageMessage } from '../services/socketService';
import { sendStageCommentEmail } from '../utils/email';

const MAX_CONTENT_LENGTH = 5000;
const MAX_MENTIONS = 50;

const isValidObjectId = (value: unknown): value is string =>
  typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);

const isAdminOrManager = (req: AuthRequest): boolean =>
  !!req.user && (req.user.role === 'admin' || req.user.role === 'sales_manager');

/**
 * Verify the requesting user can access the stage discussion board.
 * Access is granted to stage assignees, users mentioned in the thread, and admins/sales managers
 * (who manage stage membership).
 */
const canAccessStage = async (
  req: AuthRequest,
  stageId: string,
  organizationId: mongoose.Types.ObjectId
): Promise<{ allowed: boolean; stage?: { _id: mongoose.Types.ObjectId; name: string; assignees: mongoose.Types.ObjectId[] } }> => {
  if (!req.user) return { allowed: false };
  if (isAdminOrManager(req)) return { allowed: true };

  const stage = await PipelineStage.findOne({ _id: stageId, organization_id: organizationId })
    .select('_id name assignees')
    .lean();
  if (!stage) return { allowed: false };

  const assigned = (stage.assignees || []).some(
    (assigneeId) => assigneeId.toString() === req.user?.id
  );
  if (assigned) return { allowed: true, stage };

  const mentioned = await StageMessage.exists({
    stage_id: stageId,
    organization_id: organizationId,
    mentions: toObjectId(req.user.id)
  });
  return { allowed: !!mentioned, stage };
};

/**
 * Read `mentions` from the request body: an array of user IDs (or `{ id }` objects).
 * Unknown, inactive or other-org users and the sender are dropped silently — the
 * frontend matches names client-side, so a stale entry shouldn't fail the comment.
 * Returns undefined when the field is absent, or an error message when malformed.
 */
const parseMentions = async (
  body: unknown,
  organizationId: mongoose.Types.ObjectId,
  senderId: string
): Promise<{ ids?: mongoose.Types.ObjectId[]; error?: string }> => {
  const raw = (body as Record<string, unknown> | undefined)?.mentions;
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw)) return { error: 'mentions must be an array of user IDs' };
  if (raw.length > MAX_MENTIONS) return { error: `mentions cannot exceed ${MAX_MENTIONS} users` };

  const candidates = new Set<string>();
  for (const entry of raw) {
    const id =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>)._id ?? (entry as Record<string, unknown>).user_id
        : entry;
    if (isValidObjectId(id) && id !== senderId) candidates.add(id);
  }
  if (candidates.size === 0) return { ids: [] };

  const users = await User.find({
    _id: { $in: [...candidates].map(toObjectId) },
    organization_id: organizationId,
    is_active: true
  })
    .select('_id')
    .lean();
  return { ids: users.map((user) => user._id as mongoose.Types.ObjectId) };
};

const notifyMentions = async (
  userIds: string[],
  details: { stageId: string; stageName: string; messageId: string; senderName: string; preview: string }
): Promise<void> => {
  if (userIds.length === 0) return;
  await Notification.create(
    userIds.map((userId) => ({
      userId: toObjectId(userId),
      provider: 'internal',
      type: 'mention',
      title: `${details.senderName} mentioned you in ${details.stageName || 'a stage'}`,
      metadata: {
        stage_id: details.stageId,
        stage_name: details.stageName,
        message_id: details.messageId,
        sender_name: details.senderName,
        preview: details.preview
      }
    }))
  );
};

const emailCommentRecipients = (
  userIds: string[],
  details: { senderName: string; stageName: string; content: string; stageId: string }
): void => {
  if (userIds.length === 0) return;
  void (async () => {
    try {
      const users = await User.find({ _id: { $in: userIds }, is_active: true })
        .select('email display_name')
        .lean();

      const emailRecipients = users.map((user) => ({
        address: user.email,
        name: user.display_name || ''
      }));

      if (emailRecipients.length > 0) {
        await sendStageCommentEmail(emailRecipients, {
          senderName: details.senderName,
          stageName: details.stageName || 'a stage',
          content: details.content,
          discussionUrl: process.env.FRONTEND_URL
            ? `${process.env.FRONTEND_URL}pipeline?stageId=${details.stageId}`
            : undefined
        });
      }
    } catch (emailError) {
      console.error('Failed to send stage comment email notification:', emailError);
    }
  })();
};

const formatMessage = (message: {
  _id: unknown;
  stage_id: unknown;
  sender_id: unknown;
  content: string;
  mentions?: unknown[];
  edited: boolean;
  created_at?: Date;
  updated_at?: Date;
}, currentUserId?: string) => {
  const sender =
    typeof message.sender_id === 'object' && message.sender_id && '_id' in message.sender_id
      ? message.sender_id as { _id: unknown; display_name?: string; email: string; avatar_url?: string }
      : null;

  return {
    id: message._id,
    stage_id:
      typeof message.stage_id === 'object' && message.stage_id && '_id' in message.stage_id
        ? (message.stage_id as { _id: unknown })._id
        : message.stage_id,
    content: message.content,
    mentions: (message.mentions || []).map(String),
    edited: message.edited,
    sender: sender
      ? {
          id: sender._id,
          display_name: sender.display_name,
          email: sender.email,
          avatar_url: sender.avatar_url
        }
      : null,
    is_owner: sender ? String(sender._id) === currentUserId : false,
    created_at: message.created_at,
    updated_at: message.updated_at
  };
};

export const listStageMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId } = req.params as { stageId: string };
    if (!isValidObjectId(stageId)) {
      res.status(400).json({ status: false, message: 'Invalid stage ID' });
      return;
    }

    const access = await canAccessStage(req, stageId, organizationId);
    if (!access.allowed) {
      res.status(403).json({ status: false, message: "You don't have permission to view this stage discussion" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      StageMessage.find({ stage_id: stageId, organization_id: organizationId })
        .populate('sender_id', 'display_name email avatar_url')
        .sort({ created_at: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StageMessage.countDocuments({ stage_id: stageId, organization_id: organizationId })
    ]);

    const response: ApiResponse<{
      data: Array<ReturnType<typeof formatMessage>>;
      total: number;
      page: number;
      limit: number;
      total_pages: number;
    }> = {
      status: true,
      message: 'Stage messages retrieved successfully',
      data: {
        data: messages.map((message) => formatMessage(message, req.user?.id)),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch stage messages' });
  }
};

export const createStageMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId } = req.params as { stageId: string };
    if (!isValidObjectId(stageId)) {
      res.status(400).json({ status: false, message: 'Invalid stage ID' });
      return;
    }

    const access = await canAccessStage(req, stageId, organizationId);
    if (!access.allowed) {
      res.status(403).json({ status: false, message: "You don't have permission to post in this stage discussion" });
      return;
    }

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      res.status(400).json({ status: false, message: 'content is required' });
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      res.status(400).json({ status: false, message: `content cannot exceed ${MAX_CONTENT_LENGTH} characters` });
      return;
    }

    const mentions = await parseMentions(req.body, organizationId, req.user!.id);
    if (mentions.error) {
      res.status(400).json({ status: false, message: mentions.error });
      return;
    }

    const message = await StageMessage.create({
      stage_id: toObjectId(stageId),
      organization_id: organizationId,
      sender_id: toObjectId(req.user!.id),
      content,
      mentions: mentions.ids || []
    });

    const populated = await StageMessage.findById(message._id)
      .populate('sender_id', 'display_name email avatar_url')
      .lean();

    const assigneeIds: string[] = [];
    let stageName = '';
    if (access.stage) {
      stageName = access.stage.name;
      assigneeIds.push(...access.stage.assignees.map((id) => id.toString()));
    } else {
      const stage = await PipelineStage.findOne({ _id: stageId, organization_id: organizationId })
        .select('name assignees')
        .lean();
      stageName = stage?.name || '';
      assigneeIds.push(...(stage?.assignees || []).map((id) => id.toString()));
    }

    const mentionedIds = (mentions.ids || []).map(String);
    // Mentioned users get a `mention` notification instead of the generic `stage_message` one
    const assigneeRecipients = assigneeIds.filter((id) => id !== req.user?.id && !mentionedIds.includes(id));
    const recipients = [...assigneeRecipients, ...mentionedIds];
    const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
    const senderName = req.user!.display_name || req.user!.email;

    await Notification.create(
      assigneeRecipients.map((userId) => ({
        userId: toObjectId(userId),
        provider: 'internal',
        type: 'stage_message',
        title: `${req.user!.display_name || req.user!.email} commented in ${stageName || 'a stage'}`,
        metadata: {
          stage_id: stageId,
          stage_name: stageName,
          message_id: message._id.toString(),
          sender_name: senderName,
          preview
        }
      }))
    );
    await notifyMentions(mentionedIds, {
      stageId,
      stageName,
      messageId: message._id.toString(),
      senderName,
      preview
    });

    emailCommentRecipients(recipients, { senderName, stageName, content, stageId });

    emitStageMessage(stageId, recipients, {
      event: 'created',
      organizationId: organizationId.toString(),
      message: populated ? formatMessage(populated, req.user?.id) : undefined,
      createdAt: message.created_at
    });

    res.status(201).json({
      status: true,
      message: 'Message posted successfully',
      data: populated ? formatMessage(populated, req.user?.id) : null
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to post message' });
  }
};

export const updateStageMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId, messageId } = req.params as { stageId: string; messageId: string };
    if (!isValidObjectId(stageId) || !isValidObjectId(messageId)) {
      res.status(400).json({ status: false, message: 'Invalid stage or message ID' });
      return;
    }

    const access = await canAccessStage(req, stageId, organizationId);
    if (!access.allowed) {
      res.status(403).json({ status: false, message: "You don't have permission to edit messages in this stage" });
      return;
    }

    const existing = await StageMessage.findOne({ _id: messageId, stage_id: stageId, organization_id: organizationId })
      .select('sender_id mentions')
      .lean();
    if (!existing) {
      res.status(404).json({ status: false, message: 'Message not found' });
      return;
    }

    const isOwner = existing.sender_id.toString() === req.user?.id;
    if (!isOwner && !isAdminOrManager(req)) {
      res.status(403).json({ status: false, message: "You can only edit your own messages" });
      return;
    }

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      res.status(400).json({ status: false, message: 'content is required' });
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      res.status(400).json({ status: false, message: `content cannot exceed ${MAX_CONTENT_LENGTH} characters` });
      return;
    }

    // Mentions are resolved against the original author so they can't mention themselves
    const mentions = await parseMentions(req.body, organizationId, existing.sender_id.toString());
    if (mentions.error) {
      res.status(400).json({ status: false, message: mentions.error });
      return;
    }

    const updated = await StageMessage.findOneAndUpdate(
      { _id: messageId, stage_id: stageId, organization_id: organizationId },
      { $set: { content, edited: true, ...(mentions.ids ? { mentions: mentions.ids } : {}) } },
      { new: true }
    )
      .populate('sender_id', 'display_name email avatar_url')
      .lean();

    // Only people newly mentioned by this edit are notified
    const previous = new Set((existing.mentions || []).map(String));
    const added = (mentions.ids || []).map(String).filter((id) => !previous.has(id) && id !== req.user?.id);
    if (added.length > 0) {
      const stage = access.stage ?? await PipelineStage.findOne({ _id: stageId, organization_id: organizationId })
        .select('name')
        .lean();
      const stageName = stage?.name || '';
      const senderName = req.user!.display_name || req.user!.email;
      await notifyMentions(added, {
        stageId,
        stageName,
        messageId,
        senderName,
        preview: content.length > 100 ? content.slice(0, 100) + '...' : content
      });
      emailCommentRecipients(added, { senderName, stageName, content, stageId });
    }

    emitStageMessage(stageId, added, {
      event: 'updated',
      organizationId: organizationId.toString(),
      message: updated ? formatMessage(updated, req.user?.id) : undefined,
      messageId
    });

    res.json({
      status: true,
      message: 'Message updated successfully',
      data: updated ? formatMessage(updated, req.user?.id) : null
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to update message' });
  }
};

export const deleteStageMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId, messageId } = req.params as { stageId: string; messageId: string };
    if (!isValidObjectId(stageId) || !isValidObjectId(messageId)) {
      res.status(400).json({ status: false, message: 'Invalid stage or message ID' });
      return;
    }

    const access = await canAccessStage(req, stageId, organizationId);
    if (!access.allowed) {
      res.status(403).json({ status: false, message: "You don't have permission to delete messages in this stage" });
      return;
    }

    const existing = await StageMessage.findOne({ _id: messageId, stage_id: stageId, organization_id: organizationId })
      .select('sender_id')
      .lean();
    if (!existing) {
      res.status(404).json({ status: false, message: 'Message not found' });
      return;
    }

    const isOwner = existing.sender_id.toString() === req.user?.id;
    if (!isOwner && !isAdminOrManager(req)) {
      res.status(403).json({ status: false, message: "You can only delete your own messages" });
      return;
    }

    await StageMessage.deleteOne({ _id: messageId, stage_id: stageId, organization_id: organizationId });

    emitStageMessage(stageId, [], {
      event: 'deleted',
      organizationId: organizationId.toString(),
      messageId
    });

    res.json({ status: true, message: 'Message deleted successfully' });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to delete message' });
  }
};
