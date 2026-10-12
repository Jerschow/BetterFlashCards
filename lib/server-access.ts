// Server routes only. Never import this module from a client component.
import { createClient } from "@supabase/supabase-js";
import { authorizeGuest, reserveGuestGeneration, type GenerationAccess } from "./guest-server";

export class AccessError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "AccessError"; }
}

const localUsage = { minute: 0, minuteCount: 0, day: "", dayCount: 0 };
const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());

function localRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const url = new URL(request.url);
  if (!loopback(url.hostname)) return false;
  const host = request.headers.get("host");
  if (host) {
    try { if (!loopback(new URL(`${url.protocol}//${host}`).hostname)) return false; }
    catch { return false; }
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    return loopback(source.hostname) && source.protocol === url.protocol && source.port === url.port;
  } catch { return false; }
}

function localQuota() {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const day = new Date(now).toISOString().slice(0, 10);
  if (minute !== localUsage.minute) { localUsage.minute = minute; localUsage.minuteCount = 0; }
  if (day !== localUsage.day) { localUsage.day = day; localUsage.dayCount = 0; }
  if (localUsage.minuteCount >= 12 || localUsage.dayCount >= 200) throw new AccessError("You have reached the local AI request limit. Please try again later.", 429);
  localUsage.minuteCount += 1;
  localUsage.dayCount += 1;
}

/** Hosted AI uses a verified account or a cookie-backed, database-limited guest trial. */
export async function authorizeAI(request: Request, options: { premium?: boolean } = {}): Promise<"local" | "account" | "guest"> {
  if (localRequest(request)) {
    if (options.premium && process.env.ENABLE_MNEMONIC_PREVIEW !== "true") {
      throw new AccessError("Character stories are a premium preview. The site owner can enable the local preview in the environment settings.", 403);
    }
    localQuota();
    return "local";
  }
  const origin = request.headers.get("origin");
  const configuredOrigin = process.env.APP_ORIGIN;
  if (!configuredOrigin) throw new AccessError("Hosted AI is not configured yet. The site owner must set APP_ORIGIN and account storage.", 503);
  let allowedOrigin: string;
  try { allowedOrigin = new URL(configuredOrigin).origin; }
  catch { throw new AccessError("The site's APP_ORIGIN setting is invalid.", 503); }
  if (origin && origin !== allowedOrigin) throw new AccessError("Requests must come from this website.", 403);
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer ([^\s]+)$/i.exec(header)?.[1];
  if (!header) {
    if (options.premium) throw new AccessError("Please sign in to use character stories.", 401);
    await authorizeGuest(request);
    return "guest";
  }
  if (!token || token.length > 8192) throw new AccessError("Please sign in again to use AI practice.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AccessError("Account storage is not configured yet.", 503);
  const cloud = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await cloud.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new AccessError("Your sign-in has expired. Please sign in again.", 401);
  if (options.premium) {
    const { data: entitlement, error: entitlementError } = await cloud.from("user_entitlements")
      .select("feature, expires_at").eq("user_id", data.user.id).eq("feature", "mnemonics").maybeSingle();
    if (entitlementError) throw new AccessError("Premium access could not be checked. Please try again later.", 503);
    if (!entitlement || (entitlement.expires_at && new Date(entitlement.expires_at).getTime() <= Date.now())) {
      throw new AccessError("Character stories require premium access. Billing is not enabled in this starter; the site owner can grant access to a test account.", 403);
    }
  }
  const { error: quotaError } = await cloud.rpc("claim_ai_request");
  if (quotaError?.message.includes("AI_QUOTA_EXCEEDED")) throw new AccessError("You have reached your AI request limit. Please try again later.", 429);
  if (quotaError) throw new AccessError("Your AI allowance could not be checked. Please try again later.", 503);
  return "account";
}

/** Reserve cards separately from the ordinary request rate limit. */
export async function authorizeGeneration(request: Request, count: number): Promise<GenerationAccess> {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new AccessError("Choose between 1 and 10 cards.", 400);
  const identity = await authorizeAI(request);
  if (identity === "guest") return reserveGuestGeneration(request, count);
  return { count, complete: async () => null, cancel: async () => {} };
}
