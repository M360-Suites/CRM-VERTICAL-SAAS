import express from 'express';
import request from 'supertest';

const findOne = jest.fn();
const bulkWrite = jest.fn();
const updateMany = jest.fn();
const connectorFind = jest.fn();

jest.mock('../src/config', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/Organization', () => ({ Organization: { findOne } }));
jest.mock('../src/models/AdCampaign', () => ({ AdCampaign: { bulkWrite } }));
jest.mock('../src/models/AdConnector', () => ({
  ...jest.requireActual('../src/models/AdConnector'),
  AdConnector: { find: connectorFind, updateMany }
}));
jest.mock('../src/services/revopsDefaults', () => ({ ensureRevopsDefaults: jest.fn() }));

import publicIngestRoutes from '../src/routes/publicIngestRoutes';

const app = express();
app.use(express.json());
app.use('/public/ingest', publicIngestRoutes);

const SECRET = 'sk_live_abc123';
const event = { platform: 'meta', campaign_id: 'c1', name: 'Retargeting', date: '2026-10-01', spend: 10, clicks: 2 };

describe('POST /public/ingest/ad-events', () => {
  beforeEach(() => {
    findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: '66f000000000000000000001', is_active: true, secretKey: SECRET })
    });
    connectorFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'conn-meta', platform: 'meta' }] }) });
    bulkWrite.mockResolvedValue({});
    updateMany.mockResolvedValue({});
  });

  it('rejects a missing or malformed secret without touching the database', async () => {
    const response = await request(app).post('/public/ingest/ad-events').send({ events: [event] });
    expect(response.status).toBe(401);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects an unknown secret', async () => {
    findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const response = await request(app)
      .post('/public/ingest/ad-events')
      .set('x-ingest-secret', 'sk_live_wrong')
      .send({ events: [event] });
    expect(response.status).toBe(401);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await request(app)
      .post('/public/ingest/ad-events')
      .set('x-ingest-secret', SECRET)
      .set('Content-Type', 'application/json')
      .send('{"events": [');
    expect(response.status).toBe(400);
  });

  it('returns per-event issues for invalid fields', async () => {
    const response = await request(app)
      .post('/public/ingest/ad-events')
      .set('x-ingest-secret', SECRET)
      .send({ events: [event, { ...event, date: 'yesterday' }] });
    expect(response.status).toBe(400);
    expect(response.body.issues[0].path).toBe('events[1]');
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('caps batches at 500 events', async () => {
    const response = await request(app)
      .post('/public/ingest/ad-events')
      .set('x-ingest-secret', SECRET)
      .send({ events: Array.from({ length: 501 }, () => event) });
    expect(response.status).toBe(400);
  });

  it('upserts on the org-scoped unique key and is identical on re-send', async () => {
    const send = () =>
      request(app).post('/public/ingest/ad-events').set('x-ingest-secret', SECRET).send({ events: [event] });

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ ingested: 1, spend: 10, platforms: ['meta'] });
    expect(second.body.data).toEqual(first.body.data);

    const [firstOps] = bulkWrite.mock.calls[0];
    const [secondOps] = bulkWrite.mock.calls[1];
    expect(firstOps[0].updateOne.upsert).toBe(true);
    expect(firstOps[0].updateOne.filter).toEqual({
      organization_id: '66f000000000000000000001',
      platform: 'meta',
      external_campaign_id: 'c1',
      adset_id: '',
      creative_id: '',
      stat_date: '2026-10-01'
    });
    expect(secondOps[0].updateOne.filter).toEqual(firstOps[0].updateOne.filter);
  });

  it('never returns PII or the secret', async () => {
    const response = await request(app)
      .post('/public/ingest/ad-events')
      .set('x-ingest-secret', SECRET)
      .send({ events: [event] });
    expect(JSON.stringify(response.body)).not.toContain(SECRET);
  });
});
