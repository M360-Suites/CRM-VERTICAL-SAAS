import { Response } from 'express';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { Pipeline, PipelineStage } from '../models/Pipeline';
import { generateLeadTitle } from '../utils/groq';
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
  [key: string]: unknown;
}

const LEAD_STAGE_NAME = 'Lead';

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
      tags: ['web-capture', source || 'script-tag']
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
