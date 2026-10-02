import mongoose from 'mongoose';
import { WarehouseEvent } from '../models/WarehouseEvent';
import { logger } from '../config/logger';

type Id = mongoose.Types.ObjectId | string;

export interface WarehouseEventInput {
  organizationId: Id;
  source: string;
  eventType: string;
  entityType: string;
  entityId?: Id;
  actorId?: Id;
  payload?: Record<string, unknown>;
}

/**
 * Append one event to the warehouse audit log.
 * Best effort — a failed audit write never fails the operation it describes.
 */
export const recordWarehouseEvent = async (input: WarehouseEventInput): Promise<void> => {
  try {
    await WarehouseEvent.create({
      organization_id: input.organizationId,
      source: input.source,
      event_type: input.eventType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      actor_id: input.actorId,
      payload: input.payload ?? {},
      at: new Date()
    });
  } catch (error) {
    logger.warn({ err: error, eventType: input.eventType }, 'Failed to record warehouse event');
  }
};
