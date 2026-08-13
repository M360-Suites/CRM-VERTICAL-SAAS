import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/documentController', () => Object.fromEntries('getFolders getFolderById createFolder updateFolder deleteFolder uploadDocumentsToFolder getFolderDocuments downloadDocument updateDocument deleteDocument'.split(' ').map((name) => [name, mockControllerStub(name)])));
import folderRoutes from '../src/routes/folderRoutes'; import documentRoutes from '../src/routes/documentRoutes';
const app = createApp('/folders', folderRoutes); app.use('/documents', documentRoutes);
describe('folders and documents APIs', () => {
  it.each([
    ['get', '/folders', 'getFolders'], ['post', '/folders', 'createFolder'], ['get', '/folders/folder-1', 'getFolderById'], ['patch', '/folders/folder-1', 'updateFolder'], ['delete', '/folders/folder-1', 'deleteFolder'], ['get', '/folders/folder-1/documents', 'getFolderDocuments'],
    ['get', '/documents/document-1/download', 'downloadDocument'], ['patch', '/documents/document-1', 'updateDocument'], ['delete', '/documents/document-1', 'deleteDocument']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path)); expect(response.status).toBe(handler === 'createFolder' ? 201 : 200); expect(response.body.handler).toBe(handler);
  });
  it('requires authentication', async () => expect((await request(app).get('/folders')).status).toBe(401));
});
