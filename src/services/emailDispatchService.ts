/**
 * Email dispatcher — a Mongo-backed queue worker for broadcasts and triggers.
 * Every tick it starts due scheduled broadcasts, sends due trigger runs first
 * (they're time-sensitive), then works through broadcast recipients,
 * throttled to SES_MAX_SEND_RATE emails/second.
 */
import config from '../config';
import { isSesConfigured } from '../config/ses';
import { logger } from '../config/logger';
import { TriggerRun } from '../models/TriggerRun';
import { BroadcastRecipient } from '../models/BroadcastRecipient';
import { Broadcast } from '../models/Broadcast';
import { claimDueTriggerRun, processTriggerRun } from './triggerService';
import { sendNextBroadcastRecipient, startDueScheduledBroadcasts } from './broadcastService';

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
    const gapMs = Math.ceil(1000 / config.SES_MAX_SEND_RATE);

    await failInterruptedSends();
    await startDueScheduledBroadcasts();

    while (Date.now() < deadline) {
      const run = await claimDueTriggerRun();
      if (!run) break;
      await processTriggerRun(run);
      await pause(gapMs);
    }

    while (Date.now() < deadline) {
      const sent = await sendNextBroadcastRecipient();
      if (!sent) break;
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

  if (!isSesConfigured()) {
    logger.warn('Amazon SES not configured (AWS_REGION / SES_FROM_EMAIL) — broadcasts and email triggers will queue but not send');
    return;
  }

  if (!config.BACKEND_URL) {
    logger.warn('BACKEND_URL not set — broadcast and trigger emails will go out without unsubscribe links');
  }

  void runEmailDispatch();
  dispatchTimer = setInterval(() => {
    void runEmailDispatch();
  }, config.EMAIL_DISPATCH_INTERVAL_SECONDS * 1000);

  logger.info(`Email dispatcher started (every ${config.EMAIL_DISPATCH_INTERVAL_SECONDS}s, ${config.SES_MAX_SEND_RATE}/s)`);
};

export const stopEmailDispatchService = (): void => {
  if (dispatchTimer) clearInterval(dispatchTimer);
  dispatchTimer = undefined;
};
