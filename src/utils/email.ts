import ensend from '../config/ensend';

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

export const sendOTPEmail = async (to: string, otp: string): Promise<void> => {
  await sendMail({
    subject: 'Your Password Reset OTP',
    message: `
      <h2>Password Reset Request</h2>
      <p>Your OTP code is:</p>
      <h1 style="letter-spacing: 8px; font-family: monospace;">${otp}</h1>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not request this, please ignore this email.</p>
    `,
    mailType: 'html',
    recipients: [{ address: to, name: '' }]
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

export const sendEmailVerificationOTP = async (to: string, otp: string): Promise<void> => {
  await sendMail({
    subject: 'Verify your CRM360 email',
    message: `
      <h2>Verify Your Email</h2>
      <p>Use this code to finish creating your CRM360 account:</p>
      <h1 style="letter-spacing: 8px; font-family: monospace;">${otp}</h1>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not create an account, please ignore this email.</p>
    `,
    mailType: 'html',
    recipients: [{ address: to, name: '' }]
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

export { sendMail };
