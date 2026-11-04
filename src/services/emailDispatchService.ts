/**
 * Email dispatcher — a Mongo-backed queue worker for broadcasts and triggers.
 * Every tick it starts due scheduled broadcasts, sends due trigger runs first
 * (they're time-sensitive), then works through broadcast recipients,
 * sent to Ensend in batches of up to 250. Trigger emails are throttled
 * to EMAIL_MAX_SEND_RATE/second (also the pause between broadcast batches).
 * An Ensend 429 ends the tick; the unsent emails go back in the queue.
 */
import config from '../config';
import { isEmailConfigured, isEmailRateLimited } from '../utils/ensendMailer';
import { logger } from '../config/logger';
import { TriggerRun } from '../models/TriggerRun';
import { BroadcastRecipient } from '../models/BroadcastRecipient';
import { Broadcast } from '../models/Broadcast';
import { claimDueTriggerRun, processTriggerRun } from './triggerService';
import { sendNextBroadcastBatch, startDueScheduledBroadcasts } from './broadcastService';

/** A send stuck in `sending` this long was interrupted by a restart */
const STALE_SEND_MS = 15 * 60 * 1000;

let dispatchTimer: NodeJS.Timeout | undefined;
let isRunning = false;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Interrupted sends are marked failed rather than retried — a duplicate
 * marketing email is worse than a missed one.
 */
const failInterruptedSends = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - STALE_SEND_MS);
  await TriggerRun.updateMany(
    { status: 'sending', updated_at: { $lt: cutoff } },
    { $set: { status: 'failed', error: 'Send interrupted' } }
  );

  const stuck = await BroadcastRecipient.find({ status: 'sending', updated_at: { $lt: cutoff } })
    .select('_id broadcast_id')
    .lean();
  for (const recipient of stuck) {
    const { modifiedCount } = await BroadcastRecipient.updateOne(
      { _id: recipient._id, status: 'sending' },
      { $set: { status: 'failed', error: 'Send interrupted' } }
    );
    if (modifiedCount) await Broadcast.updateOne({ _id: recipient.broadcast_id }, { $inc: { 'stats.failed': 1 } });
  }
};

export const runEmailDispatch = async (): Promise<void> => {
  if (isRunning) return;
  isRunning = true;

  try {
    // Leave headroom so one tick finishes before the next is due
    const deadline = Date.now() + config.EMAIL_DISPATCH_INTERVAL_SECONDS * 1000 * 0.8;
    const gapMs = Math.ceil(1000 / config.EMAIL_MAX_SEND_RATE);

    await failInterruptedSends();
    await startDueScheduledBroadcasts();

    while (Date.now() < deadline && !isEmailRateLimited()) {
      const run = await claimDueTriggerRun();
      if (!run) break;
      await processTriggerRun(run);
      await pause(gapMs);
    }

    while (Date.now() < deadline && !isEmailRateLimited()) {
      const processed = await sendNextBroadcastBatch();
      if (!processed) break;
      await pause(gapMs);
    }
  } catch (error) {
    logger.error({ err: error }, 'Email dispatch tick failed');
  } finally {
    isRunning = false;
  }
};

export const startEmailDispatchService = (): void => {
  if (dispatchTimer) return;

  if (!isEmailConfigured()) {
    logger.warn('Ensend not configured (ENSEND_SECRET) — broadcasts and email triggers will queue but not send');
    return;
  }

  if (!config.BACKEND_URL) {
    logger.warn('BACKEND_URL not set — broadcast and trigger emails will go out without unsubscribe links');
  }

  void runEmailDispatch();
  dispatchTimer = setInterval(() => {
    void runEmailDispatch();
  }, config.EMAIL_DISPATCH_INTERVAL_SECONDS * 1000);

  logger.info(`Email dispatcher started (every ${config.EMAIL_DISPATCH_INTERVAL_SECONDS}s, ${config.EMAIL_MAX_SEND_RATE}/s, via Ensend)`);
};

export const stopEmailDispatchService = (): void => {
  if (dispatchTimer) clearInterval(dispatchTimer);
  dispatchTimer = undefined;
};
