import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    JWT_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
    GOOGLE_ADS_REDIRECT_URI: 'http://localhost:4000/api/v1/integrations/google-ads/callback',
    GOOGLE_ADS_API_VERSION: 'v25',
    FRONTEND_URL: 'http://app.test'
  }
}));

jest.mock('../src/middleware/auth', () => {
  const { mockAuthentication } = require('./helpers/featureRouteHarness');
  return mockAuthentication();
});

import {
  GoogleAdsApiError,
  fetchDailyCampaignSpend,
  normalizeCustomerId
} from '../src/utils/googleAds';
import { buildSpendUpserts, getSyncWindow } from '../src/services/googleAdsSyncService';
import { signOAuthState, verifyOAuthState } from '../src/controllers/googleAdsController';
import googleAdsRoutes from '../src/routes/googleAdsRoutes';
import { authenticated, createApp } from './helpers/featureRouteHarness';

const mockFetchResponse = (status: number, body: unknown) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  } as Response);

describe('normalizeCustomerId', () => {
  it('accepts dashed and plain 10-digit IDs', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeCustomerId('1234567890')).toBe('1234567890');
  });

  it('rejects anything else', () => {
    expect(normalizeCustomerId('12345')).toBeNull();
    expect(normalizeCustomerId('abc-def-ghij')).toBeNull();
    expect(normalizeCustomerId(undefined)).toBeNull();
  });
});

describe('fetchDailyCampaignSpend', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps searchStream batches to spend rows and converts micros', async () => {
    const fetchSpy = mockFetchResponse(200, [
      {
        results: [
          {
            customer: { currencyCode: 'EUR' },
            campaign: { id: '111', name: 'Brand', advertisingChannelType: 'SEARCH' },
            segments: { date: '2026-09-01' },
            metrics: { costMicros: '12345678', impressions: '1000', clicks: '50', conversions: 2.5 }
          }
        ]
      },
      {
        results: [
          {
            customer: { currencyCode: 'EUR' },
            campaign: { id: '222', name: 'PMax', advertisingChannelType: 'PERFORMANCE_MAX' },
            segments: { date: '2026-09-01' },
            metrics: { costMicros: '1000000', impressions: '10', clicks: '1' }
          }
        ]
      }
    ]);

    const rows = await fetchDailyCampaignSpend('token', '1234567890', '2026-09-01', '2026-09-02', '9999999999');

    expect(rows).toEqual([
      {
        external_campaign_id: '111',
        name: 'Brand',
        channel_type: 'SEARCH',
        stat_date: '2026-09-01',
        spend: 12.345678,
        impressions: 1000,
        clicks: 50,
        conversions: 2.5,
        currency: 'EUR'
      },
      expect.objectContaining({ external_campaign_id: '222', spend: 1, conversions: 0 })
    ]);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['developer-token']).toBe('dev-token');
    expect(headers['login-customer-id']).toBe('9999999999');
    expect(JSON.parse((init as RequestInit).body as string).query).toContain("BETWEEN '2026-09-01' AND '2026-09-02'");
  });

  it('rejects malformed dates before calling Google (no GAQL injection)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(
      fetchDailyCampaignSpend('token', '1234567890', "2026-09-01' OR '1'='1", '2026-09-02')
    ).rejects.toThrow('YYYY-MM-DD');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces Google Ads API errors, flagging 401 as reauth required', async () => {
    mockFetchResponse(401, [{ error: { code: 401, message: 'Request had invalid authentication credentials.' } }]);

    const error = await fetchDailyCampaignSpend('token', '1234567890', '2026-09-01', '2026-09-02').catch((e) => e);
    expect(error).toBeInstanceOf(GoogleAdsApiError);
    expect(error.reauthRequired).toBe(true);
    expect(error.message).toContain('invalid authentication credentials');
  });
});

describe('buildSpendUpserts (idempotency)', () => {
  const organizationId = new mongoose.Types.ObjectId();
  const connectorId = new mongoose.Types.ObjectId();
  const rows = [
    {
      external_campaign_id: '111',
      name: 'Brand',
      stat_date: '2026-09-01',
      spend: 10,
      impressions: 100,
      clicks: 5,
      conversions: 1,
      currency: 'USD'
    }
  ];

  it('filters on exactly the unique index fields and upserts', () => {
    const [op] = buildSpendUpserts(organizationId, connectorId, rows);
    expect(Object.keys(op.updateOne.filter).sort()).toEqual(
      ['adset_id', 'creative_id', 'external_campaign_id', 'organization_id', 'platform', 'stat_date'].sort()
    );
    expect(op.updateOne.upsert).toBe(true);
    expect(op.updateOne.update.$set).not.toHaveProperty('organization_id');
  });

  it('produces identical filters when the same rows are synced twice', () => {
    const first = buildSpendUpserts(organizationId, connectorId, rows, new Date('2026-09-02'));
    const second = buildSpendUpserts(organizationId, connectorId, rows, new Date('2026-09-03'));
    expect(second.map((op) => op.updateOne.filter)).toEqual(first.map((op) => op.updateOne.filter));
  });

  it('scopes rows to the organization so tenants never overwrite each other', () => {
    const otherOrg = new mongoose.Types.ObjectId();
    const [a] = buildSpendUpserts(organizationId, connectorId, rows);
    const [b] = buildSpendUpserts(otherOrg, connectorId, rows);
    expect(a.updateOne.filter.organization_id).not.toEqual(b.updateOne.filter.organization_id);
  });
});

describe('getSyncWindow', () => {
  it('covers the lookback plus a day of timezone slack on each side', () => {
    expect(getSyncWindow(7, new Date('2026-10-02T12:00:00Z'))).toEqual({ from: '2026-09-25', to: '2026-10-03' });
  });
});

describe('OAuth state', () => {
  it('round-trips a signed state', () => {
    const state = signOAuthState('user-1', 'org-1');
    expect(verifyOAuthState(state)).toMatchObject({ uid: 'user-1', org: 'org-1' });
  });

  it('rejects unsigned or tampered state', () => {
    expect(verifyOAuthState('user-1:org-1')).toBeNull();
    expect(verifyOAuthState(signOAuthState('user-1', 'org-1') + 'x')).toBeNull();
    expect(verifyOAuthState(undefined)).toBeNull();
  });
});

describe('google ads routes', () => {
  const app = createApp('/integrations/google-ads', googleAdsRoutes);

  it('redirects the callback with invalid_state when state is forged', async () => {
    const response = await request(app).get('/integrations/google-ads/callback?code=abc&state=user-1:org-1');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      'http://app.test/settings/integrations?provider=google_ads&error=invalid_state'
    );
  });

  it('redirects with access_denied when the user cancels consent', async () => {
    const response = await request(app).get('/integrations/google-ads/callback?error=access_denied');
    expect(response.headers.location).toContain('error=access_denied');
  });

  it('requires authentication for status', async () => {
    const response = await request(app).get('/integrations/google-ads/status');
    expect(response.status).toBe(401);
  });

  it('blocks sales reps from starting OAuth', async () => {
    const response = await authenticated(request(app).get('/integrations/google-ads/auth')).set(
      'x-test-role',
      'sales_rep'
    );
    expect(response.status).toBe(403);
  });

  it('only lets admins disconnect', async () => {
    const response = await authenticated(request(app).delete('/integrations/google-ads')).set(
      'x-test-role',
      'sales_manager'
    );
    expect(response.status).toBe(403);
  });
});
