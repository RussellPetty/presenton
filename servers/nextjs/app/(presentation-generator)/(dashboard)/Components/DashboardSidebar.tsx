"use client";

import React from "react";
import { LayoutDashboard, Star, Brain, UsersRound } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";



export const defaultNavItems = [
    { key: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
    { key: "templates" as const, label: "Standard", icon: Star },
    { key: "designs" as const, label: "Smart", icon: Brain },
    { key: "community" as const, label: "Community", icon: UsersRound },
];

// Settings is not reachable in the embed (provider keys come from env), so the
// nav array is empty rather than removed — DashboardNav still imports it.
export const BelongingNavItems: { key: string; label: string; icon: unknown }[] = [];

const DashboardSidebar = () => {
    const pathname = usePathname();

    return (
        <aside
            className="sticky top-0 flex h-screen w-[114px] shrink-0 flex-col justify-between border-r border-[#E1E1E5] bg-[#F6F6F9] px-4 py-8 backdrop-blur"
            aria-label="Dashboard sidebar"
        >
            <div>

                <Link href={`/dashboard`} className="flex items-center  pb-6 border-b border-[#E1E1E5]   gap-2    ">
                    {/* White-label: no upstream logo. The embedding app supplies
                        the branding, so this is a neutral spacer. */}
                    <div className="h-[40px] w-full" aria-hidden="true" />
                </Link>
                <nav className="pt-6 font-syne" aria-label="Dashboard sections">
                    <div className="  space-y-6">

                        {/* Dashboard */}
                        <Link
                            prefetch={false}
                            href={`/dashboard`}
                            className={[
                                "flex flex-col tex-center items-center gap-2  transition-colors",
                                pathname === "/dashboard" ? "" : "ring-transparent",
                            ].join(" ")}
                            aria-label="Dashboard"
                            title="Dashboard"
                        >
                            <LayoutDashboard className={["h-4 w-4", pathname === "/dashboard" ? "text-[#5146E5]" : "text-slate-600"].join(" ")} />
                            <span className="text-[11px] text-slate-800">Dashboard</span>
                        </Link>
                        <Link
                            prefetch={false}
                            href={`/templates`}
                            className={[
                                "flex flex-col tex-center items-center gap-2  transition-colors",
                                pathname === "/templates" ? "" : "ring-transparent",
                            ].join(" ")}
                            aria-label="Templates"
                            title="Templates"
                        >
                            <div className="flex flex-col cursor-pointer tex-center items-center gap-2  transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={`${pathname === "/templates" ? "#5146E5" : "#475569"}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M4 14h6" /><path d="M4 2h10" /><rect x="4" y="18" width="16" height="4" rx="1" /><rect x="4" y="6" width="16" height="4" rx="1" /></svg>
                                <span className="text-[11px] text-slate-800">Templates</span>
                            </div>
                        </Link>
                        {/* Community is Presenton Cloud's gallery; not part of the embed. */}
                        {/* <Link
                            prefetch={false}
                            href={`/theme`}
                            className={[
                                "flex flex-col tex-center items-center gap-2  transition-colors",
                                pathname === "/theme" ? "" : "ring-transparent",
                            ].join(" ")}
                            aria-label="Theme"
                            title="Theme"
                        >
                            <div className="flex flex-col cursor-pointer tex-center items-center gap-2  transition-colors">
                                <Palette className={`h-4 w-4 ${pathname === "/theme" ? "text-[#5146E5]" : "text-slate-600"}`} />
                                <span className="text-[11px] text-slate-800">Themes</span>
                            </div>
                        </Link> */}
                    </div>
                </nav>
            </div>

            {/* Settings (provider keys come from env, CAN_CHANGE_KEYS=false) and
                Help (docs.presenton.ai) are both removed from the embed. */}

        </aside>
    );
};

export default DashboardSidebar;
