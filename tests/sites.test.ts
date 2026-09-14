import request from 'supertest';
import { NextFunction, Request, Response } from 'express';
import { authenticated, createApp, mockControllerStub } from './helpers/featureRouteHarness';

jest.mock('../src/middleware/auth', () => {
  const { mockAuthentication } = require('./helpers/featureRouteHarness');
  return mockAuthentication();
});

jest.mock('../src/controllers/siteController', () => ({
  listSites: mockControllerStub('listSites'),
  countSites: mockControllerStub('countSites'),
  registerSite: mockControllerStub('registerSite'),
  updateSite: mockControllerStub('updateSite'),
  deleteSite: mockControllerStub('deleteSite')
}));

jest.mock('../src/middleware/publicAuth', () => ({
  authenticatePublicKey: jest.fn((_req: Request, _res: Response, next: NextFunction) => next())
}));

jest.mock('../src/controllers/publicSiteController', () => ({
  countSitesPublic: mockControllerStub('countSitesPublic')
}));

import siteRoutes from '../src/routes/siteRoutes';
import publicSiteRoutes from '../src/routes/publicSiteRoutes';

const app = createApp('/org/sites', siteRoutes);
const publicApp = createApp('/public/sites', publicSiteRoutes);

describe('site routes', () => {
  it('routes GET /org/sites to listSites', async () => {
    const response = await authenticated(request(app).get('/org/sites'));
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('listSites');
  });

  it('routes GET /org/sites/count to countSites', async () => {
    const response = await authenticated(request(app).get('/org/sites/count'));
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('countSites');
  });

  it('routes POST /org/sites to registerSite for admin', async () => {
    const response = await authenticated(request(app).post('/org/sites')).send({ domain: 'example.com' });
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('registerSite');
  });

  it('forbids POST /org/sites for non-admin roles', async () => {
    const response = await authenticated(request(app).post('/org/sites').set('x-test-role', 'viewer'))
      .send({ domain: 'example.com' });
    expect(response.status).toBe(403);
    expect(response.body.handler).toBeUndefined();
  });

  it('routes PATCH /org/sites/:id to updateSite', async () => {
    const response = await authenticated(request(app).patch('/org/sites/site-1')).send({ is_active: false });
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('updateSite');
  });

  it('routes DELETE /org/sites/:id to deleteSite', async () => {
    const response = await authenticated(request(app).delete('/org/sites/site-1'));
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('deleteSite');
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/org/sites');
    expect(response.status).toBe(401);
  });
});

describe('public site route', () => {
  it('routes GET /public/sites to countSitesPublic via public key', async () => {
    const response = await request(publicApp)
      .get('/public/sites')
      .set('x-api-key', 'pk_live_test');
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('countSitesPublic');
  });
});