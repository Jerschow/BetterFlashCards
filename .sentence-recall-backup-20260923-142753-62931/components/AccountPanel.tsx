"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { parseData, type AppData } from "../lib/model";
import { getCloudClient, readCloudState, writeCloudState, SyncConflictError, type CloudRecord } from "../lib/cloud";

export type AccountIdentity = { storageKey: string; userId: string | null; data: AppData };
type Props = {
  data: AppData;
  onLoad: (data: AppData) => void;
  onIdentityChange?: (identity: AccountIdentity) => void;
};
type Phase = "out" | "loading" | "choice" | "active" | "conflict" | "paused";
type Active = { userId: string; revision: number; signature: string };

export default function AccountPanel({ data, onLoad, onIdentityChange }: Props) {
  const [cloud] = useState(getCloudClient);
  const [user, setUser] = useState<User | null>(null);
  const [phase, setPhase] = useState<Phase>("out");
  const [record, setRecord] = useState<CloudRecord | null>(null);
  const [deviceRecord, setDeviceRecord] = useState<AppData | null>(null);
  const [deviceProblem, setDeviceProblem] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "reset" | "recover">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveVersion, setSaveVersion] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const active = useRef<Active | null>(null);
  const inflight = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const currentData = useRef(data);
  const guestCopy = useRef(data);
  const activated = useRef(false);
  const unreadableLocal = useRef<{ userId: string; raw: string } | null>(null);
  const awaitingSignature = useRef<string | null>(null);
  const identityCallback = useRef(onIdentityChange);
  const loadCallback = useRef(onLoad);
  currentData.current = data;
  identityCallback.current = onIdentityChange;
  loadCallback.current = onLoad;
  const signature = JSON.stringify(data);

  const publishIdentity = useCallback((identity: AccountIdentity) => {
    if (identityCallback.current) identityCallback.current(identity);
    else loadCallback.current(identity.data);
  }, []);

  const loadAccount = useCallback(async (userId: string, ticket: number) => {
    try {
      const next = await readCloudState(userId);
      if (!mounted.current || ticket !== epoch.current) return;
      setDeviceRecord(null); setDeviceProblem(""); unreadableLocal.current = null;
      try {
        const raw = localStorage.getItem(`sentence-recall.v2.${userId}`);
        if (raw) {
          let parsed: AppData | null = null;
          try { parsed = parseData(JSON.parse(raw)); } catch { /* Keep the original bytes. */ }
          if (parsed) setDeviceRecord(parsed);
          else {
            unreadableLocal.current = { userId, raw };
            setDeviceProblem("This account's device save cannot be read. Its original contents will be backed up in this browser before you select another copy.");
          }
        }
      } catch { setDeviceProblem("This browser does not allow device storage. Export important changes regularly."); }
      setRecord(next); setPhase("choice"); setMessage("");
    } catch (error) {
      if (!mounted.current || ticket !== epoch.current) return;
      setPhase("paused"); setMessage(error instanceof Error ? error.message : "Could not load your cloud save.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!cloud) return () => { mounted.current = false; };
    let previousUser: string | null | undefined;
    const receive = (session: Session | null, recovery = false) => {
      if (!mounted.current) return;
      if (recovery) { setMode("recover"); setMessage("Choose a new password for your account."); }
      const nextUser = session?.user ?? null;
      if (previousUser === nextUser?.id || (previousUser === null && !nextUser)) return;
      previousUser = nextUser?.id ?? null;
      const ticket = ++epoch.current;
      active.current = null; inflight.current = false; awaitingSignature.current = null;
      setSaving(false); setUser(nextUser); setRecord(null); setSavedAt(null);
      if (!nextUser) {
        if (activated.current) publishIdentity({ storageKey: "sentence-recall.v2", userId: null, data: guestCopy.current });
        activated.current = false;
        setPhase("out");
        return;
      }
      // A switch between accounts starts from the guest copy, never the other person's decks.
      if (activated.current) {
        publishIdentity({ storageKey: "sentence-recall.v2", userId: null, data: guestCopy.current });
        activated.current = false;
      } else guestCopy.current = currentData.current;
      setPhase("loading");
      // Do not make another Supabase auth call while inside its auth event lock.
      setTimeout(() => { void loadAccount(nextUser.id, ticket); }, 0);
    };
    const { data: subscription } = cloud.auth.onAuthStateChange((event, session) => receive(session, event === "PASSWORD_RECOVERY"));
    void cloud.auth.getSession().then(({ data: result, error }) => {
      if (error && mounted.current) setMessage("Your saved sign-in could not be restored. Please sign in again.");
      else if (previousUser === undefined) receive(result.session);
    });
    return () => { mounted.current = false; epoch.current += 1; subscription.subscription.unsubscribe(); };
  }, [cloud, loadAccount, publishIdentity]);

  // Debounced, revision-checked autosaving begins only after the user chooses a copy.
  useEffect(() => {
    const account = active.current;
    if (phase !== "active" || !account || inflight.current) return;
    if (awaitingSignature.current) {
      if (awaitingSignature.current !== signature) return;
      awaitingSignature.current = null;
    }
    if (signature === account.signature) return;
    const ticket = epoch.current;
    const timer = setTimeout(async () => {
      if (ticket !== epoch.current || active.current !== account || inflight.current) return;
      inflight.current = true; setSaving(true);
      const snapshot = currentData.current;
      const sentSignature = JSON.stringify(snapshot);
      try {
        const next = await writeCloudState(account.userId, account.revision, snapshot);
        if (!mounted.current || ticket !== epoch.current || active.current !== account) return;
        account.revision = next.revision; account.signature = sentSignature;
        setRecord(next); setSavedAt(next.updatedAt); setMessage("");
      } catch (error) {
        if (!mounted.current || ticket !== epoch.current) return;
        setPhase(error instanceof SyncConflictError ? "conflict" : "paused");
        setMessage(error instanceof Error ? error.message : "Cloud saving paused. Your device copy is still saved.");
      } finally {
        if (mounted.current && ticket === epoch.current) { inflight.current = false; setSaving(false); setSaveVersion(value => value + 1); }
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [signature, phase, saveVersion]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!cloud || busy) return;
    setBusy(true); setMessage("");
    try {
      if (mode === "recover") {
        const { error } = await cloud.auth.updateUser({ password });
        if (error) throw error;
        setMode("login"); setPassword(""); setMessage("Your password has been updated.");
      } else if (mode === "reset") {
        const { error } = await cloud.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage("If that email belongs to an account, a password reset link is on its way.");
      } else if (mode === "register") {
        const { data: result, error } = await cloud.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setPassword("");
        setMessage(result.session ? "Account created. Choose how to start syncing below." : "Check your email for a confirmation link, then sign in here.");
      } else {
        const { error } = await cloud.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setPassword("");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The account request could not be completed."); }
    finally { if (mounted.current) setBusy(false); }
  }

  function activate(snapshot: AppData, nextRecord: CloudRecord) {
    if (!user) return;
    // Preserve an unreadable local snapshot before the parent's persistence effect
    // writes the chosen copy into this account's namespace.
    if (unreadableLocal.current?.userId === user.id) {
      const backupKey = `sentence-recall.v2.${user.id}.unreadable.${Date.now()}`;
      try { localStorage.setItem(backupKey, unreadableLocal.current.raw); }
      catch { throw new Error("The unreadable device save could not be backed up because browser storage is full or disabled. Export/remove it in browser storage before replacing this copy."); }
      unreadableLocal.current = null;
    }
    const nextSignature = JSON.stringify(snapshot);
    active.current = { userId: user.id, revision: nextRecord.revision, signature: JSON.stringify(nextRecord.snapshot) };
    awaitingSignature.current = nextSignature;
    if (!activated.current) guestCopy.current = currentData.current;
    activated.current = true;
    publishIdentity({ storageKey: `sentence-recall.v2.${user.id}`, userId: user.id, data: snapshot });
    setRecord(nextRecord); setSavedAt(nextRecord.updatedAt); setPhase("active"); setMessage("");
  }

  async function choose(which: "cloud" | "device" | "guest") {
    if (!user || !record || busy || saving) return;
    const ticket = epoch.current;
    setBusy(true); setMessage("");
    try {
      if (which === "cloud") {
        const fresh = await readCloudState(user.id);
        if (!fresh.snapshot) throw new Error("No cloud copy exists yet. Save this device's copy to start.");
        if (ticket === epoch.current) activate(fresh.snapshot, fresh);
      } else {
        if (record.snapshot && !window.confirm("Replace the account's cloud copy with the selected device copy? Copies are not merged. Export either copy first if you need a backup.")) return;
        const usingCurrent = (which === "device" && (activated.current || !deviceRecord)) || (which === "guest" && !activated.current);
        const snapshot = usingCurrent ? currentData.current : which === "guest" ? guestCopy.current : deviceRecord!;
        const next = await writeCloudState(user.id, record.revision, snapshot);
        if (ticket === epoch.current) activate(usingCurrent ? currentData.current : snapshot, next);
      }
    } catch (error) {
      if (ticket !== epoch.current) return;
      setMessage(error instanceof Error ? error.message : "The selected copy could not be saved.");
      if (error instanceof SyncConflictError) setPhase("conflict");
    } finally { if (mounted.current && ticket === epoch.current) setBusy(false); }
  }

  async function refreshChoices() {
    if (!user || busy || saving) return;
    const ticket = epoch.current;
    setBusy(true); setPhase("loading");
    await loadAccount(user.id, ticket);
    if (mounted.current && ticket === epoch.current) setBusy(false);
  }

  async function signOut() {
    if (!cloud || busy || saving) return;
    const account = active.current;
    if (account && JSON.stringify(currentData.current) !== account.signature &&
      !window.confirm("Some changes have not reached the cloud. Sign out anyway? Your account's device copy remains stored in this browser.")) return;
    setBusy(true);
    const { error } = await cloud.auth.signOut({ scope: "local" });
    if (error) setMessage(`Could not sign out: ${error.message}`);
    else { setMode("login"); setMessage("Signed out. Your guest decks are available again."); }
    if (mounted.current) setBusy(false);
  }

  if (!cloud) return <section className="account-panel" aria-labelledby="account-title">
    <h2 id="account-title">Your account</h2>
    <p>Decks and progress are saved in this browser. Email sign-in and cloud syncing become available when the site owner connects account storage.</p>
    <p>Use Export to keep a backup or move your decks to another device.</p>
    <style jsx>{styles}</style>
  </section>;

  return <section className="account-panel" aria-labelledby="account-title">
    <h2 id="account-title">Your account</h2>
    {user && <p>Signed in as <strong>{user.email ?? "your account"}</strong></p>}
    {(!user || mode === "recover") && <>
      <form onSubmit={submit}>
        {mode !== "recover" && <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>}
        {mode !== "reset" && <label>{mode === "recover" ? "New password" : "Password"}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 10} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>}
        {(mode === "register" || mode === "recover") && <small>Use at least 10 characters.</small>}
        <button type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "Create account" : mode === "reset" ? "Send reset link" : mode === "recover" ? "Save new password" : "Sign in"}</button>
      </form>
      <div className="account-actions">
        {mode !== "login" && <button type="button" onClick={() => { setMode("login"); setMessage(""); }}>Back to sign in</button>}
        {mode === "login" && <><button type="button" onClick={() => { setMode("register"); setMessage(""); }}>Create an account</button><button type="button" onClick={() => { setMode("reset"); setMessage(""); }}>Forgot password?</button></>}
      </div>
    </>}
    {user && <>
      {phase === "loading" && <p role="status">Loading your cloud save…</p>}
      {phase === "choice" && record && <div className="sync-choice">
        <h3>Choose the copy you want to use</h3>
        <p>{record.snapshot ? "Your account has saved decks and progress. Choose your cloud copy, or explicitly replace it with a device copy. Copies are not merged." : "This account does not have a cloud save yet. Start with a copy from this device."}</p>
        {deviceRecord && !activated.current && <p>A saved copy for this account was found on this device. It may contain changes that have not reached the cloud.</p>}
        {deviceProblem && <p>{deviceProblem}</p>}
        <div className="account-actions">
          {record.snapshot && <button type="button" disabled={busy} onClick={() => void choose("cloud")}>Use cloud copy</button>}
          <button type="button" disabled={busy} onClick={() => void choose("device")}>{deviceRecord && !activated.current ? "Use this account’s device copy" : activated.current ? "Use current device copy" : "Import guest copy"}</button>
          {deviceRecord && !activated.current && <button type="button" disabled={busy} onClick={() => void choose("guest")}>Import guest copy instead</button>}
        </div>
      </div>}
      {phase === "active" && <p role="status">{saving ? "Saving to your account…" : active.current?.signature !== signature ? "Changes waiting to sync…" : `Cloud copy is up to date${savedAt ? ` · ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.`}</p>}
      {(phase === "paused" || phase === "conflict") && <div className="sync-choice"><h3>Cloud syncing is paused</h3><p>Your device copy is still available. Export it if you want a backup before choosing between copies.</p><button type="button" disabled={busy} onClick={() => void refreshChoices()}>{busy ? "Checking…" : "Check cloud and choose a copy"}</button></div>}
      <div className="account-actions">
        {phase === "active" && <button type="button" disabled={busy || saving} onClick={() => void refreshChoices()}>Check another device&apos;s changes</button>}
        <button type="button" disabled={busy || saving} onClick={() => void signOut()}>Sign out</button>
      </div>
      <p className="account-note">After choosing a copy, changes save automatically. Wait for “Cloud copy is up to date” before switching devices. Simultaneous edits pause syncing so a newer copy is never silently replaced.</p>
    </>}
    {message && <p className="account-message" role="status">{message}</p>}
    <style jsx>{styles}</style>
  </section>;
}

const styles = `
  .account-panel{max-width:680px;margin:0 auto;padding:24px;border:1px solid #deddd4;border-radius:18px;background:#fffefa;color:#243f39}
  h2{font-size:1.65rem;margin:0 0 16px}h3{font-size:1.05rem;margin:0 0 10px}p{line-height:1.65}form{display:grid;gap:14px;max-width:430px}
  label{display:grid;gap:6px;font-weight:600}input{width:100%;min-height:44px;padding:11px;border:1px solid #a8b7af;border-radius:9px;font:inherit;box-sizing:border-box;background:white;color:#173c34}
  button{min-height:44px;border:1px solid #55766a;border-radius:9px;background:#edf4ef;color:#174c3e;padding:10px 15px;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible{outline:3px solid #c89b3c;outline-offset:3px}
  form button[type=submit]{background:#225f4f;color:white}.account-actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.sync-choice{padding:18px;margin:16px 0;background:#f1f4ee;border-radius:12px}
  .account-note,small{font-size:.88rem;color:#53665d}.account-message{border-left:4px solid #b48a39;padding:12px;background:#fcf6e9;overflow-wrap:anywhere}
`;
