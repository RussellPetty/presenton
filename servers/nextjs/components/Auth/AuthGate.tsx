"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { getApiUrl } from "@/utils/api";
import { isAuthDisabled } from "@/utils/auth";
import { formatFastApiDetail, UNAUTHORIZED_DETAIL } from "@/utils/authErrors";
import {
  PRESENTON_SPLASH_MIN_DURATION_MS,
  PresentonSplashLoader,
} from "@/components/ui/presenton-splash-loader";
import { notify } from "@/components/ui/sonner";
import { sanitizeAnalyticsError } from "@/utils/analytics";
import { MixpanelEvent, trackEvent } from "@/utils/mixpanel";

type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
  role?: "admin" | "user" | null;
};

type PresentonDeviceFlow = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expiresAt: number;
};

const initialStatus: AuthStatus = {
  configured: false,
  authenticated: false,
  username: null,
  role: null,
};

export default function AuthGate() {
  const [status, setStatus] = useState<AuthStatus>(initialStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasMetSplashDuration, setHasMetSplashDuration] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [presentonEnabled, setPresentonEnabled] = useState(false);
  const [presentonFlow, setPresentonFlow] = useState<PresentonDeviceFlow | null>(null);
  const [presentonPollDelay, setPresentonPollDelay] = useState(5);
  const [presentonPollAttempt, setPresentonPollAttempt] = useState(0);
  const [isPresentonStarting, setIsPresentonStarting] = useState(false);
  const isSetupMode = useMemo(() => !status.configured, [status.configured]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setHasMetSplashDuration(true);
    }, PRESENTON_SPLASH_MIN_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (isAuthDisabled()) {
      trackEvent(MixpanelEvent.Auth_Status_Checked, {
        configured: true,
        authenticated: true,
        auth_disabled: true,
      });
      setStatus({
        configured: true,
        authenticated: true,
        username: "electron",
        role: "admin",
      });
      setIsLoading(false);
      return;
    }

    void refreshStatus();
  }, []);

  useEffect(() => {
    if (isAuthDisabled()) {
      return;
    }

    const loadPresentonStatus = async () => {
      try {
        const response = await fetch(
          getApiUrl("/api/v1/auth/presenton/status"),
          {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          }
        );
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { enabled?: boolean };
        setPresentonEnabled(Boolean(payload.enabled));
      } catch {
        setPresentonEnabled(false);
      }
    };

    void loadPresentonStatus();
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      isLoading ||
      !status.authenticated ||
      isRedirecting
    ) {
      return;
    }

    setIsRedirecting(true);
    window.location.replace("/");
  }, [isLoading, isRedirecting, status.authenticated]);

  useEffect(() => {
    if (typeof window === "undefined" || isLoading) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") === "unauthorized") {
      if (status.configured && !status.authenticated) {
        trackEvent(MixpanelEvent.Auth_Unauthorized_Redirect, {
          configured: true,
        });
        notify.error("Unauthorized", "Sign in to view this page.", {
          id: "auth-unauthorized-redirect",
          duration: 5000,
        });
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [isLoading, status.authenticated, status.configured]);

  const refreshStatus = async () => {
    setIsLoading(true);

    try {
      const response = await fetch(getApiUrl("/api/v1/auth/status"), {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Could not load login state");
      }

      const data = (await response.json()) as AuthStatus;
      trackEvent(MixpanelEvent.Auth_Status_Checked, {
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        auth_disabled: false,
        role: data.role ?? null,
      });
      setStatus({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        username: data.username ?? null,
        role: data.role ?? null,
      });
    } catch (fetchError) {
      console.error(fetchError);
      trackEvent(MixpanelEvent.Auth_Status_Checked, {
        configured: false,
        authenticated: false,
        auth_disabled: false,
        error_message: sanitizeAnalyticsError(
          fetchError,
          "Could not load login state"
        ),
      });
      notify.error(
        "Could not load login",
        "We could not connect to the login service. Please refresh and try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (
      isLoading ||
      isRedirecting ||
      status.authenticated ||
      !hasMetSplashDuration
    ) {
      return;
    }

    trackEvent(MixpanelEvent.Auth_Gate_Viewed, {
      flow: status.configured ? "sign_in" : "setup",
    });
  }, [
    hasMetSplashDuration,
    isLoading,
    isRedirecting,
    status.authenticated,
    status.configured,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanedUsername = username.trim();
    if (cleanedUsername.length < 3) {
      trackEvent(MixpanelEvent.Auth_Validation_Failed, {
        flow: isSetupMode ? "setup" : "sign_in",
        reason: "username_too_short",
      });
      notify.warning(
        "Username too short",
        "Your username must be at least 3 characters."
      );
      return;
    }

    const minimumPasswordLength = isSetupMode ? 8 : 6;
    if (password.length < minimumPasswordLength) {
      trackEvent(MixpanelEvent.Auth_Validation_Failed, {
        flow: isSetupMode ? "setup" : "sign_in",
        reason: "password_too_short",
      });
      notify.warning(
        "Password too short",
        `Your password must be at least ${minimumPasswordLength} characters.`
      );
      return;
    }

    if (isSetupMode && password !== confirmPassword) {
      trackEvent(MixpanelEvent.Auth_Validation_Failed, {
        flow: "setup",
        reason: "passwords_do_not_match",
      });
      notify.warning(
        "Passwords do not match",
        "Make sure both password fields match before continuing."
      );
      return;
    }

    setIsSubmitting(true);
    trackEvent(
      isSetupMode
        ? MixpanelEvent.Auth_Setup_Started
        : MixpanelEvent.Auth_SignIn_Started,
      {
        username_length: cleanedUsername.length,
      }
    );

    try {
      const response = await fetch(
        getApiUrl(isSetupMode ? "/api/v1/auth/setup" : "/api/v1/auth/login"),
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: cleanedUsername,
            password,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        const detail = formatFastApiDetail(payload?.detail);
        trackEvent(
          isSetupMode
            ? MixpanelEvent.Auth_Setup_Failed
            : MixpanelEvent.Auth_SignIn_Failed,
          {
            status_code: response.status,
            error_message: sanitizeAnalyticsError(
              detail,
              isSetupMode ? "Could not create account" : "Sign-in failed"
            ),
          }
        );
        if (response.status === 401) {
          notify.error(
            "Sign-in failed",
            detail === UNAUTHORIZED_DETAIL
              ? "The username or password is incorrect. Please try again."
              : detail
          );
        } else {
          notify.error(
            isSetupMode ? "Could not create account" : "Sign-in failed",
            detail || "Something went wrong. Please try again."
          );
        }
        return;
      }

      if (isSetupMode) {
        trackEvent(MixpanelEvent.Auth_Setup_Completed, {
          username_length: cleanedUsername.length,
        });
        setStatus({
          configured: true,
          authenticated: false,
          username: (payload as AuthStatus).username ?? cleanedUsername,
          role: (payload as AuthStatus).role ?? "admin",
        });
        setPassword("");
        setConfirmPassword("");
        notify.success("Account created", "Sign in with your new username and password to continue.", {
          duration: 6000,
        });
        return;
      }

      setStatus({
        configured: Boolean((payload as AuthStatus).configured),
        authenticated: Boolean((payload as AuthStatus).authenticated),
        username: (payload as AuthStatus).username ?? cleanedUsername,
        role: (payload as AuthStatus).role ?? null,
      });
      trackEvent(MixpanelEvent.Auth_SignIn_Completed, {
        username_length: cleanedUsername.length,
        role: (payload as AuthStatus).role ?? null,
      });
      setPassword("");
      setConfirmPassword("");
      notify.success(
        "Signed in",
        "Welcome back. Loading your workspace."
      );
    } catch (submitError) {
      console.error(submitError);
      trackEvent(
        isSetupMode
          ? MixpanelEvent.Auth_Setup_Failed
          : MixpanelEvent.Auth_SignIn_Failed,
        {
          status_code: null,
          error_message: sanitizeAnalyticsError(
            submitError,
            isSetupMode ? "Could not create account" : "Login unavailable"
          ),
        }
      );
      notify.error(
        "Login unavailable",
        "The login service is unavailable right now. Please try again in a moment."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const startPresentonLogin = async () => {
    if (isPresentonStarting) {
      return;
    }

    setIsPresentonStarting(true);
    const approvalWindow = window.open(
      "about:blank",
      "presenton-device-authorization",
      "popup,width=720,height=800"
    );
    if (approvalWindow) {
      approvalWindow.opener = null;
      approvalWindow.document.title = "Connecting to Presenton…";
    }

    try {
      const response = await fetch(
        getApiUrl("/api/v1/auth/presenton/device/start"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_name: "Presenton self-hosted" }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        approvalWindow?.close();
        throw new Error(
          formatFastApiDetail(payload?.detail) ||
            "Could not start Login with Presenton."
        );
      }

      const interval = Math.max(1, Number(payload.interval) || 5);
      const expiresIn = Math.max(1, Number(payload.expires_in) || 900);
      const flow: PresentonDeviceFlow = {
        device_code: String(payload.device_code),
        user_code: String(payload.user_code),
        verification_uri: String(payload.verification_uri),
        verification_uri_complete: String(payload.verification_uri_complete),
        expiresAt: Date.now() + expiresIn * 1000,
      };
      setPresentonFlow(flow);
      setPresentonPollDelay(interval);
      setPresentonPollAttempt(0);
      if (approvalWindow) {
        approvalWindow.location.replace(flow.verification_uri_complete);
      }
    } catch (error) {
      approvalWindow?.close();
      notify.error(
        "Could not connect to Presenton",
        error instanceof Error
          ? error.message
          : "Please try again in a moment."
      );
    } finally {
      setIsPresentonStarting(false);
    }
  };

  useEffect(() => {
    if (!presentonFlow || status.authenticated) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      if (Date.now() >= presentonFlow.expiresAt) {
        setPresentonFlow(null);
        notify.error(
          "Authorization expired",
          "Start Login with Presenton again to get a new code."
        );
        return;
      }

      try {
        const response = await fetch(
          getApiUrl("/api/v1/auth/presenton/device/poll"),
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: presentonFlow.device_code }),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (response.status === 202) {
          if (payload?.error === "slow_down") {
            setPresentonPollDelay((delay) => delay + 5);
          }
          setPresentonPollAttempt((attempt) => attempt + 1);
          return;
        }
        if (!response.ok) {
          throw new Error(
            formatFastApiDetail(payload?.detail) || "Presenton login failed."
          );
        }

        setStatus({
          configured: Boolean(payload.configured),
          authenticated: Boolean(payload.authenticated),
          username: payload.username ?? null,
          role: payload.role ?? null,
        });
        setPresentonFlow(null);
        notify.success(
          "Signed in with Presenton",
          "Welcome. Loading your workspace."
        );
      } catch (error) {
        setPresentonFlow(null);
        notify.error(
          "Presenton login failed",
          error instanceof Error ? error.message : "Please try again."
        );
      }
    }, presentonPollDelay * 1000);

    return () => window.clearTimeout(timeout);
  }, [
    presentonFlow,
    presentonPollAttempt,
    presentonPollDelay,
    status.authenticated,
  ]);

  if (
    isLoading ||
    isRedirecting ||
    status.authenticated ||
    !hasMetSplashDuration
  ) {
    return <PresentonSplashLoader message="Preparing your workspace..." />;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-6 font-syne">
      <section className="relative z-10 w-full max-w-lg rounded-[20px] border border-[#EDEEEF] bg-[#F9F8F8] p-7 sm:p-10">
        <div className="mb-7">
          <div className="flex items-center gap-4">
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[4px] bg-[#F4F3FF] p-3">
              <Image
                src="/logo-with-bg.png"
                alt=""
                width={161}
                height={166}
                className="h-10 w-auto object-contain"
              />
            </div>
            <div>
              <p className="font-syne text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7A5AF8]">
                Secure instance
              </p>
              <h1 className="mt-1 font-unbounded text-xl font-normal leading-tight tracking-[-0.03em] text-black sm:text-[22px]">
                {isSetupMode ? "Create your admin login" : "Sign in to continue"}
              </h1>
            </div>
          </div>
        </div>

        <p className="max-w-md text-sm leading-relaxed text-[#6B7280]">
          {isSetupMode
            ? "One-time setup for this deployment. You will use the same username and password on future visits."
            : "This deployment is protected. Enter your credentials to open the app."}
        </p>

        {presentonEnabled ? (
          <div className="mt-7">
            {presentonFlow ? (
              <div className="rounded-xl border border-[#ded8f8] bg-[#f6f3ff] p-4">
                <p className="text-sm font-semibold text-[#2f2940]">
                  Finish signing in on Presenton
                </p>
                <p className="mt-1 text-xs leading-5 text-[#6B647A]">
                  Confirm that the code below matches the code in the authorization window.
                </p>
                <div className="mt-4 rounded-lg border border-[#e2dcfa] bg-white px-4 py-3 text-center font-mono text-lg font-semibold tracking-[0.18em] text-[#4d436d]">
                  {presentonFlow.user_code}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <a
                    href={presentonFlow.verification_uri_complete}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-[#6d46e6] hover:text-[#5835c2]"
                  >
                    Open authorization page
                  </a>
                  <button
                    type="button"
                    onClick={() => setPresentonFlow(null)}
                    className="text-xs font-medium text-[#716b78] hover:text-[#3d3942]"
                  >
                    Cancel
                  </button>
                </div>
                <p className="mt-3 text-xs text-[#7A7384]">
                  Waiting for authorization…
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void startPresentonLogin()}
                disabled={isPresentonStarting}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#dedbe5] bg-white px-5 text-sm font-semibold text-[#29252f] transition hover:border-[#c7baf7] hover:bg-[#faf9ff] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#7A5AF8] text-xs font-bold text-white">
                  P
                </span>
                {isPresentonStarting
                  ? "Connecting to Presenton…"
                  : isSetupMode
                    ? "Set up with Presenton"
                    : "Continue with Presenton"}
              </button>
            )}

            <div className="mt-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#e5e3e8]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A95A1]">
                or use local credentials
              </span>
              <div className="h-px flex-1 bg-[#e5e3e8]" />
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <div className="space-y-2">
            <label htmlFor="username" className="block text-sm font-medium text-[#374151]">
              Username
            </label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.replace(/\s/g, ""))
              }
              placeholder="Username"
              minLength={3}
              maxLength={128}
              pattern="\S+"
              title="Username cannot contain spaces"
              required
              spellCheck={false}
              className="h-12 w-full rounded-lg border border-[#E1E1E5] bg-white px-4 text-sm text-[#191919] outline-none transition placeholder:text-[#9CA3AF] focus:border-[#7A5AF8] focus:ring-2 focus:ring-[#7A5AF8]/15"
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-medium text-[#374151]">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={isSetupMode ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                isSetupMode ? "At least 8 characters" : "Enter your password"
              }
              minLength={isSetupMode ? 8 : 6}
              maxLength={128}
              required
              className="h-12 w-full rounded-lg border border-[#E1E1E5] bg-white px-4 text-sm text-[#191919] outline-none transition placeholder:text-[#9CA3AF] focus:border-[#7A5AF8] focus:ring-2 focus:ring-[#7A5AF8]/15"
              disabled={isSubmitting}
            />
          </div>

          {isSetupMode ? (
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#374151]">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter your password"
                minLength={8}
                maxLength={128}
                required
                className="h-12 w-full rounded-lg border border-[#E1E1E5] bg-white px-4 text-sm text-[#191919] outline-none transition placeholder:text-[#9CA3AF] focus:border-[#7A5AF8] focus:ring-2 focus:ring-[#7A5AF8]/15"
                disabled={isSubmitting}
              />
            </div>
          ) : null}

          {!isSetupMode && status.configured ? (
            <p className="rounded-lg border border-[#EDEEEF] bg-white px-4 py-3 text-xs leading-relaxed text-[#6B7280]">
              Use the username and password provided by your administrator.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-[58px] border border-[#EDEEEF] bg-[#7C51F8] px-5 py-3 font-syne text-xs font-semibold text-white transition hover:bg-[#6d46e6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? isSetupMode
                ? "Saving credentials…"
                : "Signing in…"
              : isSetupMode
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
