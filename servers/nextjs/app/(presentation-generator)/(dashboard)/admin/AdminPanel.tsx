"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";

type AdminUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at?: string | null;
};

type ApiKey = {
  token: string;
  user_id: string;
  created_at: string;
};

type AdminDialog =
  | { kind: "reset-password"; user: AdminUser }
  | { kind: "delete-user"; user: AdminUser }
  | { kind: "revoke-key"; key: ApiKey }
  | null;

type AdminPanelProps = {
  embedded?: boolean;
};

async function errorDetail(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  return payload?.detail || `Request failed (${response.status})`;
}

function maskedKey(token: string) {
  return `••••••••••••••••${token.slice(-4)}`;
}

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#7C51F8] px-5 text-xs font-semibold text-white transition hover:bg-[#6D46E6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const inputClass =
  "h-11 w-full rounded-xl border border-[#E1E1E5] bg-white px-4 text-sm text-[#101323] outline-none transition placeholder:text-[#98A2B3] focus:border-[#7A5AF8] focus:ring-2 focus:ring-[#7A5AF8]/15";

export default function AdminPanel({ embedded = false }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AdminDialog>(null);

  const loadUsers = useCallback(async () => {
    setBusy("users");
    const response = await fetch("/api/v1/admin/users", {
      cache: "no-store",
      credentials: "include",
    });
    if (response.ok) setUsers(await response.json());
    else notify.error("Could not load users", await errorDetail(response));
    setBusy(null);
  }, []);

  const loadKeys = useCallback(async () => {
    setBusy("keys");
    const response = await fetch("/api/v1/auth/token/list", {
      cache: "no-store",
      credentials: "include",
    });
    if (response.ok) setKeys(await response.json());
    else notify.error("Could not load API keys", await errorDetail(response));
    setBusy(null);
  }, []);

  useEffect(() => {
    void Promise.all([loadUsers(), loadKeys()]);
  }, [loadKeys, loadUsers]);

  const addUser = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("add");
    const response = await fetch("/api/v1/admin/users", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    if (response.ok) {
      notify.success("User created", `${username.trim()} can now sign in.`);
      setUsername("");
      setPassword("");
      await loadUsers();
    } else {
      notify.error("Could not create user", await errorDetail(response));
    }
    setBusy(null);
  };

  const openResetPassword = (user: AdminUser) => {
    setResetPasswordValue("");
    setDialog({ kind: "reset-password", user });
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "reset-password") return;

    const { user } = dialog;
    setBusy(`reset:${user.id}`);
    const response = await fetch(`/api/v1/admin/users/${user.id}/password`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPasswordValue }),
    });
    if (response.ok) {
      notify.success("Password reset", "Existing sessions were signed out.");
      setDialog(null);
      setResetPasswordValue("");
    } else {
      notify.error("Could not reset password", await errorDetail(response));
    }
    setBusy(null);
  };

  const deleteUser = async () => {
    if (dialog?.kind !== "delete-user") return;

    const { user } = dialog;
    setBusy(`delete:${user.id}`);
    const response = await fetch(`/api/v1/admin/users/${user.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (response.ok) {
      notify.success("User deleted", `${user.username}'s workspace was removed.`);
      setDialog(null);
      await loadUsers();
    } else {
      notify.error("Could not delete user", await errorDetail(response));
    }
    setBusy(null);
  };

  const createKey = async () => {
    setBusy("create-key");
    const response = await fetch("/api/v1/auth/token/create", {
      method: "POST",
      credentials: "include",
    });
    if (response.ok) {
      const key = (await response.json()) as ApiKey;
      setKeys((current) => [key, ...current]);
      try {
        await navigator.clipboard.writeText(key.token);
        notify.success("API key created", "The new key was copied to your clipboard.");
      } catch {
        notify.success("API key created", "Use the copy button to copy the new key.");
      }
    } else {
      notify.error("Could not create API key", await errorDetail(response));
    }
    setBusy(null);
  };

  const revokeKey = async () => {
    if (dialog?.kind !== "revoke-key") return;

    const { key } = dialog;
    setBusy(`revoke:${key.token}`);
    const response = await fetch("/api/v1/auth/token/revoke", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: key.token }),
    });
    if (response.ok) {
      setKeys((current) => current.filter((item) => item.token !== key.token));
      setVisibleKeys((current) => {
        const next = new Set(current);
        next.delete(key.token);
        return next;
      });
      setDialog(null);
      notify.success("API key revoked");
    } else {
      notify.error("Could not revoke API key", await errorDetail(response));
    }
    setBusy(null);
  };

  const toggleKeyVisibility = (token: string) => {
    setVisibleKeys((current) => {
      const next = new Set(current);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const copyKey = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      notify.success("API key copied");
    } catch {
      notify.error("Could not copy API key", "Please try again.");
    }
  };

  const dialogBusy =
    (dialog?.kind === "reset-password" && busy === `reset:${dialog.user.id}`) ||
    (dialog?.kind === "delete-user" && busy === `delete:${dialog.user.id}`) ||
    (dialog?.kind === "revoke-key" && busy === `revoke:${dialog.key.token}`);
  const RootElement = embedded ? "section" : "main";

  return (
    <RootElement
      className={
        embedded
          ? "h-[calc(100vh-104px)] overflow-y-auto pb-28 pr-6 font-syne"
          : "min-h-screen bg-white px-8 py-10 font-syne"
      }
    >
      <div className={embedded ? "max-w-5xl" : "mx-auto max-w-5xl"}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7A5AF8]">
          Instance administration
        </p>
        <h1 className="mt-2 font-unbounded text-[24px] font-normal tracking-[-0.03em] text-[#101323]">
          Admin
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">
          Manage login accounts and admin-owned API/MCP access keys. User
          workspaces remain private.
        </p>

        <Tabs defaultValue="users" className="mt-7">
          <TabsList className="h-11 rounded-full border border-[#EDEEEF] bg-[#F9FAFB] p-1">
            <TabsTrigger
              value="users"
              className="h-9 rounded-full px-5 text-xs text-[#667085] shadow-none data-[state=active]:bg-white data-[state=active]:text-[#5146E5] data-[state=active]:shadow-sm"
            >
              Users
            </TabsTrigger>
            <TabsTrigger
              value="keys"
              className="h-9 rounded-full px-5 text-xs text-[#667085] shadow-none data-[state=active]:bg-white data-[state=active]:text-[#5146E5] data-[state=active]:shadow-sm"
            >
              API keys
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6 space-y-5">
            <section className="rounded-[20px] border border-[#EDEEEF] bg-white p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F3FF]">
                  <UserPlus className="h-4 w-4 text-[#5146E5]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[#101323]">Add user</h2>
                  <p className="mt-0.5 text-xs text-[#667085]">
                    Create a private workspace and sign-in credentials.
                  </p>
                </div>
              </div>
              <form onSubmit={addUser} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  aria-label="Username"
                  className={inputClass}
                  placeholder="Username"
                  minLength={3}
                  maxLength={128}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <input
                  aria-label="Password"
                  className={inputClass}
                  type="password"
                  placeholder="Password (8+ characters)"
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button type="submit" className={primaryButtonClass} disabled={busy === "add"}>
                  {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create user
                </button>
              </form>
            </section>

            <section className="overflow-hidden rounded-[20px] border border-[#EDEEEF] bg-white">
              <div className="flex items-center justify-between border-b border-[#EDEEEF] px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F3FF]">
                    <Users className="h-4 w-4 text-[#5146E5]" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#101323]">Accounts</h2>
                    <p className="mt-0.5 text-xs text-[#667085]">
                      {users.length} account{users.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Refresh accounts"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[#EDEEEF] text-[#667085] transition hover:bg-[#F9FAFB] hover:text-[#5146E5]"
                  onClick={() => void loadUsers()}
                >
                  <RefreshCw className={`h-4 w-4 ${busy === "users" ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="divide-y divide-[#EDEEEF]">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#101323]">{user.username}</p>
                      <p className="mt-1 text-xs text-[#667085]">
                        {user.role === "admin" ? "Administrator" : "User"}
                        {user.created_at
                          ? ` · ${new Date(user.created_at).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    {user.role === "user" && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="h-9 rounded-full border border-[#EDEEEF] bg-white px-4 text-xs font-semibold text-[#344054] transition hover:bg-[#F9FAFB]"
                          onClick={() => openResetPassword(user)}
                          disabled={busy !== null}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${user.username}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#FEE4E2] bg-white text-[#D92D20] transition hover:bg-[#FEF3F2]"
                          onClick={() => setDialog({ kind: "delete-user", user })}
                          disabled={busy !== null}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="keys" className="mt-6">
            <section className="overflow-hidden rounded-[20px] border border-[#EDEEEF] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EDEEEF] px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F3FF]">
                    <KeyRound className="h-4 w-4 text-[#5146E5]" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#101323]">API and MCP keys</h2>
                    <p className="mt-0.5 text-xs text-[#667085]">
                      Keys are hidden by default. Generate as many as you need.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={() => void createKey()}
                  disabled={busy === "create-key"}
                >
                  {busy === "create-key" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Generate key
                </button>
              </div>
              <div className="divide-y divide-[#EDEEEF]">
                {keys.length === 0 && (
                  <div className="px-6 py-12 text-center">
                    <KeyRound className="mx-auto h-6 w-6 text-[#B8B4C7]" />
                    <p className="mt-3 text-sm text-[#667085]">
                      No API keys have been generated.
                    </p>
                  </div>
                )}
                {keys.map((key) => {
                  const isVisible = visibleKeys.has(key.token);
                  return (
                    <div
                      key={key.token}
                      className="flex flex-wrap items-center gap-3 px-6 py-4"
                    >
                      <div className="min-w-[220px] flex-1">
                        <code className="block truncate text-xs text-[#344054]">
                          {isVisible ? key.token : maskedKey(key.token)}
                        </code>
                        <p className="mt-1 text-[11px] text-[#98A2B3]">
                          Created {new Date(key.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={isVisible ? "Hide API key" : "Show API key"}
                        title={isVisible ? "Hide API key" : "Show API key"}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-[#EDEEEF] text-[#667085] transition hover:bg-[#F4F3FF] hover:text-[#5146E5]"
                        onClick={() => toggleKeyVisibility(key.token)}
                      >
                        {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="Copy API key"
                        title="Copy API key"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-[#EDEEEF] text-[#667085] transition hover:bg-[#F4F3FF] hover:text-[#5146E5]"
                        onClick={() => void copyKey(key.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Revoke API key"
                        title="Revoke API key"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-[#FEE4E2] text-[#D92D20] transition hover:bg-[#FEF3F2]"
                        onClick={() => setDialog({ kind: "revoke-key", key })}
                        disabled={busy !== null}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) {
            setDialog(null);
            setResetPasswordValue("");
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-32px)] max-w-[440px] gap-0 rounded-[24px] border-0 bg-white p-0 font-syne shadow-[0_24px_80px_rgba(15,23,42,0.18)] [&>button]:hidden">
          {dialog?.kind === "reset-password" && (
            <form onSubmit={resetPassword}>
              <DialogHeader className="px-7 pb-5 pt-7 text-left">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F4F3FF]">
                  <LockKeyhole className="h-5 w-5 text-[#5146E5]" />
                </div>
                <DialogTitle className="text-xl font-semibold leading-7 text-[#101323]">
                  Reset password
                </DialogTitle>
                <DialogDescription className="pt-1 text-sm leading-6 text-[#667085]">
                  Set a new password for{" "}
                  <span className="font-semibold text-[#344054]">{dialog.user.username}</span>.
                  Existing sessions will be signed out.
                </DialogDescription>
                <label className="pt-4 text-xs font-semibold text-[#344054]" htmlFor="reset-password">
                  New password
                </label>
                <input
                  id="reset-password"
                  autoFocus
                  className={inputClass}
                  type="password"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  maxLength={128}
                  value={resetPasswordValue}
                  onChange={(event) => setResetPasswordValue(event.target.value)}
                  required
                />
              </DialogHeader>
              <DialogFooter className="flex-row border-t border-[#EAECF0] p-4 sm:justify-end sm:space-x-0">
                <button
                  type="button"
                  className="h-10 rounded-full border border-[#E1E1E5] px-5 text-xs font-semibold text-[#344054] transition hover:bg-[#F9FAFB]"
                  onClick={() => setDialog(null)}
                  disabled={dialogBusy}
                >
                  Cancel
                </button>
                <button type="submit" className={primaryButtonClass} disabled={dialogBusy}>
                  {dialogBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Reset password
                </button>
              </DialogFooter>
            </form>
          )}

          {dialog?.kind === "delete-user" && (
            <>
              <DialogHeader className="px-7 pb-6 pt-7 text-left">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FEF3F2]">
                  <AlertTriangle className="h-5 w-5 text-[#D92D20]" />
                </div>
                <DialogTitle className="text-xl font-semibold leading-7 text-[#101323]">
                  Delete {dialog.user.username}?
                </DialogTitle>
                <DialogDescription className="pt-1 text-sm leading-6 text-[#667085]">
                  This permanently removes the user and all of their presentations,
                  templates, chats, tasks, and files. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row border-t border-[#EAECF0] p-4 sm:justify-end sm:space-x-0">
                <button
                  type="button"
                  className="h-10 rounded-full border border-[#E1E1E5] px-5 text-xs font-semibold text-[#344054] transition hover:bg-[#F9FAFB]"
                  onClick={() => setDialog(null)}
                  disabled={dialogBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#D92D20] px-5 text-xs font-semibold text-white transition hover:bg-[#B42318] disabled:opacity-60"
                  onClick={() => void deleteUser()}
                  disabled={dialogBusy}
                >
                  {dialogBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete user
                </button>
              </DialogFooter>
            </>
          )}

          {dialog?.kind === "revoke-key" && (
            <>
              <DialogHeader className="px-7 pb-6 pt-7 text-left">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FEF3F2]">
                  <AlertTriangle className="h-5 w-5 text-[#D92D20]" />
                </div>
                <DialogTitle className="text-xl font-semibold leading-7 text-[#101323]">
                  Revoke API key?
                </DialogTitle>
                <DialogDescription className="pt-1 text-sm leading-6 text-[#667085]">
                  Any application using this key will lose API and MCP access
                  immediately. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row border-t border-[#EAECF0] p-4 sm:justify-end sm:space-x-0">
                <button
                  type="button"
                  className="h-10 rounded-full border border-[#E1E1E5] px-5 text-xs font-semibold text-[#344054] transition hover:bg-[#F9FAFB]"
                  onClick={() => setDialog(null)}
                  disabled={dialogBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#D92D20] px-5 text-xs font-semibold text-white transition hover:bg-[#B42318] disabled:opacity-60"
                  onClick={() => void revokeKey()}
                  disabled={dialogBusy}
                >
                  {dialogBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Revoke key
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </RootElement>
  );
}
