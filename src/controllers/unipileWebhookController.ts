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

const isMessageEvent = (event: Record<string, unknown>): boolean => {
  const messageEventTypes = ['message_received', 'message', 'messaging', 'inbox_item', 'conversation_message'];
  return messageEventTypes.includes(event.event as string);
};

const extractAccountId = (event: Record<string, unknown>): string | undefined => {
  const id = (event.account_id || event.accountId) as string | undefined;
  if (id) return id;

  const entry = event.entry as Array<Record<string, unknown>> | undefined;
  if (entry?.[0]) {
    return (entry[0].id || entry[0].account_id || entry[0].accountId) as string | undefined;
  }

  return undefined;
};

const extractMessageContent = (event: Record<string, unknown>): string | undefined => {
  const content =
    (event.content as string) ||
    (event.text as string) ||
    (event.body as string) ||
    (event.message as string) ||
    (event.text_content as string) ||
    (event.message_body as string);
  if (content) return content;

  const entry = event.entry as Array<Record<string, unknown>> | undefined;
  const messaging = entry?.[0]?.messaging as Array<Record<string, unknown>> | undefined;
  const message = messaging?.[0]?.message as Record<string, unknown> | undefined;
  if (message) {
    return (message.text || message.content || message.body) as string | undefined;
  }

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
      const accountId = extractAccountId(event);

      if (!accountId) {
        console.warn('[Unipile Webhook] Missing accountId in message event');
        res.status(200).json({ status: true });
        return;
      }

      const socialAccount = await SocialAccount.findOne({ accountId });
      if (!socialAccount) {
        console.warn(`[Unipile Webhook] No SocialAccount found for accountId: ${accountId}`);
        res.status(200).json({ status: true });
        return;
      }

      const sender = event.sender_name || event.from || event.sender || 'Unknown';
      const content = extractMessageContent(event);
      const preview = content
        ? (content.length > 100 ? content.slice(0, 100) + '...' : content)
        : undefined;

      const notification = await Notification.create({
        userId: socialAccount.userId,
        provider: socialAccount.provider,
        type: 'new_message',
        title: preview
          ? `${sender}: ${preview}`
          : `New ${providerLabel[socialAccount.provider] || socialAccount.provider} Message from ${sender}`,
        metadata: {
          sender,
          accountId,
          content,
          conversation_id: (event.conversation_id || event.conversationId) as string | undefined,
        }
      });

      emitNotification(socialAccount.userId.toString(), {
        provider: socialAccount.provider,
        title: notification.title,
        createdAt: notification.created_at
      });
    }

    res.status(200).json({ status: true });
  } catch (error) {
    console.error('[Unipile Webhook] Error:', error);
    res.status(200).json({ status: true });
  }
};
