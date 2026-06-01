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

const formatAddress = (recipient: { address: string; name?: string }): string => {
  const address = sanitizeHeader(recipient.address);
  const name = sanitizeHeader(recipient.name || '');
  if (!name) return address;

  return `"${name.replace(/"/g, '\\"')}" <${address}>`;
};

export const createRawEmail = (input: {
  from: { address: string; name?: string };
  to: Array<{ address: string; name?: string }>;
  subject: string;
  body: string;
}): string => {
  const headers = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(', ')}`,
    `Subject: ${sanitizeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit'
  ];

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};
