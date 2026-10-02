import { google } from 'googleapis';
import config from '../config';

export const GOOGLE_ADS_SCOPES = ['https://www.googleapis.com/auth/adwords'];

const API_BASE = 'https://googleads.googleapis.com';

export const getGoogleAdsRedirectUri = (): string | undefined =>
  config.GOOGLE_ADS_REDIRECT_URI ||
  (config.BACKEND_URL
    ? `${config.BACKEND_URL.replace(/\/$/, '')}/api/v1/integrations/google-ads/callback`
    : undefined);

/**
 * Google sunset developer tokens on 2026-09-09: API access is now granted to the
 * Google Cloud project that owns the OAuth client, so only OAuth config is required.
 */
export const isGoogleAdsConfigured = (): boolean =>
  Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && getGoogleAdsRedirectUri());

export const getGoogleAdsOAuth2Client = (): any =>
  new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, getGoogleAdsRedirectUri());

/** Google Ads customer IDs are 10 digits; users often paste them as 123-456-7890 */
export const normalizeCustomerId = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/-/g, '').trim();
  return /^\d{10}$/.test(digits) ? digits : null;
};

/**
 * Error from the Google Ads API. `reauthRequired` means the refresh token was
 * revoked or expired and the org must reconnect.
 */
export class GoogleAdsApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly reauthRequired = false
  ) {
    super(message);
    this.name = 'GoogleAdsApiError';
  }
}

export const getAccessToken = async (refreshToken: string): Promise<string> => {
  const client = getGoogleAdsOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new GoogleAdsApiError('Google returned no access token', 401, true);
    return token;
  } catch (error: any) {
    if (error instanceof GoogleAdsApiError) throw error;
    const googleError = error?.response?.data?.error || error?.message;
    throw new GoogleAdsApiError(
      `Failed to refresh Google Ads token: ${googleError}`,
      error?.response?.status || 401,
      googleError === 'invalid_grant'
    );
  }
};

type RequestOptions = {
  accessToken: string;
  loginCustomerId?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
};

const googleAdsRequest = async <T>(path: string, options: RequestOptions): Promise<T> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    'Content-Type': 'application/json'
  };
  // Optional and ignored by Google since the 2026 developer-token sunset; sent only if set
  if (config.GOOGLE_ADS_DEVELOPER_TOKEN) headers['developer-token'] = config.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (options.loginCustomerId) headers['login-customer-id'] = options.loginCustomerId;

  const response = await fetch(`${API_BASE}/${config.GOOGLE_ADS_API_VERSION}/${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    // searchStream wraps errors in an array
    const error = Array.isArray(data) ? data[0]?.error : data?.error;
    const message = error?.details?.[0]?.errors?.[0]?.message || error?.message || `HTTP ${response.status}`;
    throw new GoogleAdsApiError(`Google Ads API error: ${message}`, response.status, response.status === 401);
  }

  return data as T;
};

/** Run a GAQL query via searchStream and flatten all result batches */
export const searchStream = async (
  accessToken: string,
  customerId: string,
  query: string,
  loginCustomerId?: string
): Promise<any[]> => {
  const batches = await googleAdsRequest<Array<{ results?: any[] }>>(
    `customers/${customerId}/googleAds:searchStream`,
    { accessToken, loginCustomerId, method: 'POST', body: { query } }
  );
  return (Array.isArray(batches) ? batches : []).flatMap((batch) => batch.results ?? []);
};

export interface GoogleAdsAccount {
  customer_id: string;
  name: string;
  currency: string;
  login_customer_id: string;
}

/**
 * List the ad accounts the authorizing Google user can report on. Manager (MCC)
 * accounts are expanded one level so agencies can pick a client account.
 */
export const listSelectableAccounts = async (accessToken: string): Promise<GoogleAdsAccount[]> => {
  const { resourceNames = [] } = await googleAdsRequest<{ resourceNames?: string[] }>(
    'customers:listAccessibleCustomers',
    { accessToken }
  );

  const accounts = new Map<string, GoogleAdsAccount>();
  for (const resourceName of resourceNames.slice(0, 50)) {
    const rootId = resourceName.replace('customers/', '');
    try {
      const rows = await searchStream(
        accessToken,
        rootId,
        `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
                customer_client.manager, customer_client.status
         FROM customer_client
         WHERE customer_client.level <= 1 AND customer_client.status = 'ENABLED'`,
        rootId
      );
      for (const row of rows) {
        const client = row.customerClient;
        if (!client || client.manager) continue;
        const id = String(client.id);
        if (accounts.has(id)) continue;
        accounts.set(id, {
          customer_id: id,
          name: client.descriptiveName || id,
          currency: client.currencyCode || 'USD',
          login_customer_id: rootId
        });
      }
    } catch {
      // Cancelled or suspended accounts reject queries — they are not selectable
    }
  }

  return [...accounts.values()];
};

export interface GoogleAdsDailySpendRow {
  external_campaign_id: string;
  name: string;
  channel_type?: string;
  stat_date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Campaign-level daily spend. Campaign level is the only level that covers every
 * campaign type (Performance Max and Smart campaigns have no ad-group metrics),
 * so totals always match the Google Ads UI.
 */
export const fetchDailyCampaignSpend = async (
  accessToken: string,
  customerId: string,
  from: string,
  to: string,
  loginCustomerId?: string
): Promise<GoogleAdsDailySpendRow[]> => {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw new Error('from/to must be YYYY-MM-DD');
  }

  const rows = await searchStream(
    accessToken,
    customerId,
    `SELECT customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type,
            segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM campaign
     WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    loginCustomerId
  );

  return rows.map((row) => ({
    external_campaign_id: String(row.campaign?.id),
    name: row.campaign?.name || '',
    channel_type: row.campaign?.advertisingChannelType,
    stat_date: row.segments?.date,
    spend: Number(row.metrics?.costMicros ?? 0) / 1_000_000,
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
    currency: row.customer?.currencyCode || 'USD'
  }));
};
