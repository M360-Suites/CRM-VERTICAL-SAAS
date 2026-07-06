import { Response } from 'express';
import { AuthRequest } from '../types';
import { User } from '../models/User';
import { SocialAccount } from '../models/SocialAccount';
import { EmailMessage } from '../models/EmailMessage';
import { requireOrganization } from '../utils/tenant';

const PROVIDER_MAP: Record<string, string> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  facebook_messenger: 'facebook'
};

export const getConnectionStatuses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const userId = req.user?.id;

    const user = await User.findOne({ _id: userId, organization_id: organizationId })
      .select('gmail_sync_enabled last_gmail_sync_at google_access_token updated_at');

    if (!user) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const socialAccounts = await SocialAccount.find({ userId }).sort({ connectedAt: -1 }).lean();

    const socialStatuses: Record<string, { connected: boolean; accountId?: string; status?: string; connectedAt?: Date }> = {};
    for (const provider of ['whatsapp', 'instagram', 'facebook_messenger'] as const) {
      const account = socialAccounts.find(a => a.provider === provider);
      const displayName = PROVIDER_MAP[provider];
      if (account && account.status === 'connected') {
        socialStatuses[displayName] = {
          connected: true,
          accountId: account.accountId,
          status: account.status,
          connectedAt: account.connectedAt
        };
      } else {
        socialStatuses[displayName] = {
          connected: false,
          status: account?.status || 'disconnected'
        };
      }
    }

    const totalMessages = await EmailMessage.countDocuments({ user_id: user._id, organization_id: organizationId });

    res.json({
      status: true,
      data: {
        gmail: {
          connected: !!user.google_access_token,
          gmail_sync_enabled: user.gmail_sync_enabled,
          last_sync_at: user.last_gmail_sync_at,
          synced_count: totalMessages
        },
        ...socialStatuses
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to get connection statuses' });
  }
};
