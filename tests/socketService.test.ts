import type { Server as HTTPServer } from 'http';

const REP_ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd7994390ff';
const ORG_ID = '507f1f77bcf86cd799439012';

jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test-secret', ORIGIN: 'https://app.example.com' } }));
jest.mock('../src/utils/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../src/models/User', () => ({ User: { findById: jest.fn() } }));

const emit = jest.fn();
const to = jest.fn(() => ({ emit }));
jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => ({ use: jest.fn(), on: jest.fn(), to }))
}));

import { Server } from 'socket.io';
import { verifyToken } from '../src/utils/jwt';
import { User } from '../src/models/User';
import {
  authenticateSocket,
  emitDealStageChanged,
  emitNotification,
  initializeSocket,
  joinRooms
} from '../src/services/socketService';

const leanResult = (value: unknown) => ({ select: () => ({ lean: () => Promise.resolve(value) }) });

const fakeSocket = (handshake: { headers?: Record<string, string>; auth?: Record<string, unknown>; query?: Record<string, string> }) => ({
  handshake: { headers: {}, auth: {}, query: {}, ...handshake },
  data: {} as { user?: { id: string; organization_id: string; role: string } },
  join: jest.fn()
});

beforeEach(() => {
  jest.clearAllMocks();
  (verifyToken as jest.Mock).mockReturnValue({ id: REP_ID });
  (User.findById as jest.Mock).mockReturnValue(
    leanResult({ _id: REP_ID, role: 'sales_rep', organization_id: ORG_ID, is_active: true })
  );
});

describe('socket authentication', () => {
  it('rejects a connection without a token, even if it claims a userId', async () => {
    const socket = fakeSocket({ query: { userId: OTHER_ID } });
    const next = jest.fn();
    await authenticateSocket(socket as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.user).toBeUndefined();
  });

  it('rejects an invalid token', async () => {
    (verifyToken as jest.Mock).mockImplementation(() => {
      throw new Error('bad');
    });
    const next = jest.fn();
    await authenticateSocket(fakeSocket({ auth: { token: 'forged' } }) as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rejects a deactivated user', async () => {
    (User.findById as jest.Mock).mockReturnValue(leanResult({ _id: REP_ID, role: 'admin', organization_id: ORG_ID, is_active: false }));
    const next = jest.fn();
    await authenticateSocket(fakeSocket({ auth: { token: 't' } }) as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it.each([
    ['handshake auth', { auth: { token: 'tok' } }],
    ['auth cookie', { headers: { cookie: 'other=1; crm_AT=tok' } }],
    ['Bearer header', { headers: { authorization: 'Bearer tok' } }]
  ])('accepts a valid token from the %s and takes identity from the database', async (_source, handshake) => {
    const socket = fakeSocket({ ...handshake, query: { userId: OTHER_ID } });
    const next = jest.fn();
    await authenticateSocket(socket as never, next);
    expect(verifyToken).toHaveBeenCalledWith('tok');
    expect(next).toHaveBeenCalledWith();
    // The client-supplied userId is ignored
    expect(socket.data.user).toEqual({ id: REP_ID, organization_id: ORG_ID, role: 'sales_rep' });
  });
});

describe('socket rooms', () => {
  it('puts a sales rep in their own and org rooms, but not the all-deals room', () => {
    const socket = fakeSocket({});
    socket.data.user = { id: REP_ID, organization_id: ORG_ID, role: 'sales_rep' };
    joinRooms(socket as never);
    expect(socket.join.mock.calls.flat()).toEqual([`user:${REP_ID}`, `org:${ORG_ID}`]);
  });

  it('adds managers to the all-deals room', () => {
    const socket = fakeSocket({});
    socket.data.user = { id: OTHER_ID, organization_id: ORG_ID, role: 'sales_manager' };
    joinRooms(socket as never);
    expect(socket.join.mock.calls.flat()).toContain(`org:${ORG_ID}:all-deals`);
  });
});

describe('event delivery', () => {
  let serverOptions: { cors: { origin: unknown } };
  beforeAll(() => {
    initializeSocket({} as HTTPServer);
    serverOptions = (Server as unknown as jest.Mock).mock.calls[0][1];
  });

  it('restricts CORS to the configured origins', () => {
    expect(serverOptions.cors.origin).toEqual(['https://app.example.com']);
  });

  it('sends a stage change only to the org’s all-deals room and the deal owner', () => {
    emitDealStageChanged(ORG_ID, { deal_id: 'd1', stage_id: 's1', title: 'Big deal', userId: OTHER_ID }, { _id: REP_ID, email: 'x' });
    expect(to).toHaveBeenCalledWith([`org:${ORG_ID}:all-deals`, `user:${REP_ID}`]);
    expect(emit).toHaveBeenCalledWith('deal:stage_changed', expect.objectContaining({ deal_id: 'd1', organizationId: ORG_ID }));
  });

  it('dedupes owners for a bulk move and skips unassigned deals', () => {
    emitDealStageChanged(ORG_ID, { deal_id: 'd1', stage_id: 's1', title: 'bulk-3', userId: OTHER_ID }, [REP_ID, null, REP_ID]);
    expect(to).toHaveBeenCalledWith([`org:${ORG_ID}:all-deals`, `user:${REP_ID}`]);
  });

  it('never broadcasts to every connected socket', () => {
    emitDealStageChanged(ORG_ID, { deal_id: 'd1', stage_id: 's1', title: 't', userId: OTHER_ID });
    emitNotification(REP_ID, { provider: 'x', title: 'y', createdAt: new Date() });
    expect(to).toHaveBeenCalledTimes(2);
    expect(to).toHaveBeenLastCalledWith(`user:${REP_ID}`);
  });
});
