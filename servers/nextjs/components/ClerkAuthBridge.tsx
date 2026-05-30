"use client";

import { useEffect } from "react";
import { initClerkAuthBridge } from "@/utils/clerkToken";

/**
 * Mounts the Clerk auth bridge once on the client. No-op when not embedded
 * (standalone / DISABLE_AUTH deployments are unaffected). Renders nothing.
 */
export default function ClerkAuthBridge() {
  useEffect(() => {
    initClerkAuthBridge();
  }, []);

  return null;
}
