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

type SendMinutesReadyEmailArgs = {
  toEmail: string;
  toName: string;
  groupName: string;
  title: string;
  summaryMarkdown: string;
  // groupId present → group deep-link; absent → the standalone-meeting page.
  groupId?: string | null;
  roomCode: string;
  minutesId: string;
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

/**
 * Renders the minutes summary markdown into simple, safe inline-styled HTML.
 * Handles the subset our summarizer emits: "## " headings, "- " bullets,
 * "**bold**" (with **[ACTION]** highlighted), and plain paragraphs.
 * The input is HTML-escaped before any tags are introduced.
 */
function renderSummaryHtml(markdown: string): string {
  const bold = (line: string) =>
    line
      .replaceAll('**[ACTION]**', '<span style="background:#fef3c7;color:#92400e;font-weight:700;padding:1px 6px;border-radius:4px">ACTION</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  const html: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  for (const rawLine of escapeHtml(markdown).split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith('## ')) {
      closeList();
      html.push(`<h3 style="margin:18px 0 8px;font-size:15px;color:#0f172a">${bold(line.slice(3))}</h3>`);
    } else if (line.startsWith('- ')) {
      if (!listOpen) {
        html.push('<ul style="margin:0 0 12px;padding-left:20px">');
        listOpen = true;
      }
      html.push(`<li style="margin:0 0 6px">${bold(line.slice(2))}</li>`);
    } else {
      closeList();
      html.push(`<p style="margin:0 0 12px">${bold(line)}</p>`);
    }
  }

  closeList();
  return html.join('\n');
}

export async function sendMinutesReadyEmail({
  toEmail,
  toName,
  groupName,
  title,
  summaryMarkdown,
  groupId,
  roomCode,
  minutesId,
}: SendMinutesReadyEmailArgs) {
  const transport = getTransport();
  const sender = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  const appUrl = process.env.APP_URL?.trim();

  if (!appUrl) {
    throw new Error('APP_URL is required to send minutes emails');
  }

  if (!transport || !sender) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`Minutes email not sent because SMTP is not configured. Preview recipient: ${toEmail}, minutes: ${minutesId}`);
      return { preview: true };
    }

    throw new Error('SMTP configuration is required to send minutes emails');
  }

  const safeToEmail = toEmail.trim();
  const safeToName = escapeHtml(toName.trim() || 'there');
  const safeGroupName = escapeHtml(groupName.trim());
  const safeTitle = escapeHtml(title.trim());
  const baseUrl = appUrl.replace(/\/$/, '');
  const minutesUrl = groupId
    ? `${baseUrl}/groups/${encodeURIComponent(groupId)}?minutes=${encodeURIComponent(minutesId)}`
    : `${baseUrl}/room/${encodeURIComponent(roomCode)}/minutes`;
  const safeMinutesUrl = escapeHtml(minutesUrl);

  await transport.sendMail({
    from: sender,
    to: safeToEmail,
    subject: `Minutes ready: ${title.trim()}`,
    text: [
      `Hi ${toName.trim() || 'there'},`,
      '',
      `AI meeting minutes for "${title.trim()}" (${groupName.trim()}) are ready.`,
      `Read them here: ${minutesUrl}`,
      '',
      summaryMarkdown,
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a;max-width:640px">
        <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a">Meeting minutes are ready</h2>
        <p style="margin:0 0 12px">Hi ${safeToName},</p>
        <p style="margin:0 0 16px">AI minutes for <strong>${safeTitle}</strong> in <strong>${safeGroupName}</strong> are ready.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin:0 0 20px">
          ${renderSummaryHtml(summaryMarkdown)}
        </div>
        <p style="margin:0 0 20px">
          <a href="${safeMinutesUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">
            View full minutes
          </a>
        </p>
        <p style="margin:0;color:#475569">Includes the full transcript and downloadable notes.</p>
      </div>
    `,
  });

  return {};
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
