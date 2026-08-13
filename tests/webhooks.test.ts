import request from 'supertest';
import { mockControllerStub, createApp } from './helpers/featureRouteHarness';
jest.mock('../src/controllers/unipileWebhookController', () => ({ handleUnipileWebhook: mockControllerStub('handleUnipileWebhook') }));
import webhookRoutes from '../src/routes/webhookRoutes';
describe('webhooks API', () => it('acknowledges Unipile webhook events', async () => {
  const response = await request(createApp('/webhooks', webhookRoutes)).post('/webhooks/unipile').send({ type: 'message.received' });
  expect(response.status).toBe(200); expect(response.body.handler).toBe('handleUnipileWebhook');
}));
