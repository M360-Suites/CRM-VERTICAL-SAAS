import { Response } from 'express';
import { AuthRequest } from '../types';
import { Notification } from '../models/Notification';
import { requireOrganization } from '../utils/tenant';

export const listNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: false, message: 'Authentication required' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find({ userId })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ userId })
    ]);

    res.json({
      status: true,
      message: 'Notifications retrieved successfully',
      data: {
        data: notifications,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch notifications' });
  }
};

export const markNotificationRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: false, message: 'Authentication required' });
      return;
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({ status: false, message: 'Notification not found' });
      return;
    }

    res.json({
      status: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to update notification' });
  }
};

export const markAllNotificationsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: false, message: 'Authentication required' });
      return;
    }

    await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );

    res.json({
      status: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to mark notifications as read' });
  }
};
