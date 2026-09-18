/**
 * Origin used in invite links / magic-link redirects for travellers.
 * Prefer NEXT_PUBLIC_APP_URL so localhost testing still shares the live Netlify link.
 */
export function publicAppOrigin(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return "";

  const origin = window.location.origin;
  if (/localhost|127\.0\.0\.1/i.test(origin)) {
    // Live site — override with NEXT_PUBLIC_APP_URL if this changes
    return "https://tripreaddyy.netlify.app";
  }
  return origin;
}

export function isLocalDevOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return /localhost|127\.0\.0\.1/i.test(window.location.origin);
}
