import { Response } from 'express';
import { User } from '../models/User';
import { EmailMessage } from '../models/EmailMessage';
import { Contact } from '../models/Contact';
import { AuthRequest } from '../types';
import config from '../config';
import { requireOrganization } from '../utils/tenant';
import { decryptString, encryptString } from '../utils/crypto';
import { GMAIL_SCOPES, getAuthedGmail, getEmailOAuth2Client } from '../utils/gmail';

const decodeBase64 = (data: string): string => {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
};

const parseHeader = (headers: Array<{ name?: string | null; value?: string | null }>, name: string): string => {
  const header = headers?.find((h) => h.name === name);
  return header?.value || '';
};

const parseEmailAddress = (raw: string): { name: string; address: string } => {
  const match = raw.match(/^(?:"?([^"<]*)"?\s)?<?([^>]+)>?$/);
  if (match) {
    return { name: match[1]?.trim() || match[2].split('@')[0], address: match[2].toLowerCase() };
  }
  return { name: raw.split('@')[0], address: raw.toLowerCase() };
};

export const getGmailAuthUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const oauth2Client = getEmailOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state: `${req.user?.id}:${organizationId.toString()}`,
    });

    res.json({ status: true, data: { url } });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to generate auth URL' });
  }
};

export const handleGmailCallback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ status: false, message: 'Missing authorization code' });
      return;
    }

    const oauth2Client = getEmailOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      res.status(400).json({ status: false, message: 'Failed to get access token' });
      return;
    }

    const [userId, organizationId] = String(state || '').split(':');
    const user = userId && organizationId
      ? await User.findOne({ _id: userId, organization_id: organizationId })
      : null;

    if (!user) {
      res.status(401).json({ status: false, message: 'User not found' });
      return;
    }

    user.google_access_token = encryptString(tokens.access_token);
    if (tokens.refresh_token) {
      user.google_refresh_token = encryptString(tokens.refresh_token);
    }
    user.gmail_sync_enabled = true;
    await user.save();

    res.redirect(`${config.ORIGIN || 'http://localhost:3000'}?gmail=connected`);
  } catch (error) {
    console.error('Gmail auth callback error:', error);
    res.status(500).json({ status: false, message: 'Failed to complete Gmail auth' });
  }
};

export const syncGmailInbox = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOne({ _id: req.user?.id, organization_id: organizationId });
    if (!user || !user.google_access_token) {
      res.status(400).json({ status: false, message: 'Gmail not connected. Please authorize Gmail access first.' });
      return;
    }

    const accessToken = decryptString(user.google_access_token);
    if (!accessToken) {
      res.status(400).json({ status: false, message: 'Gmail not connected. Please authorize Gmail access first.' });
      return;
    }

    const gmail = getAuthedGmail(accessToken, decryptString(user.google_refresh_token) || '');

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 25,
    });

    const messageIds = listRes.data.messages || [];

    if (messageIds.length === 0) {
      res.json({ status: true, message: 'No new messages found', data: { synced: 0, total: 0, linked: 0 } });
      return;
    }

    let synced = 0;
    let linked = 0;

    for (const msg of messageIds) {
      if (!msg.id) continue;

      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const fromRaw = parseHeader(headers, 'From');
      const { name: fromName, address: fromEmail } = parseEmailAddress(fromRaw);
      const toRaw = parseHeader(headers, 'To');
      const toEmails = toRaw.split(',').map((e) => e.trim());
      const subject = parseHeader(headers, 'Subject');
      const dateRaw = parseHeader(headers, 'Date');
      const receivedAt = dateRaw ? new Date(dateRaw) : new Date();
      const isRead = !detail.data.labelIds?.includes('UNREAD');
      const snippet = detail.data.snippet || '';

      const existing = await EmailMessage.findOne({
        user_id: user._id,
        organization_id: organizationId,
        gmail_message_id: msg.id,
      });

      if (existing) {
        existing.is_read = isRead;
        await existing.save();
        continue;
      }

      const contact = await Contact.findOne({ email: fromEmail, organization_id: organizationId });

      await EmailMessage.create({
        user_id: user._id,
        organization_id: organizationId,
        gmail_message_id: msg.id,
        thread_id: detail.data.threadId || msg.id,
        from_name: fromName,
        from_email: fromEmail,
        to: toEmails,
        subject,
        snippet,
        received_at: receivedAt,
        is_read: isRead,
        contact_id: contact?._id ?? undefined,
      });

      synced++;
      if (contact) linked++;
    }

    user.last_gmail_sync_at = new Date();
    await user.save();

    const totalMessages = await EmailMessage.countDocuments({ user_id: user._id, organization_id: organizationId });

    res.json({
      status: true,
      message: 'Gmail inbox synced successfully',
      data: { synced, total: totalMessages, linked },
    });
  } catch (error: any) {
    console.error('Gmail sync error:', error);
    if (error?.response?.status === 401) {
      res.status(401).json({ status: false, message: 'Gmail access expired. Please re-authorize.' });
      return;
    }
    res.status(500).json({ status: false, message: 'Failed to sync Gmail inbox' });
  }
};

export const listSyncedMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOne({ _id: req.user?.id, organization_id: organizationId });
    if (!user) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      EmailMessage.find({ user_id: user._id, organization_id: organizationId })
        .sort({ received_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate('contact_id', 'first_name last_name email'),
      EmailMessage.countDocuments({ user_id: user._id, organization_id: organizationId }),
    ]);

    const withContact = messages.filter((m) => m.contact_id).length;
    const linkedSenders = await EmailMessage.distinct('from_email', {
      user_id: user._id,
      organization_id: organizationId,
      contact_id: { $ne: null },
    });
    const totalSenders = await EmailMessage.distinct('from_email', { user_id: user._id, organization_id: organizationId });

    res.json({
      status: true,
      data: messages,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      stats: {
        synced_count: total,
        link_ratio: totalSenders.length > 0 ? Math.round((linkedSenders.length / totalSenders.length) * 100) : 0,
        linked_senders: linkedSenders.length,
        total_senders: totalSenders.length,
        linked_messages: withContact,
      },
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch messages' });
  }
};

export const createContactFromSender = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const message = await EmailMessage.findOne({
      _id: req.params.messageId,
      user_id: req.user?.id,
      organization_id: organizationId,
    });

    if (!message) {
      res.status(404).json({ status: false, message: 'Message not found' });
      return;
    }

    if (message.contact_id) {
      res.status(400).json({ status: false, message: 'Sender already linked to a contact' });
      return;
    }

    const existingContact = await Contact.findOne({ email: message.from_email, organization_id: organizationId });
    if (existingContact) {
      message.contact_id = existingContact._id;
      await message.save();
      res.json({ status: true, message: 'Linked to existing contact', data: { contact: existingContact } });
      return;
    }

    const nameParts = message.from_name.split(' ');
    const firstName = nameParts[0] || message.from_email.split('@')[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    const contact = await Contact.create({
      first_name: firstName,
      last_name: lastName,
      email: message.from_email,
      owner_id: req.user?.id,
      organization_id: organizationId,
    });

    message.contact_id = contact._id;
    await message.save();

    res.status(201).json({ status: true, message: 'Contact created from sender', data: { contact } });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to create contact' });
  }
};

export const linkMessageToContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contactId } = req.body;

    if (!contactId) {
      res.status(400).json({ status: false, message: 'contactId is required' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contact = await Contact.findOne({ _id: contactId, organization_id: organizationId });
    if (!contact) {
      res.status(404).json({ status: false, message: 'Contact not found' });
      return;
    }

    const message = await EmailMessage.findOneAndUpdate(
      { _id: req.params.messageId, user_id: req.user?.id, organization_id: organizationId },
      { contact_id: contactId },
      { new: true }
    );

    if (!message) {
      res.status(404).json({ status: false, message: 'Message not found' });
      return;
    }

    res.json({ status: true, message: 'Message linked to contact', data: { message } });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to link message' });
  }
};

export const gmailStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOne({ _id: req.user?.id, organization_id: organizationId })
      .select('gmail_sync_enabled last_gmail_sync_at google_access_token');

    if (!user) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const totalMessages = await EmailMessage.countDocuments({ user_id: user._id, organization_id: organizationId });

    res.json({
      status: true,
      data: {
        connected: !!user.google_access_token,
        gmail_sync_enabled: user.gmail_sync_enabled,
        last_sync_at: user.last_gmail_sync_at,
        synced_count: totalMessages,
      },
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to get Gmail status' });
  }
};
