import { Response } from 'express';
import mongoose from 'mongoose';
import { Task, ITask, TaskType, TaskPriority, TaskStatus } from '../models/Task';
import { Activity } from '../models/Activity';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';

interface TaskQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  owner_id?: string;
  assignee_id?: string;
  contact_id?: string;
  deal_id?: string;
  company_id?: string;
}

export const listTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      priority,
      type,
      owner_id,
      assignee_id,
      contact_id,
      deal_id,
      company_id
    } = req.query as TaskQuery;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const query: Record<string, unknown> = { organization_id: organizationId };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (type) query.type = type;
    if (owner_id) query.owner_id = new mongoose.Types.ObjectId(owner_id);
    if (contact_id) query.contact_id = new mongoose.Types.ObjectId(contact_id);
    if (deal_id) query.deal_id = new mongoose.Types.ObjectId(deal_id);
    if (company_id) query.company_id = new mongoose.Types.ObjectId(company_id);
    if (assignee_id) query.assignees = new mongoose.Types.ObjectId(assignee_id);

    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      Task.find(query)
        .populate('owner_id', 'email display_name')
        .populate('assignees', 'email display_name')
        .populate('contact_id', 'first_name last_name')
        .populate('deal_id', 'title')
        .populate('company_id', 'name')
        .sort({ due_at: 1, created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(query)
    ]);

    const response: PaginatedResponse<ITask> = {
      status: true,
      message: 'Tasks retrieved successfully',
      data: {
        data: tasks,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tasks'
    });
  }
};

export const getTaskById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid task ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const task = await Task.findOne({ _id: id, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('contact_id', 'first_name last_name email')
      .populate('deal_id', 'title value')
      .populate('company_id', 'name')
      .lean();

    if (!task) {
      res.status(404).json({
        status: false,
        message: 'Task not found'
      });
      return;
    }

    res.json({ status: true, message: 'Task retrieved successfully', data: task });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch task'
    });
  }
};

interface CreateTaskBody {
  title: string;
  type: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  description?: string;
  due_at?: string;
  duration_minutes?: number;
  location?: string;
  meeting_url?: string;
  contact_id?: string;
  deal_id?: string;
  company_id?: string;
  assignees?: string[];
}

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      type,
      priority,
      status,
      description,
      due_at,
      duration_minutes,
      location,
      meeting_url,
      contact_id,
      deal_id,
      company_id,
      assignees
    } = req.body as CreateTaskBody;

    if (!req.user?.id) {
      res.status(401).json({
        status: false,
        message: 'User not authenticated'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const task = new Task({
      title,
      type,
      priority: priority || 'medium',
      status: status || 'pending',
      description,
      due_at: due_at ? new Date(due_at) : undefined,
      duration_minutes,
      location,
      meeting_url,
      contact_id: contact_id ? new mongoose.Types.ObjectId(contact_id) : undefined,
      deal_id: deal_id ? new mongoose.Types.ObjectId(deal_id) : undefined,
      company_id: company_id ? new mongoose.Types.ObjectId(company_id) : undefined,
      owner_id: new mongoose.Types.ObjectId(req.user.id),
      organization_id: organizationId,
      assignees: assignees
        ? assignees.map((a: string) => new mongoose.Types.ObjectId(a))
        : []
    });

    await task.save();

    const populatedTask = await Task.findOne({ _id: task._id, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('contact_id', 'first_name last_name')
      .populate('deal_id', 'title')
      .populate('company_id', 'name');

    res.status(201).json({ status: true, message: 'Task created successfully', data: populatedTask });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to create task'
    });
  }
};

interface UpdateTaskBody {
  title?: string;
  type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  description?: string;
  due_at?: string | null;
  duration_minutes?: number;
  location?: string | null;
  meeting_url?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  company_id?: string | null;
  assignees?: string[];
}

export const updateTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const updateData = req.body as UpdateTaskBody;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid task ID'
      });
      return;
    }

    const updateObj: Record<string, unknown> = { ...updateData };

    if (updateData.due_at === null) {
      updateObj.due_at = null;
      updateObj.reminder_sent_at = null;
    } else if (updateData.due_at) {
      updateObj.due_at = new Date(updateData.due_at);
      updateObj.reminder_sent_at = null;
    }

    if (updateData.location === null) {
      updateObj.location = null;
    }
    if (updateData.meeting_url === null) {
      updateObj.meeting_url = null;
    }

    ['contact_id', 'deal_id', 'company_id'].forEach((field) => {
      const value = updateData[field as keyof UpdateTaskBody] as string | null | undefined;
      if (value === null) {
        updateObj[field] = null;
      } else if (value) {
        updateObj[field] = new mongoose.Types.ObjectId(value);
      }
    });

    if (updateData.assignees) {
      updateObj.assignees = updateData.assignees.map(
        (a: string) => new mongoose.Types.ObjectId(a)
      );
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const task = await Task.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { $set: updateObj },
      { new: true, runValidators: true }
    )
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('contact_id', 'first_name last_name')
      .populate('deal_id', 'title')
      .populate('company_id', 'name');

    if (!task) {
      res.status(404).json({
        status: false,
        message: 'Task not found'
      });
      return;
    }

    res.json({ status: true, message: 'Task updated successfully', data: task });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update task'
    });
  }
};

export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid task ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const task = await Task.findOneAndDelete({ _id: id, organization_id: organizationId });

    if (!task) {
      res.status(404).json({
        status: false,
        message: 'Task not found'
      });
      return;
    }

    res.json({ status: true, message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to delete task'
    });
  }
};

export const getMyTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        status: false,
        message: 'User not authenticated'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { status, due_soon } = req.query;
    const query: Record<string, unknown> = {
      organization_id: organizationId,
      $or: [
        { owner_id: new mongoose.Types.ObjectId(req.user.id) },
        { assignees: new mongoose.Types.ObjectId(req.user.id) }
      ]
    };

    if (status) query.status = status;

    if (due_soon === 'true') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      query.due_at = { $lte: tomorrow, $gte: new Date() };
      query.status = { $ne: 'completed' };
    }

    const tasks = await Task.find(query)
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('contact_id', 'first_name last_name')
      .populate('deal_id', 'title')
      .populate('company_id', 'name')
      .sort({ due_at: 1 })
      .limit(50)
      .lean();

    res.json({ status: true, message: 'My tasks retrieved successfully', data: tasks });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tasks'
    });
  }
};

export const completeTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid task ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const task = await Task.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { $set: { status: 'completed' as TaskStatus } },
      { new: true }
    )
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name');

    if (!task) {
      res.status(404).json({
        status: false,
        message: 'Task not found'
      });
      return;
    }

    res.json({ status: true, message: 'Task completed successfully', data: task });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to complete task'
    });
  }
};

export const getUpcomingTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { days = 7 } = req.query;
    const daysNum = Number(days);

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysNum);

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const tasks = await Task.find({
      organization_id: organizationId,
      due_at: { $gte: startDate, $lte: endDate },
      status: { $ne: 'completed' }
    })
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('contact_id', 'first_name last_name')
      .populate('deal_id', 'title')
      .populate('company_id', 'name')
      .sort({ due_at: 1 })
      .lean();

    res.json({ status: true, message: 'Upcoming tasks retrieved successfully', data: tasks });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch upcoming tasks'
    });
  }
};
