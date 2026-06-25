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

    if (event.event === 'message_received') {
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

    res.status(200).json({ status: true });
  } catch (error) {
    console.error('[Unipile Webhook] Error:', error);
    res.status(200).json({ status: true });
  }
};
