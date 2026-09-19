/** Friendlier copy for Supabase Auth / OTP errors. */
export function formatAuthError(raw?: string | null): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "Something went wrong. Try again.";
  const lower = msg.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("email rate limit")) {
    return "Too many sign-in emails sent. Supabase only allows a few per hour — wait about an hour, or open a link already in your inbox.";
  }
  if (lower.includes("over_email_send_rate_limit")) {
    return "Too many sign-in emails sent. Wait about an hour, or use a link already in your inbox.";
  }
  if (lower.includes("pkce") || lower.includes("code verifier")) {
    return "That email link was opened in a different browser (common on iPhone Mail). Go to Account and enter the 6-digit code from the email instead.";
  }
  return msg;
}
