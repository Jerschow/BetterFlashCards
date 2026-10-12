// Server routes only: the admin key must never be imported into browser code.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "./ai";

const COOKIE = "heron_guest_trial";
export const GUEST_CARD_LIMIT = 10;
export type GuestAllowance = { limit: number; used: number; pending: number; remaining: number };
export type GenerationAccess = { count: number; complete: () => Promise<GuestAllowance | null>; cancel: () => Promise<void> };

export function guestStore() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new AppError("Guest AI is not configured yet. Please sign in, or ask the site owner to finish the guest-trial setup.", 503);
  // A separate admin client. Never attach an end user's bearer token to it.
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export function requireGuestOrigin(request: Request) {
  let expected: string;
  try { expected = new URL(process.env.APP_ORIGIN || "").origin; }
  catch { throw new AppError("The site's APP_ORIGIN setting must be configured for guest AI.", 503); }
  if (request.headers.get("origin") !== expected) throw new AppError("Guest requests must come from this website.", 403);
}
export function guestId(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
export function allowance(row: { cards_used: number; cards_reserved: number }): GuestAllowance {
  return { limit: GUEST_CARD_LIMIT, used: row.cards_used, pending: row.cards_reserved, remaining: Math.max(0, GUEST_CARD_LIMIT - row.cards_used - row.cards_reserved) };
}
export async function readGuest(store: ReturnType<typeof guestStore>, id: string) {
  const { data, error } = await store.from("guest_ai_trials").select("cards_used,cards_reserved").eq("id", id).maybeSingle();
  if (error) throw new AppError("The guest allowance could not be checked. Please retry, or sign in.", 503);
  return data ? allowance(data) : null;
}
export async function openGuestTrial(request: Request): Promise<Response> {
  requireGuestOrigin(request);
  const store = guestStore();
  let id = guestId(request);
  let status = id ? await readGuest(store, id) : null;
  if (!status) {
    id = randomUUID();
    const { error } = await store.from("guest_ai_trials").insert({ id });
    if (error) throw new AppError("The guest trial could not start. Please sign in, or ask the site owner to run the guest-trial SQL setup.", 503);
    status = allowance({ cards_used: 0, cards_reserved: 0 });
  }
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  return Response.json({ guest: status }, { headers: {
    "Cache-Control": "private, no-store", "Vary": "Cookie",
    "Set-Cookie": `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000${secure ? "; Secure" : ""}`,
  } });
}
export async function authorizeGuest(request: Request): Promise<void> {
  requireGuestOrigin(request);
  const id = guestId(request);
  if (!id) throw new AppError("Please allow this website's cookies to start your guest trial, or sign in.", 401);
  const { error } = await guestStore().rpc("claim_guest_ai_request", { trial_id: id });
  if (error?.message.includes("GUEST_RATE_LIMIT")) throw new AppError("You have reached the guest AI request limit. Please try again later or sign in.", 429);
  if (error?.message.includes("GUEST_TRIAL_MISSING")) throw new AppError("Your guest trial could not be found. Refresh the page or sign in.", 401);
  if (error) throw new AppError("The guest allowance could not be checked. Please retry, or sign in.", 503);
}
export async function reserveGuestGeneration(request: Request, requestedCount: number): Promise<GenerationAccess> {
  const id = guestId(request);
  if (!id) throw new AppError("Please sign in or start your guest trial.", 401);
  const store = guestStore();
  const { data, error } = await store.rpc("reserve_guest_cards", { trial_id: id, requested_count: requestedCount });
  if (error?.message.includes("GUEST_CARD_LIMIT")) throw new AppError("Your 10 guest cards have been used or are being prepared. Sign in or create an account to generate more.", 403);
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || typeof row.reservation_id !== "string" || !Number.isInteger(row.card_count) || row.card_count < 1 || row.card_count > requestedCount) throw new AppError("The guest card allowance could not be reserved. Please retry or sign in.", 503);
  let finished = false;
  return {
    count: row.card_count,
    complete: async () => {
      const { error: finishError } = await store.rpc("finish_guest_cards", { trial_id: id, reservation: row.reservation_id, succeeded: true });
      if (finishError) throw new AppError("The guest card allowance could not be saved. Please retry later or sign in.", 503);
      finished = true;
      // Failure to refresh a display must not discard successfully generated cards.
      return readGuest(store, id).catch(() => null);
    },
    cancel: async () => {
      if (finished) return;
      // An unavailable database leaves the reservation in place (fail closed).
      try { await store.rpc("finish_guest_cards", { trial_id: id, reservation: row.reservation_id, succeeded: false }); }
      catch { /* Keep the reserved allowance if the database is unreachable. */ }
    },
  };
}
