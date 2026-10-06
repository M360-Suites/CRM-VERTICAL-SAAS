import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import config from '../config';
import { AuthRequest } from '../types';
import { AdConnector } from '../models/AdConnector';
import { User } from '../models/User';
import { requireOrganization } from '../utils/tenant';
import { encryptString, decryptString } from '../utils/crypto';
import { getFrontendUrl } from '../utils/frontend';
import {
  GOOGLE_ADS_SCOPES,
  GoogleAdsApiError,
  getAccessToken,
  getGoogleAdsOAuth2Client,
  isGoogleAdsConfigured,
  listSelectableAccounts,
  normalizeCustomerId
} from '../utils/googleAds';
import { syncGoogleAdsConnector } from '../services/googleAdsSyncService';
import { logger } from '../config/logger';

const STATE_PURPOSE = 'google_ads_oauth';
const MANAGER_ROLES = ['admin', 'sales_manager'];

type OAuthState = { uid: string; org: string; purpose: string };

/** Signed, short-lived OAuth state so the callback can't be forged for another org */
export const signOAuthState = (userId: string, organizationId: string): string =>
  jwt.sign({ uid: userId, org: organizationId, purpose: STATE_PURPOSE }, config.JWT_SECRET, { expiresIn: '10m' });

export const verifyOAuthState = (state: unknown): OAuthState | null => {
  if (typeof state !== 'string' || !state) return null;
  try {
    const decoded = jwt.verify(state, config.JWT_SECRET) as OAuthState;
    return decoded.purpose === STATE_PURPOSE && decoded.uid && decoded.org ? decoded : null;
  } catch {
    return null;
  }
};

const redirectToFrontend = (res: Response, params: Record<string, string>): void => {
  const url = new URL('/settings/integrations', getFrontendUrl());
  url.search = new URLSearchParams({ provider: 'google_ads', ...params }).toString();
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(url.toString());
};

const notConfigured = (res: Response): void => {
  res.status(503).json({ status: false, message: 'Google Ads integration is not configured' });
};

const serializeConnector = (connector: any) => ({
  connected: connector?.status === 'connected',
  status: connector?.status ?? 'disconnected',
  account_id: connector?.external_account_id ?? null,
  account_name: connector?.account_name ?? null,
  currency: connector?.currency ?? null,
  last_synced_at: connector?.last_synced_at ?? null,
  last_sync_error: connector?.last_sync_error ?? null
});

/**
 * GET /integrations/google-ads/auth
 * Returns the Google consent URL for the current org
 */
export const getGoogleAdsAuthUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    if (!isGoogleAdsConfigured()) return notConfigured(res);

    const url = getGoogleAdsOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_ADS_SCOPES,
      state: signOAuthState(req.user!.id, organizationId.toString())
    });

    res.json({ status: true, data: { url } });
  } catch (error) {
    logger.error({ err: error }, 'Failed to generate Google Ads auth URL');
    res.status(500).json({ status: false, message: 'Failed to generate auth URL' });
  }
};

/**
 * GET /integrations/google-ads/callback
 * Google redirects here. Stores the refresh token as a pending connector, then
 * sends the user back to the frontend to pick an ad account.
 */
export const handleGoogleAdsCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) return redirectToFrontend(res, { error: 'access_denied' });
    if (!isGoogleAdsConfigured()) return redirectToFrontend(res, { error: 'not_configured' });

    const decoded = verifyOAuthState(state);
    if (!decoded) return redirectToFrontend(res, { error: 'invalid_state' });
    if (!code || typeof code !== 'string') return redirectToFrontend(res, { error: 'missing_code' });

    const user = await User.findOne({
      _id: decoded.uid,
      organization_id: decoded.org,
      is_active: true,
      role: { $in: MANAGER_ROLES }
    }).select('_id');
    if (!user) return redirectToFrontend(res, { error: 'unauthorized' });

    const { tokens } = await getGoogleAdsOAuth2Client().getToken(code);
    if (!tokens.refresh_token) return redirectToFrontend(res, { error: 'no_refresh_token' });

    const organizationId = new mongoose.Types.ObjectId(decoded.org);
    const connector = await AdConnector.findOneAndUpdate(
      { organization_id: organizationId, platform: 'google_ads' },
      {
        $set: {
          status: 'pending',
          refresh_token: encryptString(tokens.refresh_token),
          connected_by: user._id
        },
        $setOnInsert: { display_name: 'Google Ads' },
        $unset: {
          external_account_id: 1,
          account_name: 1,
          currency: 1,
          login_customer_id: 1,
          last_sync_error: 1,
          sync_lock_until: 1
        }
      },
      { upsert: true, new: true }
    );

    redirectToFrontend(res, { step: 'select_account' });
  } catch (error) {
    logger.error({ err: error }, 'Google Ads OAuth callback failed');
    redirectToFrontend(res, { error: 'callback_failed' });
  }
};

/**
 * GET /integrations/google-ads/status
 */
export const getGoogleAdsStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const connector = await AdConnector.findOne({ organization_id: organizationId, platform: 'google_ads' }).lean();
    res.json({
      status: true,
      data: { configured: isGoogleAdsConfigured(), ...serializeConnector(connector) }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to get Google Ads status' });
  }
};

const loadAuthorizedConnector = async (organizationId: mongoose.Types.ObjectId) =>
  AdConnector.findOne({
    organization_id: organizationId,
    platform: 'google_ads',
    status: { $in: ['pending', 'connected', 'error'] }
  }).select('+refresh_token');

/**
 * GET /integrations/google-ads/accounts
 * Ad accounts the authorizing Google user can access
 */
export const listGoogleAdsAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    if (!isGoogleAdsConfigured()) return notConfigured(res);

    const connector = await loadAuthorizedConnector(organizationId);
    const refreshToken = decryptString(connector?.refresh_token);
    if (!connector || !refreshToken) {
      res.status(404).json({ status: false, message: 'Connect Google Ads first' });
      return;
    }

    const accounts = await listSelectableAccounts(await getAccessToken(refreshToken));
    res.json({ status: true, data: accounts });
  } catch (error) {
    if (error instanceof GoogleAdsApiError && error.reauthRequired) {
      res.status(409).json({ status: false, message: 'Google Ads authorization expired. Reconnect Google Ads.' });
      return;
    }
    logger.error({ err: error }, 'Failed to list Google Ads accounts');
    res.status(502).json({ status: false, message: 'Failed to load Google Ads accounts' });
  }
};

/**
 * POST /integrations/google-ads/accounts/select
 * Body: { customer_id }
 * Binds the connector to one ad account and starts the initial backfill.
 */
export const selectGoogleAdsAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    if (!isGoogleAdsConfigured()) return notConfigured(res);

    const customerId = normalizeCustomerId(req.body?.customer_id);
    if (!customerId) {
      res.status(400).json({ status: false, message: 'customer_id must be a 10-digit Google Ads customer ID' });
      return;
    }

    const connector = await loadAuthorizedConnector(organizationId);
    const refreshToken = decryptString(connector?.refresh_token);
    if (!connector || !refreshToken) {
      res.status(404).json({ status: false, message: 'Connect Google Ads first' });
      return;
    }

    // Only accept an account this Google user can actually access
    const accounts = await listSelectableAccounts(await getAccessToken(refreshToken));
    const account = accounts.find((candidate) => candidate.customer_id === customerId);
    if (!account) {
      res.status(403).json({ status: false, message: 'This Google login has no access to that ad account' });
      return;
    }

    connector.status = 'connected';
    connector.external_account_id = account.customer_id;
    connector.account_name = account.name;
    connector.currency = account.currency;
    connector.login_customer_id = account.login_customer_id;
    connector.last_synced_at = undefined;
    connector.last_sync_error = undefined;
    await connector.save();

    // Initial backfill runs in the background; the scheduler keeps it fresh afterwards
    void syncGoogleAdsConnector(connector._id as mongoose.Types.ObjectId, { actorId: req.user?.id }).catch((error) =>
      logger.warn({ err: error, connectorId: connector._id }, 'Initial Google Ads backfill failed')
    );

    res.json({ status: true, message: 'Google Ads account connected', data: serializeConnector(connector) });
  } catch (error) {
    if (error instanceof GoogleAdsApiError && error.reauthRequired) {
      res.status(409).json({ status: false, message: 'Google Ads authorization expired. Reconnect Google Ads.' });
      return;
    }
    logger.error({ err: error }, 'Failed to select Google Ads account');
    res.status(500).json({ status: false, message: 'Failed to connect Google Ads account' });
  }
};

/**
 * POST /integrations/google-ads/sync
 * Body: { days?: number } — manual re-sync of the last N days (max 90)
 */
export const syncGoogleAdsNow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const connector = await AdConnector.findOne({
      organization_id: organizationId,
      platform: 'google_ads',
      status: { $in: ['connected', 'error'] },
      external_account_id: { $exists: true }
    }).select('_id');
    if (!connector) {
      res.status(404).json({ status: false, message: 'No Google Ads account connected' });
      return;
    }

    const requestedDays = Number(req.body?.days);
    const days = Number.isInteger(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, 90) : undefined;

    const result = await syncGoogleAdsConnector(connector._id as mongoose.Types.ObjectId, {
      days,
      actorId: req.user?.id
    });
    res.json({ status: true, message: 'Google Ads spend synced', data: result });
  } catch (error) {
    if (error instanceof GoogleAdsApiError) {
      res.status(error.reauthRequired ? 409 : 502).json({
        status: false,
        message: error.reauthRequired ? 'Google Ads authorization expired. Reconnect Google Ads.' : error.message
      });
      return;
    }
    if ((error as Error).message?.includes('already running')) {
      res.status(409).json({ status: false, message: 'A sync is already running' });
      return;
    }
    logger.error({ err: error }, 'Manual Google Ads sync failed');
    res.status(500).json({ status: false, message: 'Failed to sync Google Ads' });
  }
};

/**
 * DELETE /integrations/google-ads
 * Revokes the token and removes credentials. Historical spend rows are kept.
 */
export const disconnectGoogleAds = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const connector = await AdConnector.findOne({ organization_id: organizationId, platform: 'google_ads' }).select(
      '+refresh_token'
    );
    if (!connector) {
      res.status(404).json({ status: false, message: 'Google Ads is not connected' });
      return;
    }

    const refreshToken = decryptString(connector.refresh_token);
    if (refreshToken && isGoogleAdsConfigured()) {
      try {
        await getGoogleAdsOAuth2Client().revokeToken(refreshToken);
      } catch (error) {
        logger.warn({ err: error }, 'Failed to revoke Google Ads token');
      }
    }

    connector.status = 'disconnected';
    connector.refresh_token = undefined;
    connector.sync_lock_until = undefined;
    await connector.save();

    res.json({ status: true, message: 'Google Ads disconnected' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to disconnect Google Ads');
    res.status(500).json({ status: false, message: 'Failed to disconnect Google Ads' });
  }
};
