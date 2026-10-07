import { Deal } from '../models/Deal';
import { logger } from '../config/logger';

/**
 * Deals created before value defaulted to 0 may have no value or null.
 * Idempotent — after the first run it matches nothing.
 */
export const backfillDealValues = async (): Promise<void> => {
  try {
    const { modifiedCount } = await Deal.updateMany(
      { $or: [{ value: { $exists: false } }, { value: null }] },
      { $set: { value: 0 } }
    );
    if (modifiedCount) logger.info(`Backfilled value = 0 on ${modifiedCount} deal(s)`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to backfill deal values');
  }
};
