/* =========================================================================
   KGROUP — Transactional email (replaces Supabase Auth's built-in mailer)
   -------------------------------------------------------------------------
   Supabase sent confirmation and password-reset emails for us. Neon does not
   send email, so delivery goes through Resend (https://resend.com) when
   RESEND_API_KEY is configured.

   When it is NOT configured, send() reports `delivered: false` and logs the
   link to the server console. Callers must still answer the browser with the
   same generic success message — telling an anonymous caller whether an email
   actually went out would leak which addresses have accounts.
   ========================================================================= */
"use strict";

const API_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "KGROUP <onboarding@resend.dev>";

const isConfigured = () => Boolean(API_KEY);

/**
 * @returns {Promise<{delivered: boolean, reason?: string}>}
 */
async function send({ to, subject, html, text }) {
  if (!isConfigured()) {
    console.warn(
      `[mail] RESEND_API_KEY not set — email to ${to} was not sent.\n` +
        `[mail] Subject: ${subject}\n[mail] ${text || ""}`
    );
    return { delivered: false, reason: "not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[mail] Resend rejected the message (${res.status}): ${detail}`);
      return { delivered: false, reason: `provider_${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[mail] send failed:", err.message);
    return { delivered: false, reason: "network_error" };
  }
}

function resetEmail(link) {
  return {
    subject: "Reset your KGROUP password",
    text: `Reset your KGROUP password using this link (valid for 60 minutes):\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:520px">` +
      `<h2 style="color:#0B7A4B">Reset your KGROUP password</h2>` +
      `<p>Click the button below to choose a new password. The link is valid for 60 minutes.</p>` +
      `<p><a href="${link}" style="display:inline-block;background:#0B7A4B;color:#fff;` +
      `padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Reset password</a></p>` +
      `<p style="color:#666;font-size:13px">If you did not request this, you can safely ignore this email.</p>` +
      `</div>`,
  };
}

module.exports = { send, isConfigured, resetEmail };
