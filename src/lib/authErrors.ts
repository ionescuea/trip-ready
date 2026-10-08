/** Friendlier copy for Supabase Auth errors. */
export function formatAuthError(raw?: string | null): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "Something went wrong. Try again.";
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) {
    return "Sign-in failed. Use Create account if you haven’t yet — or in Supabase Auth → Users, confirm the user / set a password. Also turn Confirm email OFF under Auth → Providers → Email.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "That email already has an account — sign in instead.";
  }
  if (lower.includes("password should be at least") || lower.includes("password is known")) {
    return msg;
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email first — or turn off “Confirm email” in Supabase Auth settings if you haven’t set up SMTP yet.";
  }
  if (lower.includes("rate limit") || lower.includes("email rate limit")) {
    return "Too many attempts. Wait a bit and try again.";
  }
  if (lower.includes("pkce") || lower.includes("code verifier")) {
    return "That old magic-link email won’t work here. Use email and password on Account instead.";
  }
  return msg;
}
