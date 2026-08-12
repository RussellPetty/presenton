"use client";

import Image from "next/image";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Link2,
  Loader2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { notify } from "@/components/ui/sonner";
import { getApiUrl } from "@/utils/api";

type PresentonStatus = {
  enabled: boolean;
  linked: boolean;
  email: string | null;
};

type DeviceFlow = {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresAt: number;
};

const initialStatus: PresentonStatus = {
  enabled: false,
  linked: false,
  email: null,
};

function getErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof payload.detail === "string"
  ) {
    return payload.detail;
  }
  return fallback;
}

export default function OnboardingPresentonAccount({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const [status, setStatus] = useState<PresentonStatus>(initialStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [pollDelay, setPollDelay] = useState(5);
  const [pollAttempt, setPollAttempt] = useState(0);
  const approvalWindowRef = useRef<Window | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(getApiUrl("/api/v1/auth/presenton/status"), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as Partial<PresentonStatus>;
      setStatus({
        enabled: Boolean(payload.enabled),
        linked: Boolean(payload.linked),
        email: typeof payload.email === "string" ? payload.email : null,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadStatus(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadStatus]);

  useEffect(() => {
    return () => approvalWindowRef.current?.close();
  }, []);

  const startLink = async () => {
    if (isStarting) return;
    setIsStarting(true);

    const approvalWindow = window.open(
      "about:blank",
      "_blank",
    );
    approvalWindowRef.current = approvalWindow;
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
          body: JSON.stringify({ device_name: "Presenton onboarding" }),
        },
      );
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok || !payload || typeof payload !== "object") {
        throw new Error(
          getErrorMessage(payload, "Could not start Presenton authorization."),
        );
      }

      const responseData = payload as Record<string, unknown>;
      const interval = Math.max(1, Number(responseData.interval) || 5);
      const expiresIn = Math.max(1, Number(responseData.expires_in) || 900);
      const nextFlow: DeviceFlow = {
        deviceCode: String(responseData.device_code),
        userCode: String(responseData.user_code),
        verificationUriComplete: String(responseData.verification_uri_complete),
        expiresAt: Date.now() + expiresIn * 1000,
      };
      setFlow(nextFlow);
      setPollDelay(interval);
      setPollAttempt(0);
      approvalWindow?.location.replace(nextFlow.verificationUriComplete);
    } catch (error) {
      approvalWindow?.close();
      notify.error(
        "Could not connect Presenton",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsStarting(false);
    }
  };

  const signOut = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const response = await fetch(
        getApiUrl("/api/v1/auth/presenton/logout"),
        {
          method: "POST",
          credentials: "include",
        },
      );
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, "Could not disconnect Presenton."),
        );
      }

      setFlow(null);
      approvalWindowRef.current?.close();
      approvalWindowRef.current = null;
      await loadStatus();
      notify.success(
        "Signed out",
        "You have been disconnected from Presenton.",
      );
    } catch (error) {
      notify.error(
        "Sign-out failed",
        error instanceof Error
          ? error.message
          : "Could not disconnect from Presenton. Please try again.",
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    if (!flow) return;

    const timeout = window.setTimeout(async () => {
      if (Date.now() >= flow.expiresAt) {
        setFlow(null);
        notify.error(
          "Authorization expired",
          "Start again to connect your Presenton account.",
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
            body: JSON.stringify({
              device_code: flow.deviceCode,
              link_current_user: true,
            }),
          },
        );
        const payload: unknown = await response.json().catch(() => ({}));
        if (response.status === 202) {
          if (
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error === "slow_down"
          ) {
            setPollDelay((delay) => delay + 5);
          }
          setPollAttempt((attempt) => attempt + 1);
          return;
        }
        if (!response.ok) {
          throw new Error(
            getErrorMessage(payload, "Could not link your Presenton account."),
          );
        }

        setFlow(null);
        approvalWindowRef.current?.close();
        approvalWindowRef.current = null;
        await loadStatus();
        notify.success(
          "Presenton account connected",
          "Your hosted account is now linked to this workspace.",
        );
      } catch (error) {
        setFlow(null);
        notify.error(
          "Presenton connection failed",
          error instanceof Error ? error.message : "Please try again.",
        );
      }
    }, pollDelay * 1000);

    return () => window.clearTimeout(timeout);
  }, [flow, loadStatus, pollAttempt, pollDelay]);

  if (isLoading) {
    return (
      <section
        aria-label="Loading Presenton account connection"
        className="h-[168px] animate-pulse rounded-[16px] border border-[#E5DDFC] bg-[#F8F6FF]"
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-[16px] border border-[#DCD2FF] bg-[linear-gradient(135deg,#FBFAFF_0%,#F4F0FF_100%)] shadow-[0_18px_55px_rgba(91,61,172,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-6 p-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border border-[#E3DCFA] bg-white shadow-sm">
            <Image
              src="/providers/presenton.png"
              alt=""
              width={30}
              height={30}
              className="h-7 w-7 object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[#191919]">
                Create with Presenton Cloud
              </h2>
              {status.linked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F8ED] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#238553]">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 max-w-[390px] text-xs leading-5 text-[#6B647A]">
              {status.linked
                ? status.email || "Your Presenton account is ready."
                : "Sign in once and start generating—no API keys, models, or provider setup required."}
            </p>
          </div>
        </div>

        {status.linked ? (
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={isLoggingOut}
            title="Disconnect Presenton account"
            aria-label="Disconnect Presenton account"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E4DFF0] bg-white transition-colors hover:bg-[#F7F6F9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoggingOut ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#191919]" />
            ) : (
              <Trash2 className="h-4 w-4 text-[#514A5D]" />
            )}
          </button>
        ) : null}
      </div>

      {status.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E6E0F8] bg-white/55 px-6 py-4">
          <p className="text-xs text-[#6B647A]">
            Your account is ready to generate presentations.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#7C51F8] px-5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(124,81,248,0.2)] transition hover:bg-[#6941D9]"
          >
            Continue to generation
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : !flow ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E6E0F8] bg-white/55 px-6 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#756D82]">
            <Cloud className="h-3.5 w-3.5 text-[#7C51F8]" />
            Generation runs securely in Presenton Cloud.
          </div>
          <button
            type="button"
            onClick={() => void startLink()}
            disabled={isStarting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#7C51F8] px-5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(124,81,248,0.2)] transition hover:bg-[#6941D9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStarting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {isStarting ? "Connecting…" : "Login with Presenton"}
          </button>
        </div>
      ) : null}

      {flow ? (
        <div className="border-t border-[#E6E0F8] bg-white/70 p-5">
          <p className="text-xs font-medium text-[#514a5d]">
            Approve this code in the Presenton window
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-base font-semibold tracking-[0.18em] text-[#4d436d]">
              {flow.userCode}
            </span>
            <a
              href={flow.verificationUriComplete}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6d46e6] hover:text-[#5835c2]"
            >
              Open approval page <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-[#7A7384]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for authorization…
          </div>
        </div>
      ) : null}
    </section>
  );
}
