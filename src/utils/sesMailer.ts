/**
 * Send a single email through Amazon SES.
 * Used by broadcasts and email triggers (system mail still goes through Ensend).
 */
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import config from '../config';
import { getSesClient } from '../config/ses';

export interface SesEmail {
  to: string;
  subject: string;
  html: string;
  /** Sender display name — defaults to SES_FROM_NAME */
  fromName?: string;
  replyTo?: string;
  /** One-click unsubscribe URL, sent as List-Unsubscribe (RFC 8058) */
  unsubscribeUrl?: string;
  /** Tags surface in SES event notifications */
  tags?: Record<string, string>;
}

/** SES tag values allow only [A-Za-z0-9_-.@] */
const sanitizeTag = (value: string): string => value.replace(/[^A-Za-z0-9_\-.@]/g, '_').slice(0, 256);

/** Strip characters that would break the RFC 5322 display-name quoting */
const formatFrom = (name: string | undefined, address: string): string => {
  const clean = name?.replace(/["\r\n\\]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
};

export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Returns the SES message id */
export const sendSesEmail = async (email: SesEmail): Promise<string> => {
  const headers = email.unsubscribeUrl
    ? [
        { Name: 'List-Unsubscribe', Value: `<${email.unsubscribeUrl}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
      ]
    : undefined;

  const result = await getSesClient().send(
    new SendEmailCommand({
      FromEmailAddress: formatFrom(email.fromName ?? config.SES_FROM_NAME, config.SES_FROM_EMAIL!),
      Destination: { ToAddresses: [email.to] },
      ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
      ConfigurationSetName: config.SES_CONFIGURATION_SET || undefined,
      EmailTags: email.tags
        ? Object.entries(email.tags).map(([Name, Value]) => ({ Name: sanitizeTag(Name), Value: sanitizeTag(Value) }))
        : undefined,
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: email.html, Charset: 'UTF-8' },
            Text: { Data: htmlToText(email.html), Charset: 'UTF-8' }
          },
          Headers: headers
        }
      }
    })
  );

  return result.MessageId ?? '';
};
