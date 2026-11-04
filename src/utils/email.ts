import ensend from '../config/ensend';
import { getFrontendUrl } from './frontend';
import { renderSystemEmail, type SystemEmailName } from './systemEmailTemplates';

export interface EmailData {
  subject: string;
  message: string;
  mailType: 'text' | 'html';
  recipients: Array<{ address: string; name: string }>;
}

const sendMail = async (emailData: EmailData) => {
  const senderIdentity = {
    name: process.env.ENSEND_NAME ?? 'M360',
    address: process.env.ENSEND_MAIL ?? 'm360@ensend.me',
  };
  const recipients = emailData.recipients;

  try {
    const { data, error } = await ensend.SendApi.SendMailMessage({
      subject: emailData.subject,
      message: emailData.message,
      sender: senderIdentity,
      recipients,
    });

    if (error) throw error;
    console.log('Email Data: ', data);
    return data;
  } catch (error: any) {
    console.log('Error sending mail with ensend: ', error);
    throw error;
  }
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  sales_manager: 'Sales manager',
  sales_rep: 'Sales rep',
  viewer: 'Viewer'
};

const formatRoleLabel = (role: string): string =>
  roleLabels[role] ?? role.replace(/_/g, ' ');

/** Minutes an emailed verification / reset code stays valid (matches the OTP models' expiry) */
const OTP_EXPIRY_MINUTES = 10;

/** First name for greetings, falling back to the email's local part */
const greetingName = (fullName: string | undefined, email: string): string =>
  fullName?.trim() || email.split('@')[0];

const sendSystemEmail = async (
  name: SystemEmailName,
  recipients: Array<{ address: string; name?: string }>,
  data: Record<string, unknown>
): Promise<void> => {
  const rendered = renderSystemEmail(name, data);
  await sendMail({
    subject: rendered.subject,
    message: rendered.html,
    mailType: 'html',
    recipients: recipients.map((recipient) => ({ address: recipient.address, name: recipient.name ?? '' }))
  });
};

/** 02-reset-password — forgot-password code */
export const sendOTPEmail = async (to: string, otp: string, fullName?: string): Promise<void> => {
  await sendSystemEmail('reset-password', [{ address: to, name: fullName }], {
    full_name: greetingName(fullName, to),
    otp
  });
};

/** 03-staff-otp — staff login/session verification code */
export const sendStaffOtpEmail = async (
  to: string,
  otp: string,
  fullName?: string,
  expiresInMinutes = OTP_EXPIRY_MINUTES
): Promise<void> => {
  await sendSystemEmail('staff-otp', [{ address: to, name: fullName }], {
    full_name: greetingName(fullName, to),
    otp,
    expires_in_minutes: expiresInMinutes
  });
};

/** 04-welcome — account is fully active */
export const sendWelcomeEmail = async (to: string, fullName?: string): Promise<void> => {
  await sendSystemEmail('welcome', [{ address: to, name: fullName }], {
    full_name: greetingName(fullName, to)
  });
};

export interface NotificationDigestUpdate {
  /** Trusted HTML for the update line — escape any user-supplied parts before building it */
  html: string;
  /** Plain-text version of the same line */
  text: string;
  /** true = amber "action required" style */
  is_warning?: boolean;
}

/** 05-notification — digest of priority updates */
export const sendNotificationDigestEmail = async (
  to: string,
  input: { fullName?: string; updates: NotificationDigestUpdate[]; notificationsUrl?: string }
): Promise<void> => {
  if (input.updates.length === 0) return;
  await sendSystemEmail('notification', [{ address: to, name: input.fullName }], {
    full_name: greetingName(input.fullName, to),
    update_count: input.updates.length,
    updates: input.updates.map((update) => ({ ...update, is_warning: Boolean(update.is_warning) })),
    notifications_url: input.notificationsUrl ?? `${getFrontendUrl()}/notifications`
  });
};

export const sendTaskReminderEmail = async (
  recipients: Array<{ address: string; name: string }>,
  task: {
    title: string;
    type: string;
    priority: string;
    due_at: Date;
    description?: string;
    location?: string;
    meeting_url?: string;
  }
): Promise<void> => {
  const dueAt = task.due_at.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const optionalRows = [
    task.location ? `<p><strong>Location:</strong> ${escapeHtml(task.location)}</p>` : '',
    task.meeting_url
      ? `<p><strong>Meeting link:</strong> <a href="${escapeHtml(task.meeting_url)}">${escapeHtml(task.meeting_url)}</a></p>`
      : '',
    task.description ? `<p>${escapeHtml(task.description)}</p>` : ''
  ].join('');

  await sendMail({
    subject: `Upcoming task reminder: ${task.title}`,
    message: `
      <h2>Upcoming Task Reminder</h2>
      <p><strong>${escapeHtml(task.title)}</strong> is due on ${escapeHtml(dueAt)}.</p>
      <p><strong>Type:</strong> ${escapeHtml(task.type)}</p>
      <p><strong>Priority:</strong> ${escapeHtml(task.priority)}</p>
      ${optionalRows}
    `,
    mailType: 'html',
    recipients
  });
};

/** 01-verify-email — sign-up email verification code */
export const sendEmailVerificationOTP = async (to: string, otp: string, fullName?: string): Promise<void> => {
  await sendSystemEmail('verify-email', [{ address: to, name: fullName }], {
    full_name: greetingName(fullName, to),
    otp,
    expires_in_minutes: OTP_EXPIRY_MINUTES
  });
};

export const sendUserInvitationEmail = async (
  to: string,
  input: {
    organizationName: string;
    inviterName: string;
    inviteUrl: string;
    role: string;
    expiresAt: Date;
  }
): Promise<void> => {
  const expiresAt = input.expiresAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const roleLabel = formatRoleLabel(input.role);

  await sendMail({
    subject: `You're invited to join ${input.organizationName} on CRM360`,
    message: `
      <h2>You're invited to CRM360</h2>
      <p>${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.organizationName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>.</p>
      <p><a href="${escapeHtml(input.inviteUrl)}">Accept your invitation</a></p>
      <p>This invitation expires on ${escapeHtml(expiresAt)}.</p>
      <p>If you were not expecting this invite, you can ignore this email.</p>
    `,
    mailType: 'html',
    recipients: [{ address: to, name: '' }]
  });
};

export const sendStageCommentEmail = async (
  recipients: Array<{ address: string; name: string }>,
  input: {
    senderName: string;
    stageName: string;
    content: string;
    discussionUrl?: string;
  }
): Promise<void> => {
  const preview =
    input.content.length > 200 ? input.content.slice(0, 200) + '...' : input.content;

  await sendMail({
    subject: `${input.senderName} commented in ${input.stageName}`,
    message: `
      <h2>New comment in stage discuss</h2>
      <p><strong>${escapeHtml(input.senderName)}</strong> left a comment in <strong>${escapeHtml(input.stageName)}</strong>:</p>
      <blockquote style="border-left: 4px solid #cbd5e1; margin: 12px 0; padding: 8px 16px; color: #334155;">${escapeHtml(preview)}</blockquote>
      ${input.discussionUrl ? `<p><a href="${escapeHtml(input.discussionUrl)}">View the discussion</a></p>` : ''}
      <p style="color: #64748b; font-size: 13px;">You are receiving this because you are part of this pipeline stage.</p>
    `,
    mailType: 'html',
    recipients
  });
};

export const intentLabel = (score: number): string =>
  score >= 70 ? 'High Priority' : score >= 40 ? 'Medium Priority' : 'Low Priority';

const formatLeadValue = (value: number | undefined, currency: string | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Not provided';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString('en-US')} ${currency ?? ''}`.trim();
  }
};

/**
 * 06-new-lead — one email per recipient so each is greeted by name.
 * Best effort per recipient: one failed address doesn't stop the rest.
 */
export const sendNewLeadEmail = async (
  recipients: Array<{ address: string; name: string }>,
  input: {
    leadName: string;
    /** Job title, or company when no title is known */
    title?: string;
    company?: string;
    source?: string;
    value?: number;
    currency?: string;
    intentScore?: number;
    leadUrl?: string;
  }
): Promise<void> => {
  const score = Math.max(0, Math.min(100, Math.round(input.intentScore ?? 50)));
  const data = {
    lead_name: input.leadName,
    lead_title: input.title?.trim() || input.company?.trim() || 'Not provided',
    lead_est_arr: formatLeadValue(input.value, input.currency),
    lead_source: input.source?.trim() || 'Web capture',
    lead_intent_score: score,
    lead_intent_label: intentLabel(score),
    lead_url: input.leadUrl ?? `${getFrontendUrl()}/revenue-engine`
  };

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      sendSystemEmail('new-lead', [recipient], { ...data, full_name: greetingName(recipient.name, recipient.address) })
    )
  );
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length === results.length && failed.length > 0) {
    throw (failed[0] as PromiseRejectedResult).reason;
  }
};

export { sendMail };

export const sendStaleLeadReminderEmail = async (
  recipients: Array<{ address: string; name: string }>,
  input: {
    dealTitle: string;
    stageName: string;
    daysInStage: number;
    contactName?: string;
    companyName?: string;
    escalation?: boolean;
  }
): Promise<void> => {
  const suffix = input.escalation ? 'still stuck (5+ days)' : 'needs follow-up (2+ days)';
  const leadLine = [input.contactName, input.companyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' - ');

  await sendMail({
    subject: `${input.dealTitle} has been in ${input.stageName} for ${input.daysInStage}+ days`,
    message: `
      <h2>Deal ${suffix}</h2>
      <p>The deal <strong>${escapeHtml(input.dealTitle)}</strong> has been in the <strong>${escapeHtml(input.stageName)}</strong> stage for <strong>${escapeHtml(String(input.daysInStage))}+ days</strong>.</p>
      ${leadLine ? `<p>Lead: ${escapeHtml(leadLine)}</p>` : ''}
      <p>Please review this deal and either move it forward in the pipeline or follow up with the prospect.</p>
      <p style="color: #64748b; font-size: 13px;">You are receiving this because you are assigned to this pipeline stage or are an organization admin.</p>
    `,
    mailType: 'html',
    recipients
  });
};
