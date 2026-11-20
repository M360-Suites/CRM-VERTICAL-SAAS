import { Deal } from '../models/Deal';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { PipelineStage } from '../models/Pipeline';
import { logger } from '../config/logger';
import { syncCompanyContactPerson } from '../services/companyContactSync';

/**
 * Repairs data written before won-revenue and contact sync were fixed.
 * Idempotent: after the first run each step matches nothing.
 *  1. Deals sitting in a Won/Lost stage whose status is still "open".
 *  2. Deals linked to a contact but no company inherit the contact's company.
 *  3. Companies whose contact_person never became a Contact.
 */
export const backfillWonRevenue = async (): Promise<void> => {
  try {
    const [wonStageIds, lostStageIds] = await Promise.all([
      PipelineStage.distinct('_id', { is_won: true }),
      PipelineStage.distinct('_id', { is_lost: true })
    ]);

    const [won, lost] = await Promise.all([
      Deal.updateMany({ stage_id: { $in: wonStageIds }, status: { $ne: 'won' } }, { $set: { status: 'won' } }),
      Deal.updateMany({ stage_id: { $in: lostStageIds }, status: { $ne: 'lost' } }, { $set: { status: 'lost' } })
    ]);
    if (won.modifiedCount || lost.modifiedCount) {
      logger.info(`Backfilled deal status: ${won.modifiedCount} won, ${lost.modifiedCount} lost`);
    }

    const orphanDeals = await Deal.find({
      contact_id: { $ne: null },
      $or: [{ company_id: { $exists: false } }, { company_id: null }]
    }).select('contact_id organization_id').lean();

    if (orphanDeals.length > 0) {
      const contacts = await Contact.find({
        _id: { $in: orphanDeals.flatMap((deal) => (deal.contact_id ? [deal.contact_id] : [])) },
        company_id: { $ne: null }
      }).select('company_id organization_id').lean();
      const companyByContact = new Map(contacts.map((c) => [String(c._id), c]));

      const ops = orphanDeals.flatMap((deal) => {
        const contact = companyByContact.get(String(deal.contact_id));
        if (!contact?.company_id || String(contact.organization_id) !== String(deal.organization_id)) return [];
        return [{ updateOne: { filter: { _id: deal._id }, update: { $set: { company_id: contact.company_id } } } }];
      });
      if (ops.length > 0) {
        const result = await Deal.bulkWrite(ops);
        logger.info(`Linked ${result.modifiedCount} deal(s) to their contact's company`);
      }
    }

    const companies = await Company.find({ contact_person: { $nin: [null, ''] } })
      .select('organization_id contact_person email phone owner_id')
      .lean();
    for (const company of companies) {
      await syncCompanyContactPerson(company);
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to backfill won revenue / company contacts');
  }
};
