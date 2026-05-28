import nodemailer from 'nodemailer';

type SendOtpEmailArgs = {
  to: string;
  displayName: string;
  otp: string;
  expiresInMinutes?: number;
};

type SendMeetingStartedEmailArgs = {
  toEmail: string;
  toName: string;
  groupName: string;
  hostName: string;
  roomCode: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
};

let cachedTransport: nodemailer.Transporter | null = null;

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portValue = process.env.SMTP_PORT?.trim();
  const fromUser = process.env.SMTP_USER?.trim();
  const fromPass = process.env.SMTP_PASS?.trim();

  if (!host || !portValue) {
    return null;
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('SMTP_PORT must be a positive integer');
  }

  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE.toLowerCase() === 'true'
    : port === 465;

  const config: SmtpConfig = {
    host,
    port,
    secure,
  };

  if (fromUser && fromPass) {
    config.auth = {
      user: fromUser,
      pass: fromPass,
    };
  }

  return config;
}

function getTransport() {
  const config = getSmtpConfig();
  if (!config) {
    return null;
  }

  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport(config);
  }

  return cachedTransport;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendOtpEmail({ to, displayName, otp, expiresInMinutes = 10 }: SendOtpEmailArgs) {
  const transport = getTransport();
  const sender = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();

  if (!transport || !sender) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`OTP email not sent because SMTP is not configured. Preview code for ${to}: ${otp}`);
      return { previewCode: otp };
    }

    throw new Error('SMTP configuration is required to send OTP emails');
  }

  const safeDisplayName = escapeHtml(displayName.trim() || 'there');
  const safeOtp = escapeHtml(otp);
  const safeTo = to.trim();

  await transport.sendMail({
    from: sender,
    to: safeTo,
    subject: 'Your MeetAI verification code',
    text: [
      `Hi ${displayName.trim() || 'there'},`,
      '',
      `Your MeetAI verification code is ${otp}.`,
      `It expires in ${expiresInMinutes} minutes.`,
      '',
      'If you did not request this code, you can ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a">
        <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a">MeetAI verification code</h2>
        <p style="margin:0 0 12px">Hi ${safeDisplayName},</p>
        <p style="margin:0 0 16px">Your verification code is <strong style="font-size:22px;letter-spacing:0.2em">${safeOtp}</strong>.</p>
        <p style="margin:0 0 12px">It expires in ${expiresInMinutes} minutes.</p>
        <p style="margin:0;color:#475569">If you did not request this code, you can ignore this email.</p>
      </div>
    `,
  });

  return {};
}

export async function sendMeetingStartedEmail({
  toEmail,
  toName,
  groupName,
  hostName,
  roomCode,
}: SendMeetingStartedEmailArgs) {
  const transport = getTransport();
  const sender = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  const appUrl = process.env.APP_URL?.trim();

  if (!appUrl) {
    throw new Error('APP_URL is required to send meeting emails');
  }

  if (!transport || !sender) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`Meeting email not sent because SMTP is not configured. Preview recipient: ${toEmail}, room: ${roomCode}`);
      return { preview: true };
    }

    throw new Error('SMTP configuration is required to send meeting emails');
  }

  const safeToEmail = toEmail.trim();
  const safeToName = escapeHtml(toName.trim() || 'there');
  const safeGroupName = escapeHtml(groupName.trim());
  const safeHostName = escapeHtml(hostName.trim() || 'Someone');
  const joinUrl = `${appUrl.replace(/\/$/, '')}/room/${encodeURIComponent(roomCode)}`;
  const safeJoinUrl = escapeHtml(joinUrl);

  await transport.sendMail({
    from: sender,
    to: safeToEmail,
    subject: `[${groupName}] meeting has started`,
    text: [
      `Hi ${toName.trim() || 'there'},`,
      '',
      `${hostName.trim() || 'Someone'} started a meeting in ${groupName.trim()}.`,
      `Click to join: ${joinUrl}`,
      'This link is valid as long as the meeting is active.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a">
        <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a">[${safeGroupName}] meeting has started</h2>
        <p style="margin:0 0 12px">Hi ${safeToName},</p>
        <p style="margin:0 0 16px">${safeHostName} started a meeting in ${safeGroupName}.</p>
        <p style="margin:0 0 20px">
          <a href="${safeJoinUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">
            Click to join
          </a>
        </p>
        <p style="margin:0;color:#475569">This link is valid as long as the meeting is active.</p>
      </div>
    `,
  });

  return {};
}
