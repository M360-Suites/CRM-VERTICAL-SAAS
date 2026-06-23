import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../types';
import {
  EMAIL_LENGTHS,
  EMAIL_PURPOSES,
  EMAIL_TONES,
  EmailLength,
  EmailPurpose,
  EmailTone,
  generateEmail
} from '../utils/groq';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { Company } from '../models/Company';
import { Activity } from '../models/Activity';
import { IUser, User } from '../models/User';
import { requireOrganization } from '../utils/tenant';
import { decryptString } from '../utils/crypto';
import { createRawEmail, getAuthedGmail, RawEmailAttachment } from '../utils/gmail';
import { clearGmailConnection, getSafeGoogleErrorLog, isInvalidGoogleGrantError } from '../utils/gmailConnection';

interface GenerateEmailBody {
  contact_id?: string;
  deal_id?: string;
  company_id?: string;
  purpose?: string;
  tone?: string;
  length?: string;
  recipient_name?: string;
  sender_name?: string;
  key_points?: unknown;
  additional_notes?: string;
  custom_instructions?: string;
  subject?: string;
}

interface SendEmailBody {
  contact_id?: string;
  deal_id?: string;
  to?: unknown;
  subject?: string;
  body?: string;
  message?: string;
}

type EmailContext = {
  company_name?: string;
  company_industry?: string;
  deal_title?: string;
  deal_value?: number;
  contact_name?: string;
  contact_role?: string;
};

const MAX_KEY_POINTS = 10;
const MAX_KEY_POINT_LENGTH = 220;
const MAX_RECIPIENTS = 10;
const MAX_SUBJECT_LENGTH = 180;
const MAX_EMAIL_BODY_LENGTH = 10000;
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_TOTAL_SIZE = 20 * 1024 * 1024;
const EMAIL_WRITER_OPTIONS = ['friendly', 'professional', 'follow_up', 'cold_outreach', 'thank_you'] as const;

type EmailWriterOption = typeof EMAIL_WRITER_OPTIONS[number];

const asTrimmedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
};

const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').trim();

const isOneOf = <T extends readonly string[]>(value: string, values: T): value is T[number] =>
  (values as readonly string[]).includes(value);

const validateObjectId = (value: string | undefined, label: string): string | undefined => {
  if (!value) return undefined;
  if (!mongoose.Types.ObjectId.isValid(value)) return `${label} is invalid`;
  return undefined;
};

const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeRecipients = (value: unknown): { recipients?: Array<{ address: string; name: string }>; error?: string } => {
  if (value === undefined) return {};

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return normalizeRecipients(JSON.parse(trimmed));
      } catch {
        return { error: 'to must be a valid email recipient or JSON recipient list' };
      }
    }
  }

  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) return { error: 'to must include at least one recipient' };
  if (items.length > MAX_RECIPIENTS) return { error: `to cannot contain more than ${MAX_RECIPIENTS} recipients` };

  const recipients = items.map((item) => {
    if (typeof item === 'string') {
      const address = item.trim().toLowerCase();
      return { address, name: '' };
    }

    if (typeof item === 'object' && item !== null) {
      const recipient = item as { address?: unknown; email?: unknown; name?: unknown };
      const address = asTrimmedString(recipient.address, 254) || asTrimmedString(recipient.email, 254);
      return {
        address: address?.toLowerCase() || '',
        name: sanitizeHeaderValue(asTrimmedString(recipient.name, 120) || '')
      };
    }

    return { address: '', name: '' };
  });

  if (recipients.some((recipient) => !isValidEmail(recipient.address))) {
    return { error: 'to must contain valid email recipients' };
  }

  const deduped = Array.from(
    new Map(recipients.map((recipient) => [recipient.address, recipient])).values()
  );

  return { recipients: deduped };
};

const getUploadedEmailDocuments = (req: AuthRequest): Express.Multer.File[] => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;

  const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (!filesByField) return [];

  return filesByField.attachments || [];
};

const normalizeAttachments = (files: Express.Multer.File[]): { attachments?: RawEmailAttachment[]; error?: string } => {
  if (files.length === 0) return {};
  if (files.length > MAX_ATTACHMENT_COUNT) return { error: `attachments cannot contain more than ${MAX_ATTACHMENT_COUNT} files` };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
    return { error: 'attachments cannot exceed 20MB total' };
  }

  return {
    attachments: files.map((file) => ({
      filename: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer
    }))
  };
};

const normalizeWriterOption = (value: string): { tone: EmailTone; purpose: EmailPurpose } => {
  if (isOneOf(value, EMAIL_TONES)) {
    return { tone: value, purpose: 'follow_up' };
  }

  const optionMap: Record<EmailWriterOption, { tone: EmailTone; purpose: EmailPurpose }> = {
    friendly: { tone: 'friendly', purpose: 'follow_up' },
    professional: { tone: 'professional', purpose: 'follow_up' },
    follow_up: { tone: 'professional', purpose: 'follow_up' },
    cold_outreach: { tone: 'professional', purpose: 'cold_outreach' },
    thank_you: { tone: 'friendly', purpose: 'thank_you' }
  };

  return optionMap[value as EmailWriterOption] || { tone: 'professional', purpose: 'follow_up' };
};

const normalizeKeyPoints = (value: unknown): { keyPoints?: string[]; error?: string } => {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: 'key_points must be an array of strings' };
  if (value.length > MAX_KEY_POINTS) return { error: `key_points cannot contain more than ${MAX_KEY_POINTS} items` };

  const keyPoints = value
    .map((point) => asTrimmedString(point, MAX_KEY_POINT_LENGTH))
    .filter((point): point is string => Boolean(point));

  if (keyPoints.length !== value.length) return { error: 'key_points must only contain non-empty strings' };
  return { keyPoints };
};

const getGmailSendErrorMessage = (error: any): string => {
  if (isInvalidGoogleGrantError(error)) return 'Gmail access was revoked or expired. Please reconnect Gmail.';
  const status = error?.response?.status || error?.code;
  if (status === 401) return 'Gmail access expired. Please reconnect Google.';
  if (status === 403) return 'Gmail send permission missing. Please reconnect Google so the app can request send access.';
  return 'Failed to send email';
};

export const generateEmailHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as GenerateEmailBody;
    const contactId = asTrimmedString(body.contact_id, 80);
    const companyId = asTrimmedString(body.company_id, 80);
    const dealId = asTrimmedString(body.deal_id, 80);
    const writerOption = asTrimmedString(body.tone, 50) || 'professional';
    const purpose = asTrimmedString(body.purpose, 50);
    const length = asTrimmedString(body.length, 50) || 'medium';
    const errors = [
      validateObjectId(contactId, 'contact_id'),
      validateObjectId(companyId, 'company_id'),
      validateObjectId(dealId, 'deal_id')
    ].filter((error): error is string => Boolean(error));

    if (!isOneOf(writerOption, EMAIL_WRITER_OPTIONS) && !isOneOf(writerOption, EMAIL_TONES)) {
      errors.push('tone has an invalid value');
    }

    if (purpose && !isOneOf(purpose, EMAIL_PURPOSES)) errors.push('purpose has an invalid value');
    if (!isOneOf(length, EMAIL_LENGTHS)) errors.push('length has an invalid value');

    const { keyPoints, error: keyPointsError } = normalizeKeyPoints(body.key_points);
    if (keyPointsError) errors.push(keyPointsError);

    if (errors.length > 0) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const context: EmailContext = {};
    const normalizedWriterOption = normalizeWriterOption(writerOption);

    if (contactId) {
      const contact = await Contact.findOne({ _id: contactId, organization_id: organizationId })
        .populate('company_id', 'name industry')
        .lean();

      if (!contact) {
        res.status(404).json({ status: false, message: 'Contact not found' });
        return;
      }

      context.contact_name = `${contact.first_name} ${contact.last_name}`.trim();
      context.contact_role = contact.role_title;
      context.company_name = (contact.company_id as unknown as { name?: string })?.name;
      context.company_industry = (contact.company_id as unknown as { industry?: string })?.industry;
    }

    if (companyId) {
      const company = await Company.findOne({ _id: companyId, organization_id: organizationId }).lean();

      if (!company) {
        res.status(404).json({ status: false, message: 'Company not found' });
        return;
      }

      context.company_name = context.company_name || company.name;
      context.company_industry = context.company_industry || company.industry;
    }

    if (dealId) {
      const deal = await Deal.findOne({ _id: dealId, organization_id: organizationId })
        .populate('company_id', 'name')
        .lean();

      if (!deal) {
        res.status(404).json({ status: false, message: 'Deal not found' });
        return;
      }

      context.deal_title = deal.title;
      context.deal_value = deal.value;
      context.company_name = context.company_name || (deal.company_id as unknown as { name?: string })?.name;
    }

    const emailData = await generateEmail({
      purpose: (purpose as EmailPurpose | undefined) || normalizedWriterOption.purpose,
      tone: normalizedWriterOption.tone,
      length: length as EmailLength,
      recipient_name: asTrimmedString(body.recipient_name, 120) || context.contact_name,
      sender_name: asTrimmedString(body.sender_name, 120) || req.user?.display_name,
      key_points: keyPoints,
      custom_instructions: asTrimmedString(body.additional_notes, 1200) || asTrimmedString(body.custom_instructions, 1200),
      subject: asTrimmedString(body.subject, 180),
      context: Object.keys(context).length > 0 ? context : undefined
    });

    res.json({
      status: true,
      message: 'Email generated successfully',
      data: emailData
    });
  } catch (error) {
    console.error('Email generation error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to generate email'
    });
  }
};

export const sendEmailHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  let gmailUser: IUser | null = null;

  try {
    const body = req.body as SendEmailBody;
    const contactId = asTrimmedString(body.contact_id, 80);
    const dealId = asTrimmedString(body.deal_id, 80);
    const subject = asTrimmedString(body.subject, MAX_SUBJECT_LENGTH);
    const message = asTrimmedString(body.body, MAX_EMAIL_BODY_LENGTH) || asTrimmedString(body.message, MAX_EMAIL_BODY_LENGTH);
    const { attachments, error: attachmentsError } = normalizeAttachments(getUploadedEmailDocuments(req));
    const { recipients: explicitRecipients, error: recipientsError } = normalizeRecipients(body.to);
    const errors = [
      validateObjectId(contactId, 'contact_id'),
      validateObjectId(dealId, 'deal_id')
    ].filter((error): error is string => Boolean(error));

    if (!subject) errors.push('subject is required');
    if (!message) errors.push('body is required');
    if (!explicitRecipients || explicitRecipients.length === 0) errors.push('to is required');
    if (attachmentsError) errors.push(attachmentsError);
    if (recipientsError) errors.push(recipientsError);

    if (errors.length > 0) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }
    const requiredRecipients = explicitRecipients as Array<{ address: string; name: string }>;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    let contact: { _id: mongoose.Types.ObjectId; first_name: string; last_name: string; email?: string } | null = null;
    if (contactId) {
      contact = await Contact.findOne({ _id: contactId, organization_id: organizationId })
        .select('first_name last_name email')
        .lean();

      if (!contact) {
        res.status(404).json({ status: false, message: 'Contact not found' });
        return;
      }

      if (!contact.email || !isValidEmail(contact.email)) {
        res.status(400).json({ status: false, message: 'Selected contact does not have a valid email address' });
        return;
      }
    }

    if (dealId) {
      const deal = await Deal.exists({ _id: dealId, organization_id: organizationId });
      if (!deal) {
        res.status(404).json({ status: false, message: 'Deal not found' });
        return;
      }
    }

    const contactRecipient = contact
      ? [{
          address: contact.email as string,
          name: `${contact.first_name} ${contact.last_name}`.trim()
        }]
      : [];
    const recipients = [...contactRecipient, ...requiredRecipients];
    const dedupedRecipients = Array.from(
      new Map(recipients.map((recipient) => [recipient.address.toLowerCase(), {
        address: recipient.address.toLowerCase(),
        name: recipient.name
      }])).values()
    );

    if (dedupedRecipients.length === 0) {
      res.status(400).json({ status: false, message: 'Provide contact_id or to recipients' });
      return;
    }

    gmailUser = await User.findOne({ _id: req.user?.id, organization_id: organizationId })
      .select('email display_name google_access_token google_refresh_token gmail_sync_enabled last_gmail_sync_at');

    const accessToken = gmailUser?.google_access_token ? decryptString(gmailUser.google_access_token) || '' : '';
    const refreshToken = gmailUser?.google_refresh_token ? decryptString(gmailUser.google_refresh_token) || '' : '';
    if (!gmailUser || !accessToken) {
      res.status(400).json({
        status: false,
        message: 'Gmail not connected. Please connect Google before sending email.'
      });
      return;
    }

    const gmail = getAuthedGmail(accessToken, refreshToken);
    const sendResult = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: createRawEmail({
          from: {
            address: gmailUser.email,
            name: gmailUser.display_name
          },
          to: dedupedRecipients,
          subject: subject as string,
          body: message as string,
          attachments
        })
      }
    });

    const sentAt = new Date();
    if (contactId) {
      await Contact.updateOne(
        { _id: contactId, organization_id: organizationId },
        { $set: { last_contacted_at: sentAt } }
      );
    }

    await Activity.create({
      type: 'email',
      content: `Email sent: ${subject}`,
      contact_id: contactId ? new mongoose.Types.ObjectId(contactId) : undefined,
      deal_id: dealId ? new mongoose.Types.ObjectId(dealId) : undefined,
      user_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      organization_id: organizationId,
      metadata: {
        subject,
        recipients: dedupedRecipients.map((recipient) => recipient.address),
        attachments: (attachments || []).map((attachment) => ({
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          size: attachment.content.length
        })),
        gmail_message_id: sendResult.data.id,
        thread_id: sendResult.data.threadId,
        sent_at: sentAt
      }
    });

    res.json({
      status: true,
      message: 'Email sent successfully',
      data: {
        subject,
        recipients: dedupedRecipients,
        attachments: (attachments || []).map((attachment) => ({
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          size: attachment.content.length
        })),
        from: {
          address: gmailUser.email,
          name: gmailUser.display_name
        },
        gmail_message_id: sendResult.data.id,
        thread_id: sendResult.data.threadId,
        sent_at: sentAt
      }
    });
  } catch (error: any) {
    console.error('Email send error:', getSafeGoogleErrorLog(error));
    if (gmailUser && isInvalidGoogleGrantError(error)) {
      await clearGmailConnection(gmailUser);
      res.status(401).json({
        status: false,
        code: 'GMAIL_RECONNECT_REQUIRED',
        message: getGmailSendErrorMessage(error)
      });
      return;
    }

    const status = error?.response?.status || error?.code;
    res.status(status === 401 ? 401 : status === 403 ? 403 : 500).json({
      status: false,
      message: getGmailSendErrorMessage(error)
    });
  }
};
