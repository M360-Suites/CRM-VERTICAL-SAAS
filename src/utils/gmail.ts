import { google } from 'googleapis';
import config from '../config';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];

export const getEmailOAuth2Client = (): any => {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_EMAIL_REDIRECT_URI
  );
};

export const getAuthedGmail = (accessToken: string, refreshToken: string) => {
  const oauth2Client = getEmailOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.gmail({ version: 'v1', auth: oauth2Client });
};

const sanitizeHeader = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').trim();

const chunkBase64 = (value: string): string =>
  value.match(/.{1,76}/g)?.join('\r\n') || value;

const formatAddress = (recipient: { address: string; name?: string }): string => {
  const address = sanitizeHeader(recipient.address);
  const name = sanitizeHeader(recipient.name || '');
  if (!name) return address;

  return `"${name.replace(/"/g, '\\"')}" <${address}>`;
};

export type RawEmailAttachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

export const createRawEmail = (input: {
  from: { address: string; name?: string };
  to: Array<{ address: string; name?: string }>;
  subject: string;
  body: string;
  attachments?: RawEmailAttachment[];
}): string => {
  const attachments = input.attachments || [];
  const headers = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(', ')}`,
    `Subject: ${sanitizeHeader(input.subject)}`,
    'MIME-Version: 1.0'
  ];

  if (attachments.length === 0) {
    headers.push(
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit'
    );

    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  const boundary = `crm360_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
    ...attachments.flatMap((attachment) => {
      const filename = sanitizeHeader(attachment.filename || 'document');
      const mimeType = sanitizeHeader(attachment.mimeType || 'application/octet-stream');
      return [
        `--${boundary}`,
        `Content-Type: ${mimeType}; name="${filename.replace(/"/g, '\\"')}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${filename.replace(/"/g, '\\"')}"`,
        '',
        chunkBase64(attachment.content.toString('base64'))
      ];
    }),
    `--${boundary}--`
  ];

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};
