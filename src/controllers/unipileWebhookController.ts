import { Request, Response } from 'express';
import crypto from 'crypto';
import config from '../config';
import { SocialAccount } from '../models/SocialAccount';
import { Notification } from '../models/Notification';
import { emitNotification } from '../services/socketService';

const validateWebhook = (req: Request): boolean => {
  const signature = req.headers['x-unipile-signature'] as string;
  if (!signature || !config.UNIPILE_WEBHOOK_SECRET) return false;

  const rawBody = (req as unknown as Record<string, unknown>).rawBody as string | undefined;
  if (!rawBody) return false;

  const expected = crypto
    .createHmac('sha256', config.UNIPILE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

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

export const handleUnipileWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('WEBHOOK HIT');
    console.log(JSON.stringify(req.body, null, 2));

    if (!validateWebhook(req)) {
      console.warn('[Unipile Webhook] Invalid signature');
      res.status(200).json({ status: true });
      return;
    }

    const event = req.body;

    console.log(`[Unipile Webhook] Event type received: "${event.type}"`);

    if (event.type === 'account.created' || event.type === 'account.connected') {
      const accountId = event.account_id || event.id;
      const unipileProvider = event.provider;
      const userId = event.name;

      console.log('[Unipile Webhook] account event fields:', {
        accountId,
        provider: unipileProvider,
        userId,
        hasAccountId: !!accountId,
        hasProvider: !!unipileProvider,
        hasUserId: !!userId
      });

      if (!accountId || !userId) {
        console.warn('[Unipile Webhook] Missing accountId or userId in account event — cannot create SocialAccount');
        res.status(200).json({ status: true });
        return;
      }

      if (!unipileProvider) {
        console.warn('[Unipile Webhook] Missing provider in account event — cannot create SocialAccount');
        res.status(200).json({ status: true });
        return;
      }

      const provider = providerFromUnipile(unipileProvider);

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

      console.log(`[Unipile Webhook] SocialAccount saved: ${provider} / ${accountId} for user ${userId}`);
    }

    if (event.type === 'message.received' || event.type === 'new_message') {
      const accountId = event.account_id || event.accountId;

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

      const notification = await Notification.create({
        userId: socialAccount.userId,
        provider: socialAccount.provider,
        type: 'new_message',
        title: `New ${providerLabel[socialAccount.provider] || socialAccount.provider} Message`,
        metadata: {
          sender: event.sender_name || event.from || event.sender || 'Unknown',
          accountId
        }
      });

      emitNotification(socialAccount.userId.toString(), {
        provider: socialAccount.provider,
        title: notification.title,
        createdAt: notification.created_at
      });
    }

    if (event.type !== 'account.created' && event.type !== 'account.connected' &&
        event.type !== 'message.received' && event.type !== 'new_message') {
      console.log(`[Unipile Webhook] Unhandled event type: "${event.type}"`);
    }

    res.status(200).json({ status: true });
  } catch (error) {
    console.error('[Unipile Webhook] Error:', error);
    res.status(200).json({ status: true });
  }
};
