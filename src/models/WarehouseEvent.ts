/**
 * WarehouseEvent model
 * Append-only audit log of everything the revenue ops engine ingests or decides
 */
import mongoose, { Document, Schema } from 'mongoose';

export interface IWarehouseEvent extends Document {
  organization_id: mongoose.Types.ObjectId;
  source: string;
  event_type: string;
  entity_type: string;
  entity_id?: mongoose.Types.ObjectId;
  actor_id?: mongoose.Types.ObjectId;
  payload: Record<string, unknown>;
  at: Date;
}

const WarehouseEventSchema = new Schema<IWarehouseEvent>({
  organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  source: { type: String, required: true },
  event_type: { type: String, required: true },
  entity_type: { type: String, required: true },
  entity_id: { type: Schema.Types.ObjectId },
  actor_id: { type: Schema.Types.ObjectId, ref: 'User' },
  payload: { type: Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now }
});

WarehouseEventSchema.index({ organization_id: 1, at: -1 });
WarehouseEventSchema.index({ organization_id: 1, event_type: 1, at: -1 });

export const WarehouseEvent = mongoose.model<IWarehouseEvent>('WarehouseEvent', WarehouseEventSchema, 'warehouse_events');
