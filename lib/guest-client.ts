"use client";
export type GuestAllowance = { limit: number; used: number; pending: number; remaining: number };
export const GUEST_EVENT = "heron:guest-allowance";
let loading: Promise<GuestAllowance> | null = null;
let latest: GuestAllowance | null = null;

/** One trial cookie per browser; this cache only drives UI, never authorizes AI. */
export async function refreshGuestTrial(): Promise<GuestAllowance> {
  if (loading) return loading;
  const load = async () => {
    const response = await fetch("/api/guest", { method: "POST", credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.guest) throw new Error(data?.error || "The guest allowance could not be checked. Please sign in or retry.");
    latest = data.guest;
    window.dispatchEvent(new CustomEvent(GUEST_EVENT, { detail: latest }));
    return latest!;
  };
  // Serialize initial cookie creation between tabs where Web Locks is available.
  loading = (async () => {
    if (typeof navigator !== "undefined" && navigator.locks) return await navigator.locks.request("heron-guest-trial", load);
    return load();
  })().finally(() => { loading = null; });
  return loading;
}
export async function ensureGuestTrial() { return latest ?? refreshGuestTrial(); }
