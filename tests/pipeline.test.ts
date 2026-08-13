import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/pipelineController', () => Object.fromEntries([
  'getPipeline getPipelineStages createPipelineStage updatePipelineStage deletePipelineStage getPipelineDeals createPipelineDeal updatePipelineDeal deletePipelineDeal movePipelineDealStage getPipelineDealActivities getPipelineTeamMembers getPipelineStageAssignees assignPipelineStageMember removePipelineStageMember'.split(' ')
].flat().map((name) => [name, mockControllerStub(name)])));
import pipelineRoutes from '../src/routes/pipelineRoutes';
const app = createApp('/pipeline', pipelineRoutes);
describe('pipeline API', () => {
  it('requires authentication', async () => expect((await request(app).get('/pipeline')).status).toBe(401));
  it.each([
    ['get', '/', 'getPipeline'], ['get', '/stages', 'getPipelineStages'], ['post', '/stages', 'createPipelineStage'], ['patch', '/stages/stage-1', 'updatePipelineStage'], ['delete', '/stages/stage-1', 'deletePipelineStage'],
    ['get', '/deals', 'getPipelineDeals'], ['post', '/deals', 'createPipelineDeal'], ['patch', '/deals/deal-1', 'updatePipelineDeal'], ['delete', '/deals/deal-1', 'deletePipelineDeal'], ['patch', '/deals/deal-1/stage', 'movePipelineDealStage'],
    ['get', '/deals/deal-1/activities', 'getPipelineDealActivities'], ['get', '/team-members', 'getPipelineTeamMembers'], ['get', '/stage-assignees', 'getPipelineStageAssignees'], ['post', '/stages/stage-1/assignees', 'assignPipelineStageMember'], ['delete', '/stages/stage-1/assignees/user-1', 'removePipelineStageMember']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path));
    expect(response.status).toBe(['createPipelineStage', 'createPipelineDeal'].includes(handler) ? 201 : 200);
    expect(response.body.handler).toBe(handler);
  });
});
