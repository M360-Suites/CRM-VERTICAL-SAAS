/**
 * Amazon SES client (v2 API)
 * Lazily created so the server still boots when SES isn't configured —
 * broadcast and trigger sends fail with a clear error instead.
 */
import { SESv2Client } from '@aws-sdk/client-sesv2';
import config from './index';

let client: SESv2Client | null = null;

export const isSesConfigured = (): boolean => Boolean(config.AWS_REGION && config.SES_FROM_EMAIL);

export const getSesClient = (): SESv2Client => {
  if (!isSesConfigured()) {
    throw new Error('Amazon SES is not configured — set AWS_REGION and SES_FROM_EMAIL');
  }
  if (!client) client = new SESv2Client({ region: config.AWS_REGION });
  return client;
};
