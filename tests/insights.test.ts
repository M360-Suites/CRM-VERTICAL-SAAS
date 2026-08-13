import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/analyticsController', () => Object.fromEntries('getAnalytics getAnalyticsSummary getAnalyticsPipelineByStage getAnalyticsLeadSources getAnalyticsTeamProductivity getAnalyticsTaskSummary'.split(' ').map((name) => [name, mockControllerStub(name)])));
jest.mock('../src/controllers/reportsController', () => Object.fromEntries('getReports getReportsSummary getReportsPipelineByStage getReportsDealSourceMix getReportsContactTemperature exportReports'.split(' ').map((name) => [name, mockControllerStub(name)])));
jest.mock('../src/controllers/dashboardController', () => Object.fromEntries('getDashboardSummary getSalesReport getTaskReport getActivityReport exportDashboardReport'.split(' ').map((name) => [name, mockControllerStub(name)])));
import analyticsRoutes from '../src/routes/analyticsRoutes'; import reportsRoutes from '../src/routes/reportsRoutes'; import dashboardRoutes from '../src/routes/dashboardRoutes';
const app = expressApp(); function expressApp() { const app = createApp('/analytics', analyticsRoutes); app.use('/reports', reportsRoutes); app.use('/dashboard', dashboardRoutes); return app; }
describe('analytics, reports, and dashboard APIs', () => {
  it.each([
    ['/analytics', 'getAnalytics'], ['/analytics/summary', 'getAnalyticsSummary'], ['/analytics/pipeline-by-stage', 'getAnalyticsPipelineByStage'], ['/analytics/lead-sources', 'getAnalyticsLeadSources'], ['/analytics/team-productivity', 'getAnalyticsTeamProductivity'], ['/analytics/task-summary', 'getAnalyticsTaskSummary'],
    ['/reports', 'getReports'], ['/reports/summary', 'getReportsSummary'], ['/reports/pipeline-by-stage', 'getReportsPipelineByStage'], ['/reports/deal-source-mix', 'getReportsDealSourceMix'], ['/reports/contact-temperature', 'getReportsContactTemperature'], ['/reports/export', 'exportReports'],
    ['/dashboard/summary', 'getDashboardSummary'], ['/dashboard/sales', 'getSalesReport'], ['/dashboard/tasks', 'getTaskReport'], ['/dashboard/activities', 'getActivityReport'], ['/dashboard/export', 'exportDashboardReport']
  ])('routes GET %s to %s', async (path, handler) => {
    const response = await authenticated(request(app).get(path)); expect(response.status).toBe(200); expect(response.body.handler).toBe(handler);
  });
  it('denies report export to sales reps', async () => expect((await authenticated(request(app).get('/reports/export')).set('x-test-role', 'sales_rep')).status).toBe(403));
});
