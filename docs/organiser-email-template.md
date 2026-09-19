# Organiser email template (Supabase)

## Blocker without SMTP
Supabase shows **“Set up custom SMTP to edit templates”** — you cannot add `{{ .Token }}` until Resend (or similar) is configured. Deferred for after the trip.

## What we do instead (no template edit)
The app uses **implicit** auth flow so the default “Sign in” link works when opened from iPhone Mail (no PKCE code verifier).

## Later (Resend + editable template)
1. Set up Resend SMTP in Supabase
2. Magic link template:

```html
<h2>Your Trip Ready sign-in</h2>
<p>Enter this code in the app:</p>
<p style="font-size: 28px; letter-spacing: 4px;"><strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/account">Sign in to Trip Ready</a></p>
```

Site URL: `https://tripreaddyy.netlify.app`
