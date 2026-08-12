import { Server as HTTPServer } from 'http';
import { Server } from 'socket.io';

let io: Server | null = null;

export const initializeSocket = (httpServer: HTTPServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId as string;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    socket.on('disconnect', () => {});
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

export const emitDealStageChanged = (organizationId: string, payload: {
  deal_id: string;
  stage_id: string;
  title: string;
  userId: string;
}): void => {
  if (io) {
    io.emit('deal:stage_changed', { ...payload, organizationId });
  }
};

export const emitNotification = (userId: string, payload: { provider: string; title: string; createdAt: Date }): void => {
  if (io) {
    io.to(`user:${userId}`).emit('notification', payload);
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
  const server = io;
  const data = { stage_id: stageId, ...payload };
  recipientUserIds.forEach((userId) => {
    server.to(`user:${userId}`).emit('stage:message', data);
  });
  server.to(`stage:${stageId}`).emit('stage:message', data);
};
