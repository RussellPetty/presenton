"use client";

import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";

import {
  isEmbedClerkMode,
  onBranding,
  type PresentonBranding,
} from "@/utils/clerkToken";
import ThemeApi from "@/app/(presentation-generator)/services/api/theme";
import { updateTheme } from "@/store/slices/presentationGeneration";

const BRAND_THEME_NAME = "Brand";

/**
 * Embedded (Clerk) only: when the broker posts `branding` alongside the token,
 * idempotently create the user's brand custom theme (palette generated from
 * their primary/background colors + logo) and apply it as the active theme.
 *
 * No-op standalone. Fully wrapped in try/catch so any failure just leaves the
 * user on the default theme rather than breaking the app.
 */
export default function BrandingTheme() {
  const dispatch = useDispatch();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!isEmbedClerkMode()) return;

    onBranding(async (branding: PresentonBranding) => {
      if (appliedRef.current) return;
      if (
        !branding ||
        (!branding.primaryColor && !branding.backgroundColor && !branding.logoUrl)
      ) {
        return;
      }
      appliedRef.current = true;

      try {
        // Reuse an existing brand theme if we already created one for this user.
        const existing = await ThemeApi.getThemes().catch(() => [] as any[]);
        let theme = (existing || []).find(
          (t: any) => t?.name === BRAND_THEME_NAME
        );

        if (!theme) {
          const generated = await ThemeApi.generateTheme({
            primary: branding.primaryColor,
            background: branding.backgroundColor,
          });
          const data = (generated && (generated.data ?? generated)) || null;
          if (!data?.colors) return; // palette unavailable; leave default theme
          theme = await ThemeApi.createTheme({
            name: BRAND_THEME_NAME,
            description: "Auto-applied from your brand settings",
            logo: null,
            logo_url: branding.logoUrl ?? null,
            company_name: null,
            data,
          });
        }

        if (theme?.data?.colors) {
          dispatch(updateTheme(theme));
        }
      } catch (error) {
        console.warn("[branding] failed to apply brand theme", error);
        appliedRef.current = false; // allow a later retry on the next branding push
      }
    });
  }, [dispatch]);

  return null;
}
