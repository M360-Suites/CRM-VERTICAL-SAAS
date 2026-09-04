import { Task, ITask } from '../models/Task';
import { sendTaskReminderEmail } from '../utils/email';
import { logger } from '../config/logger';

type ReminderUser = {
  email?: string;
  display_name?: string;
  is_active?: boolean;
};

type ReminderTask = ITask & {
  owner_id: ReminderUser;
  assignees: ReminderUser[];
};

const DEFAULT_REMINDER_WINDOW_MINUTES = 24 * 60;
const DEFAULT_REMINDER_INTERVAL_MINUTES = 15;

let reminderTimer: NodeJS.Timeout | undefined;
let isRunning = false;

const toPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getReminderRecipients = (task: ReminderTask): Array<{ address: string; name: string }> => {
  const users = [task.owner_id, ...(task.assignees || [])];
  const uniqueRecipients = new Map<string, { address: string; name: string }>();

  for (const user of users) {
    if (!user?.email || user.is_active === false) continue;

    const email = user.email.toLowerCase();
    uniqueRecipients.set(email, {
      address: email,
      name: user.display_name || ''
    });
  }

  return Array.from(uniqueRecipients.values());
};

export const sendUpcomingTaskReminders = async (): Promise<void> => {
  if (isRunning) return;

  isRunning = true;

  try {
    const now = new Date();
    const windowMinutes = toPositiveNumber(
      process.env.TASK_REMINDER_WINDOW_MINUTES,
      DEFAULT_REMINDER_WINDOW_MINUTES
    );
    const reminderEnd = new Date(now.getTime() + windowMinutes * 60 * 1000);

    const tasks = await Task.find({
      due_at: { $gte: now, $lte: reminderEnd },
      status: { $in: ['pending', 'in_progress'] },
      reminder_sent_at: null
    })
      .populate('owner_id', 'email display_name is_active')
      .populate('assignees', 'email display_name is_active');

    for (const task of tasks as ReminderTask[]) {
      if (!task.due_at) continue;

      const recipients = getReminderRecipients(task);
      if (recipients.length === 0) continue;

      await sendTaskReminderEmail(recipients, {
        title: task.title,
        type: task.type,
        priority: task.priority,
        due_at: task.due_at,
        description: task.description,
        location: task.location,
        meeting_url: task.meeting_url
      });

      await Task.updateOne(
        {
          _id: task._id,
          reminder_sent_at: null
        },
        {
          $set: { reminder_sent_at: new Date() }
        }
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to send task reminders');
  } finally {
    isRunning = false;
  }
};

export const startTaskReminderService = (): void => {
  if (process.env.TASK_REMINDERS_ENABLED === 'false') {
    logger.info('Task reminder service disabled');
    return;
  }

  if (reminderTimer) return;

  const intervalMinutes = toPositiveNumber(
    process.env.TASK_REMINDER_INTERVAL_MINUTES,
    DEFAULT_REMINDER_INTERVAL_MINUTES
  );

  void sendUpcomingTaskReminders();
  reminderTimer = setInterval(() => {
    void sendUpcomingTaskReminders();
  }, intervalMinutes * 60 * 1000);

  logger.info(`Task reminder service started; checking every ${intervalMinutes} minutes`);
};
