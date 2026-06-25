import { Request, Response } from 'express';
import { AuthRequest } from '../types';
import { SocialAccount } from '../models/SocialAccount';
import { generateConnectUrl, disconnectAccount } from '../services/unipileService';
import config from '../config';

type SocialProvider = 'whatsapp' | 'instagram' | 'facebook_messenger';

const PROVIDERS: SocialProvider[] = ['whatsapp', 'instagram', 'facebook_messenger'];

export const listSocialAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: false, message: 'Authentication required' });
      return;
    }

    const accounts = await SocialAccount.find({ userId }).sort({ connectedAt: -1 }).lean();

    res.json({
      status: true,
      message: 'Social accounts retrieved successfully',
      data: accounts
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch social accounts' });
  }
};

export const connectSocialAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: false, message: 'Authentication required' });
      return;
    }

    const { provider } = req.params;

    if (!PROVIDERS.includes(provider as SocialProvider)) {
      res.status(400).json({
        status: false,
        message: `Invalid provider. Must be one of: ${PROVIDERS.join(', ')}`
      });
      return;
    }

    const backendUrl = config.BACKEND_URL || `http://localhost:${config.PORT}`;
    const frontendUrl = config.FRONTEND_URL || 'http://localhost:3000';
    const successRedirectUrl = `${backendUrl}/api/v1/social-accounts/callback`;
    const failureRedirectUrl = `${frontendUrl}/social/connect/callback?error=true`;
    const notifyUrl = `${backendUrl}/api/webhooks/unipile`;

    console.log('[connectSocialAccount] URLs:', {
      backendUrl,
      successRedirectUrl,
      failureRedirectUrl,
      notifyUrl,
      provider,
      userId
    });

    const result = await generateConnectUrl(
      provider as SocialProvider,
      successRedirectUrl,
      failureRedirectUrl,
      notifyUrl,
      userId
    );

    res.json({
      status: true,
      message: 'Connect URL generated successfully',
      data: { url: result.url }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: error instanceof Error ? error.message : 'Failed to generate connect URL'
    });
  }
};

export const handleConnectCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('CALLBACK HIT');
    console.log(req.query);

    const errorType = req.query.error_type as string;
    const frontendUrl = config.FRONTEND_URL || 'http://localhost:3000';

    if (errorType) {
      res.redirect(`${frontendUrl}/social/connect/callback?error=${errorType}`);
      return;
    }

    res.redirect(`${frontendUrl}/social/connect/callback?success=true`);
  } catch (error) {
    const frontendUrl = config.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/social/connect/callback?error=callback_failed`);
  }
};

export const disconnectSocialAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: false, message: 'Authentication required' });
      return;
    }

    const accountId = req.params.accountId as string;

    const account = await SocialAccount.findOne({ accountId, userId });
    if (!account) {
      res.status(404).json({ status: false, message: 'Social account not found' });
      return;
    }

    try {
      await disconnectAccount(accountId);
    } catch {
      // proceed with local deletion even if remote fails
    }

    await SocialAccount.deleteOne({ _id: account._id });

    res.json({
      status: true,
      message: 'Social account disconnected successfully'
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to disconnect social account' });
  }
};
