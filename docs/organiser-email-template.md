# Organiser email template (Supabase)

iPhone Mail opens magic links in a **different browser** than Safari/Chrome, so PKCE links fail with “code verifier not found”.

## Fix (2 minutes)

1. Supabase → **Authentication → Email Templates → Magic link**
2. Replace the body with:

```html
<h2>Your Trip Ready sign-in</h2>
<p>Enter this code in the app (same page where you requested it):</p>
<p style="font-size: 28px; letter-spacing: 4px;"><strong>{{ .Token }}</strong></p>
<p>Or tap this link (works from Mail):</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/account">Sign in to Trip Ready</a></p>
```

3. Ensure **Site URL** is `https://tripreaddyy.netlify.app`
4. Save

Then on Account: **Email me a code** → type the 6 digits on that same page.
