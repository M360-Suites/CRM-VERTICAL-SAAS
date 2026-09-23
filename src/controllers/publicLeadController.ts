import mongoose from 'mongoose';
import { Response } from 'express';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { Pipeline, PipelineStage } from '../models/Pipeline';
import { Organization } from '../models/Organization';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { generateLeadTitle } from '../utils/groq';
import { emitNotification } from '../services/socketService';
import { sendNewLeadEmail } from '../utils/email';
import { logger } from '../config/logger';
import { PublicKeyRequest } from '../middleware/publicAuth';

interface LeadCaptureBody {
  name?: string;
  full_name?: string;
  fullname?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  source?: string;
  temperature?: 'hot' | 'warm' | 'cold';
  tags?: string | string[];
  [key: string]: unknown;
}

const LEAD_STAGE_NAME = 'Lead';

const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * Notify all admins (role=admin or org owner) of a newly captured public lead.
 * Best effort — never fails the lead capture request.
 */
const notifyAdminsOfNewLead = async (
  organizationId: mongoose.Types.ObjectId,
  lead: {
    contactId: mongoose.Types.ObjectId;
    dealId?: mongoose.Types.ObjectId | null;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    source?: string;
    company?: string;
  }
): Promise<void> => {
  try {
    const organization = await Organization.findById(organizationId)
      .select('owner_id')
      .lean();

    const admins = await User.find({
      organization_id: organizationId,
      is_active: true,
      ...(organization?.owner_id ? { $or: [{ role: 'admin' }, { _id: organization.owner_id }] } : {})
    })
      .select('_id email display_name')
      .lean();

    const userIds = admins.map((admin) => admin._id.toString());
    if (userIds.length === 0) return;

    const leadName = `${lead.first_name || 'Unknown'} ${lead.last_name || 'Lead'}`.trim();
    const title = `New lead captured: ${leadName}`;

    await Notification.create(
      userIds.map((userId) => ({
        userId: toObjectId(userId),
        provider: 'internal',
        type: 'new_lead',
        title,
        metadata: {
          contact_id: lead.contactId.toString(),
          deal_id: lead.dealId?.toString() ?? null,
          first_name: lead.first_name || null,
          last_name: lead.last_name || null,
          email: lead.email || null,
          phone: lead.phone || null,
          source: lead.source || 'web-capture',
          company: lead.company || null
        }
      }))
    );

    for (const userId of userIds) {
      emitNotification(userId, {
        provider: 'internal',
        title,
        createdAt: new Date()
      });
    }

    await sendNewLeadEmail(
      admins
        .map((admin) => ({
          address: admin.email,
          name: admin.display_name || ''
        }))
        .filter((recipient) => Boolean(recipient.address)),
      {
        leadName,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        company: lead.company
      }
    );
  } catch (error) {
    logger.warn({ err: error }, 'Failed to notify admins of new lead');
  }
};

/**
 * Create a lead from a public form submission (script tag / embed)
 * This endpoint is unauthenticated but requires a valid public key
 */
export const captureLead = async (req: PublicKeyRequest, res: Response): Promise<void> => {
  try {
    const organization = req.organization;
    if (!organization) {
      res.status(401).json({
        status: false,
        message: 'Organization not found'
      });
      return;
    }

    const body = req.body;

    logger.info({ body: JSON.stringify(body) }, 'Public lead capture — received body');

    const pick = <T>(...keys: string[]): T | undefined => {
      for (const key of keys) {
        const value = (body as Record<string, unknown>)[key];
        if (value !== undefined && value !== null && value !== '') return value as T;
      }
      return undefined;
    };

    const email = pick<string>('email');
    const phone = pick<string>('phone');
    const company = pick<string>('company');
    const message = pick<string>('message');
    const source = pick<string>('source');
    const temperature = pick<'hot' | 'warm' | 'cold'>('temperature');
    const rawTags = pick<string | string[]>('tags');

    const customTags = Array.isArray(rawTags)
      ? rawTags
      : rawTags
        ? String(rawTags).split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];

    let first_name = pick<string>('first_name', 'firstname', 'firstName', 'first', 'First Name');
    let last_name = pick<string>('last_name', 'lastname', 'lastName', 'last', 'Last Name');

    if (!first_name || !last_name) {
      const fullNameCandidate = pick<string>(
        'name',
        'full_name',
        'fullname',
        'fullName',
        'full name',
        'FullName',
        'Name',
        'FULL_NAME',
        'FULLNAME',
        'FULL NAME'
      );

      logger.info({ fullNameCandidate, first_name, last_name }, 'Public lead capture — resolved name fields');

      if (fullNameCandidate) {
        const nameParts = String(fullNameCandidate).trim().split(/\s+/);
        if (!first_name) first_name = nameParts[0];
        if (!last_name) last_name = nameParts.slice(1).join(' ') || 'Lead';
      }
    } else {
      logger.info({ first_name, last_name }, 'Public lead capture — explicit first/last received');
    }

    if (!first_name && !last_name && !email && !phone) {
      res.status(400).json({
        status: false,
        message: 'At least one of name/full_name/fullname, first_name, last_name, email, or phone is required'
      });
      return;
    }

    const contact = await Contact.create({
      first_name: first_name || 'Unknown',
      last_name: last_name || 'Lead',
      email,
      phone,
      organization_id: organization._id,
      temperature: temperature || 'warm',
      tags: [...new Set(['web-capture', source || 'script-tag', ...customTags])]
    });

    const dealTitle = await generateLeadTitle({
      message,
      first_name,
      last_name,
      company,
      source
    });

    let deal = null;
    try {
      const defaultPipeline = await Pipeline.findOne({ organization_id: organization._id, is_default: true }).lean();
      const leadStage = defaultPipeline
        ? await PipelineStage.findOne({
            organization_id: organization._id,
            pipeline_id: defaultPipeline._id,
            name: LEAD_STAGE_NAME
          }).lean()
        : null;

      deal = await Deal.create({
        title: dealTitle,
        status: 'open',
        contact_id: contact._id,
        organization_id: organization._id,
        company_id: undefined,
        source: source || 'web-capture',
        description: message,
        stage_id: leadStage?._id,
        stage_changed_at: new Date()
      });
    } catch (dealError) {
      logger.warn({ err: dealError }, 'Failed to push public lead into pipeline, contact saved only');
    }

    await notifyAdminsOfNewLead(organization._id, {
      contactId: contact._id,
      dealId: deal?._id ?? null,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      source: source || 'web-capture',
      company
    });

    res.status(201).json({
      status: true,
      message: 'Lead captured successfully',
      data: {
        id: contact._id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        deal_id: deal?._id ?? null,
        deal_title: dealTitle
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Lead capture error');
    res.status(500).json({
      status: false,
      message: 'Failed to capture lead'
    });
  }
};
