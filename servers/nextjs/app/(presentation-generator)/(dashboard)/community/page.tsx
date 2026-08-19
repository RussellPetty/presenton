import { redirect } from "next/navigation";

import { pageTitle } from "@/lib/branding";

export const metadata = {
  title: pageTitle(),
};

/**
 * The community gallery is served by upstream's hosted cloud and is branded as
 * theirs, so it is not reachable from the embed. CommunityPage is left in the
 * tree, just not mounted.
 */
export default function Page() {
  redirect("/dashboard");
}
