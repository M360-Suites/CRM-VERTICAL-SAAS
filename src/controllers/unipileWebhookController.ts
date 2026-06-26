import { Request, Response } from 'express';
import config from '../config';
import { SocialAccount } from '../models/SocialAccount';
import { Notification } from '../models/Notification';
import { emitNotification } from '../services/socketService';

const providerFromUnipile = (unipileProvider: string): string => {
  const map: Record<string, string> = {
    WHATSAPP: 'whatsapp',
    INSTAGRAM: 'instagram',
    MESSENGER: 'facebook_messenger',
  };
  return map[unipileProvider] || unipileProvider.toLowerCase();
};

const providerLabel: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook_messenger: 'Facebook Messenger'
};

const LOG_PREFIX = '[Unipile Debug]';

const isMessageEvent = (event: Record<string, unknown>): boolean => {
  const eventType = event.event as string;
  const messageEventTypes = ['message_received', 'message', 'messaging', 'inbox_item', 'conversation_message'];
  const matched = messageEventTypes.includes(eventType);
  console.log(`${LOG_PREFIX} isMessageEvent check: event.event="${eventType}" matched=${matched}`);
  return matched;
};

const extractAccountId = (event: Record<string, unknown>): string | undefined => {
  const flatId = (event.account_id || event.accountId) as string | undefined;
  console.log(`${LOG_PREFIX} extractAccountId: flat account_id="${event.account_id}" accountId="${event.accountId}"`);

  if (flatId) {
    console.log(`${LOG_PREFIX} extractAccountId: found via flat field: "${flatId}"`);
    return flatId;
  }

  const entry = event.entry as Array<Record<string, unknown>> | undefined;
  if (entry?.[0]) {
    const entryId = (entry[0].id || entry[0].account_id || entry[0].accountId) as string | undefined;
    console.log(`${LOG_PREFIX} extractAccountId: entry[0] fields:`, JSON.stringify(entry[0]));
    if (entryId) {
      console.log(`${LOG_PREFIX} extractAccountId: found via entry[0]: "${entryId}"`);
      return entryId;
    }
  }

  console.log(`${LOG_PREFIX} extractAccountId: no accountId found in any location`);
  return undefined;
};

const extractSenderName = (event: Record<string, unknown>): string => {
  const flatName = event.sender_name || event.from || event.sender;
  if (typeof flatName === 'string') {
    console.log(`${LOG_PREFIX} extractSenderName: found flat string "${flatName}"`);
    return flatName;
  }

  const attendee = event.attendee as Record<string, unknown> | undefined;
  if (attendee) {
    const name = (attendee.attendee_name || attendee.name) as string | undefined;
    if (name) {
      console.log(`${LOG_PREFIX} extractSenderName: found attendee.attendee_name="${name}"`);
      return name;
    }
    const phone = attendee.attendee_public_identifier as string | undefined;
    if (phone) {
      console.log(`${LOG_PREFIX} extractSenderName: fallback to attendee_public_identifier="${phone}"`);
      return phone;
    }
  }

  const entry = event.entry as Array<Record<string, unknown>> | undefined;
  const messaging = entry?.[0]?.messaging as Array<Record<string, unknown>> | undefined;
  const sender = messaging?.[0]?.sender as Record<string, unknown> | undefined;
  if (sender) {
    console.log(`${LOG_PREFIX} extractSenderName: checking entry[0].messaging[0].sender`);
    return (sender.name || sender.id || 'Unknown') as string;
  }

  console.log(`${LOG_PREFIX} extractSenderName: no sender name found, using "Unknown"`);
  return 'Unknown';
};

const extractMessageContent = (event: Record<string, unknown>): string | undefined => {
  const flatChecks = [
    { field: 'content', value: event.content },
    { field: 'text', value: event.text },
    { field: 'body', value: event.body },
    { field: 'message', value: event.message },
    { field: 'text_content', value: event.text_content },
    { field: 'message_body', value: event.message_body },
  ];

  console.log(`${LOG_PREFIX} extractMessageContent flat fields:`, JSON.stringify(Object.fromEntries(flatChecks.map(c => [c.field, typeof c.value]))));

  for (const { field, value } of flatChecks) {
    if (value) {
      console.log(`${LOG_PREFIX} extractMessageContent: found content in "${field}" (${(value as string).length} chars)`);
      return value as string;
    }
  }

  const entry = event.entry as Array<Record<string, unknown>> | undefined;
  if (entry?.[0]) {
    console.log(`${LOG_PREFIX} extractMessageContent: checking entry[0].messaging`);
    const messaging = entry[0].messaging as Array<Record<string, unknown>> | undefined;
    if (messaging?.[0]) {
      const message = messaging[0].message as Record<string, unknown> | undefined;
      if (message) {
        const text = (message.text || message.content || message.body) as string | undefined;
        console.log(`${LOG_PREFIX} extractMessageContent: entry[0].messaging[0].message fields:`, JSON.stringify(Object.keys(message)));
        if (text) {
          console.log(`${LOG_PREFIX} extractMessageContent: found via nested entry path (${text.length} chars)`);
          return text;
        }
      }
    }
  }

  console.log(`${LOG_PREFIX} extractMessageContent: no content found`);
  return undefined;
};

export const handleUnipileWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('WEBHOOK HIT');
    console.log(JSON.stringify(req.body, null, 2));

    const event = req.body;

    if (event.status === 'CREATION_SUCCESS') {
      const accountId = event.account_id;
      const userId = event.name;
      const accountType = event.account_type;

      console.log('[Unipile Webhook] CREATION_SUCCESS event:', {
        account_id: accountId,
        name: userId,
        account_type: accountType
      });

      if (!accountId || !userId || !accountType) {
        console.warn('[Unipile Webhook] Missing fields in CREATION_SUCCESS — cannot create SocialAccount');
        res.status(200).json({ status: true });
        return;
      }

      const provider = providerFromUnipile(accountType);

      const saved = await SocialAccount.findOneAndUpdate(
        { accountId },
        {
          userId,
          provider,
          accountId,
          status: 'connected',
          connectedAt: new Date()
        },
        { upsert: true, new: true }
      );

      console.log(`[Unipile Webhook] SocialAccount saved successfully:`, {
        account_id: accountId,
        name: userId,
        account_type: accountType,
        provider,
        mongo_id: saved._id
      });
    }

    if (isMessageEvent(event)) {
      console.log(`${LOG_PREFIX} Processing message event, keys:`, Object.keys(event));

      const accountId = extractAccountId(event);

      if (!accountId) {
        console.warn('[Unipile Webhook] Missing accountId in message event');
        res.status(200).json({ status: true });
        return;
      }

      const socialAccount = await SocialAccount.findOne({ accountId });
      if (!socialAccount) {
        console.warn(`[Unipile Webhook] No SocialAccount found for accountId: "${accountId}" — account may not be connected via Unipile or CREATION_SUCCESS webhook never fired`);
        res.status(200).json({ status: true });
        return;
      }

      console.log(`${LOG_PREFIX} Found SocialAccount: provider="${socialAccount.provider}" userId="${socialAccount.userId}"`);

      const sender = extractSenderName(event);
      console.log(`${LOG_PREFIX} Extracted sender: "${sender}"`);

      const content = extractMessageContent(event);
      console.log(`${LOG_PREFIX} Content extracted:`, content ? `"${content.slice(0, 80)}..." (${content.length} chars)` : 'NO CONTENT FOUND');

      const preview = content
        ? (content.length > 100 ? content.slice(0, 100) + '...' : content)
        : undefined;

      const convId = (event.conversation_id || event.conversationId) as string | undefined;
      console.log(`${LOG_PREFIX} conversation_id="${convId}"`);

      const attendee = event.attendee as Record<string, unknown> | undefined;

      const notification = await Notification.create({
        userId: socialAccount.userId,
        provider: socialAccount.provider,
        type: 'new_message',
        title: preview
          ? `${sender}: ${preview}`
          : `New ${providerLabel[socialAccount.provider] || socialAccount.provider} Message from ${sender}`,
        metadata: {
          sender,
          attendee: attendee || undefined,
          accountId,
          content,
          conversation_id: convId,
        }
      });

      console.log(`${LOG_PREFIX} Notification created: _id="${notification._id}" title="${notification.title}"`);

      emitNotification(socialAccount.userId.toString(), {
        provider: socialAccount.provider,
        title: notification.title,
        createdAt: notification.created_at
      });

      console.log(`${LOG_PREFIX} Real-time notification emitted via socket`);
    }

    res.status(200).json({ status: true });
  } catch (error) {
    console.error('[Unipile Webhook] Error:', error);
    res.status(200).json({ status: true });
  }
};
