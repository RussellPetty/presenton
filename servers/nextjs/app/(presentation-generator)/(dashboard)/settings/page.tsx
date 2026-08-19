import { redirect } from "next/navigation";

import { pageTitle } from "@/lib/branding";

export const metadata = {
  title: pageTitle("Settings"),
};

/**
 * Not part of the embed. Provider keys come from the environment
 * (CAN_CHANGE_KEYS=false), so there is nothing here for a user to change, and
 * the page also exposes upstream's cloud-provider connection UI.
 *
 * SettingPage/UserAccountSettings are left in the tree, just not mounted.
 */
export default function Page() {
  redirect("/dashboard");
}
