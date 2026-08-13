import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';

jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/companyController', () => ({
  listCompanies: mockControllerStub('listCompanies'), getCompanyById: mockControllerStub('getCompanyById'),
  createCompany: mockControllerStub('createCompany'), bulkImportCompanies: mockControllerStub('bulkImportCompanies'),
  updateCompany: mockControllerStub('updateCompany'), deleteCompany: mockControllerStub('deleteCompany'),
  getCompanyContacts: mockControllerStub('getCompanyContacts'), getCompanyDeals: mockControllerStub('getCompanyDeals'),
  getCompanyStats: mockControllerStub('getCompanyStats'), listCompaniesSelect: mockControllerStub('listCompaniesSelect'),
  exportCompanies: mockControllerStub('exportCompanies')
}));
import companyRoutes from '../src/routes/companyRoutes';

const app = createApp('/companies', companyRoutes);
describe('companies API', () => {
  it('requires authentication', async () => expect((await request(app).get('/companies')).status).toBe(401));
  it.each([
    ['get', '/', 'listCompanies'], ['get', '/select', 'listCompaniesSelect'], ['get', '/company-1', 'getCompanyById'],
    ['get', '/company-1/contacts', 'getCompanyContacts'], ['get', '/company-1/deals', 'getCompanyDeals'],
    ['get', '/company-1/stats', 'getCompanyStats'], ['post', '/', 'createCompany'], ['patch', '/company-1', 'updateCompany'],
    ['delete', '/company-1', 'deleteCompany'], ['get', '/export', 'exportCompanies']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path));
    expect(response.status).toBe(handler === 'createCompany' ? 201 : 200);
    expect(response.body.handler).toBe(handler);
  });
  it('denies exports to sales representatives', async () => {
    const response = await authenticated(request(app).get('/companies/export')).set('x-test-role', 'sales_rep');
    expect(response.status).toBe(403);
  });
});
