import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import config from '../config';
import { logger } from '../config/logger';
import { verifyToken } from '../utils/jwt';
import { User } from '../models/User';

let io: Server | null = null;

/** Identity attached to an authenticated socket — always taken from a verified token, never the client */
export interface SocketUser {
  id: string;
  organization_id: string;
  role: string;
}

type AuthedSocket = Socket & { data: { user?: SocketUser } };

/** Rooms. Clients can't join rooms themselves; the server places them on connect. */
export const userRoom = (userId: string): string => `user:${userId}`;
export const orgRoom = (organizationId: string): string => `org:${organizationId}`;
/** Members who may see every deal in the org (everyone except sales reps, who only see their own) */
export const orgAllDealsRoom = (organizationId: string): string => `org:${organizationId}:all-deals`;

const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
};

/** Same token sources as the REST `authenticate` middleware: auth cookie, handshake auth, or Bearer header */
export const extractSocketToken = (handshake: Socket['handshake']): string | undefined => {
  const cookieHeader = handshake.headers.cookie;
  const fromCookie = readCookie(cookieHeader, 'crm_AT') || readCookie(cookieHeader, 'token');
  const fromAuth = typeof handshake.auth?.token === 'string' ? handshake.auth.token : undefined;
  const authHeader = handshake.headers.authorization;
  const fromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  return fromCookie || fromAuth?.replace(/^Bearer\s+/i, '') || fromHeader;
};

/** Rejects the connection unless it carries a valid token for an active user */
export const authenticateSocket = async (socket: AuthedSocket, next: (err?: Error) => void): Promise<void> => {
  try {
    const token = extractSocketToken(socket.handshake);
    if (!token) return next(new Error('UNAUTHORIZED'));

    const decoded = verifyToken(token);
    // Role/org come from the database so a demoted or deactivated user loses access immediately
    const user = await User.findById(decoded.id).select('_id role organization_id is_active').lean<{
      _id: unknown;
      role: string;
      organization_id?: unknown;
      is_active: boolean;
    }>();
    if (!user || !user.is_active || !user.organization_id) return next(new Error('UNAUTHORIZED'));

    socket.data.user = {
      id: String(user._id),
      organization_id: String(user.organization_id),
      role: user.role
    };
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
};

export const joinRooms = (socket: AuthedSocket): void => {
  const user = socket.data.user;
  if (!user) return;
  socket.join(userRoom(user.id));
  socket.join(orgRoom(user.organization_id));
  if (user.role !== 'sales_rep') socket.join(orgAllDealsRoom(user.organization_id));
};

export const initializeSocket = (httpServer: HTTPServer): Server => {
  const allowedOrigins = config.ORIGIN ? config.ORIGIN.split(',').map((origin) => origin.trim()) : false;

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true
    }
  });

  io.use((socket, next) => void authenticateSocket(socket as AuthedSocket, next));

  io.on('connection', (socket) => {
    joinRooms(socket as AuthedSocket);
    socket.on('disconnect', () => {});
  });

  logger.info('Socket.io initialised (authenticated connections only)');
  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

const toIdString = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const id = typeof value === 'object' && '_id' in (value as object) ? (value as { _id: unknown })._id : value;
  return id ? String(id) : undefined;
};

/**
 * Deal moved to another stage. Delivered only inside the deal's organization: to members who can
 * see every deal, plus the deal owner(s) — so sales reps never learn about deals that aren't theirs.
 */
export const emitDealStageChanged = (
  organizationId: string,
  payload: {
    deal_id: string;
    stage_id: string;
    title: string;
    userId: string;
  },
  owners: unknown | unknown[] = []
): void => {
  if (!io) return;
  const ownerIds = [...new Set((Array.isArray(owners) ? owners : [owners]).map(toIdString).filter((id): id is string => !!id))];
  const rooms = [orgAllDealsRoom(organizationId), ...ownerIds.map(userRoom)];
  io.to(rooms).emit('deal:stage_changed', { ...payload, organizationId });
};

export const emitNotification = (userId: string, payload: { provider: string; title: string; createdAt: Date }): void => {
  if (io) {
    io.to(userRoom(userId)).emit('notification', payload);
  }
};

export const emitStageMessage = (
  stageId: string,
  recipientUserIds: string[],
  payload: {
    event: 'created' | 'updated' | 'deleted';
    organizationId: string;
    message?: Record<string, unknown>;
    messageId?: string;
    senderId?: string;
    createdAt?: Date;
  }
): void => {
  if (!io) return;
  const data = { stage_id: stageId, ...payload };
  // One emit over the union of rooms, so a user in several of them gets the message once
  io.to(recipientUserIds.map(userRoom)).emit('stage:message', data);
};
