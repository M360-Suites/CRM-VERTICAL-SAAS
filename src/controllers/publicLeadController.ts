import { Response } from 'express';
import { Contact } from '../models/Contact';
import { PublicKeyRequest } from '../middleware/publicAuth';

interface LeadCaptureBody {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  source?: string;
  temperature?: 'hot' | 'warm' | 'cold';
}

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

    const {
      first_name,
      last_name,
      email,
      phone,
      company,
      message,
      source,
      temperature
    }: LeadCaptureBody = req.body;

    if (!first_name && !last_name && !email && !phone) {
      res.status(400).json({
        status: false,
        message: 'At least one of first_name, last_name, email, or phone is required'
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

    res.status(201).json({
      status: true,
      message: 'Lead captured successfully',
      data: {
        id: contact._id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email
      }
    });
  } catch (error) {
    console.error('Lead capture error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to capture lead'
    });
  }
};
