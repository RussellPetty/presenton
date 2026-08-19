import React from "react";
import { Metadata } from "next";
import OutlinePage from "./components/OutlinePage";
import { pageTitle } from "@/lib/branding";

export const metadata: Metadata = {
  // White-label embed: no upstream canonical/OG/Twitter metadata. This runs in
  // an iframe and is never indexed or shared as its own page.
  title: pageTitle("Outline"),
  robots: { index: false, follow: false },
};

const page = () => {
  return (
    <div className="relative min-h-screen" translate="no">
      <OutlinePage />
    </div>
  );
};

export default page;
