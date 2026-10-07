import request from 'supertest';
import { authenticated, createApp, mockAuthentication } from './helpers/featureRouteHarness';

jest.mock('../src/middleware/auth', () => mockAuthentication());

jest.mock('../src/controllers/emailTemplateController', () => {
  const { mockControllerStub: stub } = jest.requireActual('./helpers/featureRouteHarness');
  return Object.fromEntries(
    ['listTemplates', 'createTemplate', 'getTemplate', 'updateTemplate', 'deleteTemplate', 'duplicateTemplate', 'listMergeVariables', 'previewTemplate', 'sendTestTemplate'].map(
      (name) => [name, stub(name)]
    )
  );
});
jest.mock('../src/controllers/emailTriggerController', () => {
  const { mockControllerStub: stub } = jest.requireActual('./helpers/featureRouteHarness');
  return Object.fromEntries(
    ['listTriggers', 'createTrigger', 'getTrigger', 'updateTrigger', 'deleteTrigger', 'listTriggerEvents', 'listTriggerRuns'].map(
      (name) => [name, stub(name)]
    )
  );
});
jest.mock('../src/controllers/broadcastController', () => {
  const { mockControllerStub: stub } = jest.requireActual('./helpers/featureRouteHarness');
  return Object.fromEntries(
    [
      'listBroadcasts',
      'createBroadcast',
      'getBroadcast',
      'updateBroadcast',
      'deleteBroadcast',
      'previewAudience',
      'sendBroadcast',
      'cancelBroadcastHandler',
      'sendTestBroadcast',
      'listBroadcastRecipients'
    ].map((name) => [name, stub(name)])
  );
});

import emailTemplateRoutes from '../src/routes/emailTemplateRoutes';
import emailTriggerRoutes from '../src/routes/emailTriggerRoutes';
import broadcastRoutes from '../src/routes/broadcastRoutes';

const templates = createApp('/email-templates', emailTemplateRoutes);
const triggers = createApp('/email-triggers', emailTriggerRoutes);
const broadcasts = createApp('/broadcasts', broadcastRoutes);


describe('email module routes', () => {
  it('requires authentication', async () => {
    expect((await request(templates).get('/email-templates')).status).toBe(401);
    expect((await request(triggers).get('/email-triggers')).status).toBe(401);
    expect((await request(broadcasts).get('/broadcasts')).status).toBe(401);
  });

  it('routes static paths before :id', async () => {
    expect((await authenticated(request(templates).get('/email-templates/variables'))).body.handler).toBe('listMergeVariables');
    expect((await authenticated(request(templates).post('/email-templates/preview'))).body.handler).toBe('previewTemplate');
    expect((await authenticated(request(triggers).get('/email-triggers/events'))).body.handler).toBe('listTriggerEvents');
    expect((await authenticated(request(triggers).get('/email-triggers/runs'))).body.handler).toBe('listTriggerRuns');
    expect((await authenticated(request(broadcasts).post('/broadcasts/audience/preview'))).body.handler).toBe('previewAudience');
    expect((await authenticated(request(broadcasts).get('/broadcasts/abc/recipients'))).body.handler).toBe('listBroadcastRecipients');
  });

  it('lets any member read but only admins write', async () => {
    const asRep = (test: request.Test) => authenticated(test).set('x-test-role', 'sales_rep');

    expect((await asRep(request(templates).get('/email-templates'))).status).toBe(200);
    expect((await asRep(request(broadcasts).get('/broadcasts'))).status).toBe(200);
    expect((await asRep(request(templates).post('/email-templates'))).status).toBe(403);
    expect((await asRep(request(triggers).post('/email-triggers'))).status).toBe(403);
    expect((await asRep(request(broadcasts).post('/broadcasts/abc/send'))).status).toBe(403);

    const asManager = (test: request.Test) => authenticated(test).set('x-test-role', 'sales_manager');
    expect((await asManager(request(triggers).post('/email-triggers'))).status).toBe(403);
    expect((await asManager(request(templates).patch('/email-templates/abc'))).status).toBe(403);
    expect((await asManager(request(broadcasts).post('/broadcasts/abc/send'))).status).toBe(403);

    const asAdmin = (test: request.Test) => authenticated(test).set('x-test-role', 'admin');
    expect((await asAdmin(request(triggers).post('/email-triggers'))).status).toBe(201);
    expect((await asAdmin(request(broadcasts).post('/broadcasts/abc/send'))).body.handler).toBe('sendBroadcast');
    expect((await asAdmin(request(broadcasts).post('/broadcasts/abc/cancel'))).body.handler).toBe('cancelBroadcastHandler');
  });
});
