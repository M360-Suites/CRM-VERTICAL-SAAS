import request from 'supertest';

jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test-secret', GROQ_MODEL: 'test-model' } }));

jest.mock('../src/middleware/auth', () => {
  const { mockAuthentication } = require('./helpers/featureRouteHarness');
  return mockAuthentication();
});

jest.mock('../src/services/revopsDefaults', () => ({ ensureRevopsDefaults: jest.fn() }));

jest.mock('../src/controllers/revopsController', () => {
  const { mockControllerStub } = require('./helpers/featureRouteHarness');
  return Object.fromEntries(
    [
      'createTouchpoint',
      'deleteCampaignRow',
      'getAttribution',
      'getCosts',
      'getOverview',
      'getWarehouse',
      'listCampaignRows',
      'listConnectors',
      'listTargets',
      'logCampaignSpend',
      'updateConnectorStatus',
      'updateTarget'
    ].map((name) => [name, mockControllerStub(name)])
  );
});

jest.mock('../src/controllers/routingController', () => {
  const { mockControllerStub } = require('./helpers/featureRouteHarness');
  return Object.fromEntries(
    ['createRule', 'deleteRule', 'listReps', 'listRoutedLeads', 'listRules', 'simulateRouting', 'updateRule'].map(
      (name) => [name, mockControllerStub(name)]
    )
  );
});

jest.mock('../src/controllers/nurtureController', () => {
  const { mockControllerStub } = require('./helpers/featureRouteHarness');
  return Object.fromEntries(
    [
      'createTemplate',
      'deleteTemplate',
      'editDraft',
      'generateDraft',
      'listDrafts',
      'listTemplates',
      'updateDraftStatus',
      'updateTemplate'
    ].map((name) => [name, mockControllerStub(name)])
  );
});

import revopsRoutes from '../src/routes/revopsRoutes';
import { authenticated, createApp } from './helpers/featureRouteHarness';
import { detectPlatform, matchRoutingRule, scoreIntent } from '../src/services/leadRoutingService';
import { fillTemplate } from '../src/services/nurtureService';
import { parseAdSpendEvent } from '../src/controllers/publicIngestController';

const app = createApp('/revops', revopsRoutes);
const as = (role: string, test: request.Test) => authenticated(test).set('x-test-role', role);

describe('revops routes — every tab is reachable and role-gated', () => {
  it.each([
    ['get', '/revops/overview', 'getOverview'],
    ['get', '/revops/connectors', 'listConnectors'],
    ['get', '/revops/attribution', 'getAttribution'],
    ['get', '/revops/costs', 'getCosts'],
    ['get', '/revops/campaigns', 'listCampaignRows'],
    ['get', '/revops/routing-rules', 'listRules'],
    ['post', '/revops/routing-rules/simulate', 'simulateRouting'],
    ['get', '/revops/routed-leads', 'listRoutedLeads'],
    ['get', '/revops/drafts', 'listDrafts'],
    ['get', '/revops/templates', 'listTemplates'],
    ['get', '/revops/warehouse', 'getWarehouse'],
    ['get', '/revops/targets', 'listTargets']
  ] as const)('viewers can read %s %s', async (method, path, handler) => {
    const response = await as('viewer', request(app)[method](path));
    expect(response.status).toBeLessThan(300);
    expect(response.body.handler).toBe(handler);
  });

  it.each([
    ['post', '/revops/campaigns'],
    ['delete', '/revops/campaigns/abc'],
    ['patch', '/revops/connectors/abc/status'],
    ['post', '/revops/routing-rules'],
    ['patch', '/revops/routing-rules/abc'],
    ['delete', '/revops/routing-rules/abc'],
    ['post', '/revops/templates'],
    ['patch', '/revops/templates/abc'],
    ['delete', '/revops/templates/abc'],
    ['put', '/revops/targets/revenue']
  ] as const)('sales reps cannot configure the engine: %s %s', async (method, path) => {
    const response = await as('sales_rep', request(app)[method](path));
    expect(response.status).toBe(403);
  });

  it.each([
    ['post', '/revops/drafts/generate', 'generateDraft'],
    ['patch', '/revops/drafts/abc', 'editDraft'],
    ['patch', '/revops/drafts/abc/status', 'updateDraftStatus'],
    ['post', '/revops/touchpoints', 'createTouchpoint']
  ] as const)('sales reps can work drafts and touchpoints: %s %s', async (method, path, handler) => {
    const response = await as('sales_rep', request(app)[method](path));
    expect(response.status).toBeLessThan(300);
    expect(response.body.handler).toBe(handler);
  });

  it('viewers cannot generate or approve drafts', async () => {
    expect((await as('viewer', request(app).post('/revops/drafts/generate'))).status).toBe(403);
    expect((await as('viewer', request(app).patch('/revops/drafts/abc/status'))).status).toBe(403);
  });

  it('managers can configure the engine', async () => {
    const response = await as('sales_manager', request(app).post('/revops/routing-rules'));
    expect(response.body.handler).toBe('createRule');
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/revops/overview')).status).toBe(401);
  });
});

describe('scoreIntent', () => {
  it('uses an explicit score, clamped to 0-100', () => {
    expect(scoreIntent({ intent_score: 72 })).toBe(72);
    expect(scoreIntent({ intent_score: '88' })).toBe(88);
    expect(scoreIntent({ intent_score: 150 })).toBe(100);
    expect(scoreIntent({ intent_score: -5 })).toBe(0);
  });

  it('falls back to temperature, then 50', () => {
    expect(scoreIntent({ temperature: 'hot' })).toBe(80);
    expect(scoreIntent({ temperature: 'cold' })).toBe(25);
    expect(scoreIntent({})).toBe(50);
    expect(scoreIntent({ intent_score: 'abc', temperature: 'hot' })).toBe(80);
  });
});

describe('detectPlatform', () => {
  it('honors an explicit known platform', () => {
    expect(detectPlatform({ platform: 'linkedin' })).toBe('linkedin');
  });

  it('uses click IDs', () => {
    expect(detectPlatform({ gclid: 'abc' })).toBe('google_ads');
    expect(detectPlatform({ fbclid: 'abc' })).toBe('meta');
    expect(detectPlatform({ ttclid: 'abc' })).toBe('tiktok');
  });

  it('separates paid from organic Google traffic', () => {
    expect(detectPlatform({ utm_source: 'google', utm_medium: 'cpc' })).toBe('google_ads');
    expect(detectPlatform({ utm_source: 'google', utm_medium: 'organic' })).toBe('seo');
  });

  it('defaults to web_form', () => {
    expect(detectPlatform({})).toBe('web_form');
    expect(detectPlatform({ platform: 'myspace' })).toBe('web_form');
  });
});

describe('matchRoutingRule', () => {
  const rules = [
    { _id: 'catch-all', name: 'Catch all', priority: 999, is_active: true, min_intent_score: 0 },
    { _id: 'emea-ent', name: 'EMEA enterprise', priority: 10, region: 'EMEA', tier: 'Enterprise', is_active: true, min_intent_score: 60 },
    { _id: 'paused', name: 'Paused', priority: 1, is_active: false, min_intent_score: 0 },
    { _id: 'google-hot', name: 'Google hot', priority: 20, platform: 'google_ads', is_active: true, min_intent_score: 75 }
  ];

  it('picks the lowest priority full match, case-insensitively', () => {
    expect(matchRoutingRule(rules, { region: 'emea', tier: 'enterprise', intent_score: 70 })?._id).toBe('emea-ent');
  });

  it('skips paused rules and rules whose minimum score is not met', () => {
    expect(matchRoutingRule(rules, { region: 'EMEA', tier: 'Enterprise', intent_score: 40 })?._id).toBe('catch-all');
  });

  it('requires a platform match when the rule sets one', () => {
    expect(matchRoutingRule(rules, { platform: 'google_ads', intent_score: 80 })?._id).toBe('google-hot');
    expect(matchRoutingRule(rules, { platform: 'meta', intent_score: 80 })?._id).toBe('catch-all');
  });

  it('a rule with a region does not match a lead without one', () => {
    expect(matchRoutingRule(rules.slice(1), { intent_score: 90 })).toBeNull();
  });
});

describe('fillTemplate', () => {
  it('fills known merge fields and leaves unknown ones for the reviewer', () => {
    expect(fillTemplate('Hi {{first_name}} from {{ company }} — re {{pain_point}}', { first_name: 'Ada', company: 'Acme' })).toBe(
      'Hi Ada from Acme — re {{pain_point}}'
    );
  });
});

describe('parseAdSpendEvent', () => {
  it('normalizes a valid event', () => {
    expect(
      parseAdSpendEvent({ platform: 'meta', name: 'Retargeting', date: '2026-10-01', spend: 12.5, clicks: 3.9, currency: 'eur' })
    ).toEqual({
      issues: [],
      event: {
        platform: 'meta',
        campaign_id: '',
        adset_id: '',
        creative_id: '',
        name: 'Retargeting',
        date: '2026-10-01',
        spend: 12.5,
        impressions: 0,
        clicks: 3,
        currency: 'EUR'
      }
    });
  });

  it('reports every issue on an invalid event', () => {
    const { event, issues } = parseAdSpendEvent({ platform: 'myspace', date: '01/10/2026', spend: -1 });
    expect(event).toBeUndefined();
    expect(issues).toHaveLength(4);
  });
});
