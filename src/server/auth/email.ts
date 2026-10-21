import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

function getTransporter() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  if (!host || !user || !pass) throw new Error("Email delivery is not configured");

  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE?.trim() === "true" || port === 465;
  transporter ??= nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) throw new Error("Email delivery is not configured");

  return getTransporter().sendMail({ from, to, subject, html });
}

export async function sendLoginOtp(email: string, otp: string) {
  return sendEmail(email, "Your SAPOMS login code", `
      <p>Your SAPOMS login code is:</p>
      <h1>${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    `);
}
