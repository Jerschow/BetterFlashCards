"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseData, type AppData } from "./model";

let client: SupabaseClient | null | undefined;

export function getCloudClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }) : null;
  return client;
}

export async function apiHeaders(): Promise<Record<string, string>> {
  const cloud = getCloudClient();
  if (!cloud) return {};
  const { data, error } = await cloud.auth.getSession();
  if (error) throw new Error("Please sign in again before using AI practice.");
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

/** Keep the access token on this app's origin. Returns a normal fetch Response. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (typeof window !== "undefined" && new URL(raw, window.location.origin).origin !== window.location.origin) {
    throw new Error("Authenticated requests must stay on this website.");
  }
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(await apiHeaders())) headers.set(key, value);
  return fetch(input, { ...init, headers });
}

export type CloudRecord = { snapshot: AppData | null; revision: number; updatedAt: string | null };

export class SyncConflictError extends Error {
  constructor() { super("Another device saved a newer copy. Choose which copy to use before syncing again."); this.name = "SyncConflictError"; }
}

async function clientForUser(userId: string): Promise<SupabaseClient> {
  const cloud = getCloudClient();
  if (!cloud) throw new Error("Account storage is not configured yet.");
  const { data: authData, error: authError } = await cloud.auth.getSession();
  if (authError || authData.session?.user.id !== userId) throw new Error("Your account changed. Sign in again before syncing.");
  // Pin every operation to the checked token, including reads during an account switch.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function readCloudState(userId: string): Promise<CloudRecord> {
  const cloud = await clientForUser(userId);
  const { data, error } = await cloud.from("user_learning_state")
    .select("snapshot, revision, updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Could not load your account: ${error.message}`);
  if (!data) return { snapshot: null, revision: 0, updatedAt: null };
  const parsed = parseData(data.snapshot);
  if (!parsed) throw new Error("Your account contains an unsupported or damaged save. It has not been overwritten. Export your device copy and contact the site owner.");
  const revision = Number(data.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("The cloud save has an invalid revision. It has not been overwritten.");
  return { snapshot: parsed, revision, updatedAt: data.updated_at };
}

export async function writeCloudState(userId: string, expectedRevision: number, snapshot: AppData): Promise<CloudRecord> {
  const writer = await clientForUser(userId);
  const { data, error } = await writer.rpc("save_learning_state", { expected_revision: expectedRevision, new_snapshot: snapshot });
  if (error?.message.includes("SYNC_CONFLICT")) throw new SyncConflictError();
  if (error) throw new Error(`Cloud save failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const revision = Number(row?.revision);
  if (!Number.isSafeInteger(revision) || revision <= expectedRevision) throw new Error("The cloud save could not be confirmed. Your device copy is still available.");
  return { snapshot, revision, updatedAt: row.updated_at ?? new Date().toISOString() };
}
