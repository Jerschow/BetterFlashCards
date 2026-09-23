# Heron: connect accounts and cloud progress

The account UI and database code are included. No Supabase project, outgoing email service, paid plan, or payment checkout has been provisioned for you. Heron works with browser storage and JSON exports before you complete this setup. Backups are under **Settings → Your backup**.

## 1. Create and configure the database

1. Create a project at [Supabase](https://supabase.com/). Keep its database password private.
2. Open the project's SQL Editor. Paste the complete contents of `supabase/schema.sql` and run it. This creates owner-only learning snapshots, premium entitlements, a protected usage table, and two narrowly scoped database functions.
3. In the project settings, copy the project URL and the **publishable key** (or the legacy `anon` key). The environment variable below retains the name `ANON_KEY`, but either browser-safe key type works. Never put a `service_role` or secret key into the app.
4. Enable email/password sign-in in Authentication. Keep email confirmation enabled for a public site. Set the minimum password length to at least 10, matching the registration form.
5. In Authentication → URL Configuration, set your Site URL and allowed Redirect URLs to your actual app origin. During local development add `http://127.0.0.1:3000` and, if you use it, `http://localhost:3000`. For deployment add the exact HTTPS origin. The app sends confirmation and recovery links back to the site root.
6. Configure a real SMTP provider before inviting the public. Supabase's default email delivery is for trying the service, has a low sending limit, and should not be treated as a production mail service. See [password authentication](https://supabase.com/docs/guides/auth/passwords) and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## 2. Set environment variables

Add these to your Next.js project's `.env.local` without deleting your existing OpenAI key:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
APP_ORIGIN=http://127.0.0.1:3000
ENABLE_MNEMONIC_PREVIEW=true
```

Restart the development server. Supabase's browser configuration uses `NEXT_PUBLIC_` variables, so changing it for a deployed build requires rebuilding/redeploying the app. Set `APP_ORIGIN` to the exact production HTTPS origin in your host's environment. Keep `OPENAI_API_KEY` server-only.

`ENABLE_MNEMONIC_PREVIEW=true` unlocks character stories only for local, nonproduction loopback requests. It cannot unlock the hosted paid feature. To disable even the local preview, remove it or set it to `false`.

## 3. Try the complete account flow

Select **Register** in the top-right header, then follow the confirmation email. Register is hidden while you are entering learning preferences; finish or leave that flow first. **Sign in** remains available from the header and welcome screen. Once signed in, open **Account**. The first connection explicitly asks which copy to use:

- **Use cloud copy** loads that account's decks and progress.
- **Use this account's device copy** recovers the saved browser copy for that specific account, including changes that have not reached the cloud.
- **Import guest copy** starts the account from the browser's guest decks. This replaces the cloud snapshot after confirmation; it does not merge it.

After you choose a copy, the app autosaves changes after a short pause. Wait for **Cloud copy is up to date** before changing devices. On the second device, sign in and choose **Use cloud copy**.

If two devices change the same cloud revision, the second save is rejected and syncing pauses. Choose **Check cloud and choose a copy**, export any data you want to retain, and explicitly select the copy you want. This starter uses complete snapshots and does not merge simultaneous edits. It also does not live-stream another device's edits into an active session: use **Check another device's changes** to load them.

Signing out returns to the previous guest decks. Guest storage and each account's browser storage have different keys. Browser storage is useful for recovery; it is not encryption or protection from someone else who uses the same browser profile. Use **Settings → Your backup → Export backup** for an independent copy. Importing a backup replaces the selected collection after confirmation. If an account's local save is unreadable, the original contents are retained under an `unreadable` backup key before that namespace is replaced.

For password recovery, use **Forgot password?**, follow the email to the app, open Account if needed, and choose a new password. The app responds to Supabase's `PASSWORD_RECOVERY` event and uses `updateUser` for the new password. Reset-request messages do not disclose whether an address has an account.

## 4. Hosted AI access and costs

Hosted AI endpoints require a validated Supabase bearer token. They verify it server-side with `getUser`; request bodies never determine the account identity. Browser requests must come from `APP_ORIGIN`. Token-bearing native clients can omit the browser Origin header, which keeps the same endpoint usable for a later mobile app.

`claim_ai_request()` atomically limits each account to **30 AI requests per UTC minute and 200 per UTC day**, shared across all AI features. It runs in the database, so separate app servers use the same counter. The allowance covers personalized vocabulary, new contexts, words captured from sentences, translation feedback, supplemental script/highlight requests and character stories. Requests consume allowance before generation, including attempts that later fail. Change these constants in the SQL function if your product's budget requires a different limit. Local guest development has a separate in-process **12/minute, 200/day** limit that resets when the server restarts.

These are per-account request limits, not a billing system or a sitewide spending ceiling. For a public launch, configure your AI provider's project spending controls and monitor usage. Public account creation can increase your total spend; decide your signup access, CAPTCHA, and plan limits before promotion. The starter includes no payment collection, subscription management, account deletion UI, or administrative dashboard. Account deletion can be performed in Supabase; foreign-key cascades remove the user's cloud snapshots, usage records, and entitlements.

## 5. Enable a test account's premium character stories

Copy the user's UUID from Authentication → Users. In the SQL Editor, run the commented entitlement example at the bottom of `supabase/schema.sql`, replacing the sample UUID. A `null` expiration means no expiry. Setting an expiration in the past revokes access. The browser cannot grant or extend its own entitlement.

There is no checkout yet. When you add billing, a verified payment webhook on your server should grant/revoke `mnemonics` access. Do not accept a browser's claim that it has paid.

## Data and verification boundaries

- `user_learning_state` holds one versioned JSON snapshot per user: decks, review history, skill levels, per-language goals and Chinese script preferences, exclusions, and writing progress. The Heron rename preserves existing browser storage keys and snapshot compatibility. SQL row-level security allows users to read only their own row.
- Updates go through `save_learning_state(expected_revision, new_snapshot)`. It derives the owner from `auth.uid()` and changes a row only when the revision matches. Ordinary authenticated clients have no direct write privilege on the table.
- Premium entitlements are readable only by their owner, and normal app users cannot write them. Usage counters are accessible only through the limited request-counting function.
- The application uses only the publishable/anon key and user access tokens. A server `service_role` key is not needed for normal operation. See [Supabase's row-level security guide](https://supabase.com/docs/guides/database/postgres/row-level-security).
- This delivery includes local code and database-rule checks. It has not been connected to your own Supabase project or tested with your real confirmation/recovery email provider. Verify registration, confirmation, recovery, two-device syncing, conflicting writes, and entitlement changes against your configured project before inviting users.

The JSON data model, scheduling logic, and authenticated HTTP endpoints are kept separate from the browser UI. A later native app can reuse these contracts while replacing browser storage, auth-session persistence, and the drawing surface with native equivalents.
