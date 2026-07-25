import { UserRound } from "lucide-react";

import LogoutButton from "@/components/Auth/LogoutButton";

type UserAccountSettingsProps = {
  username: string;
};

export default function UserAccountSettings({
  username,
}: UserAccountSettingsProps) {
  return (
    <div className="min-h-screen font-syne">
      <main className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
        <h1 className="font-unbounded text-[28px] font-normal tracking-[-0.84px] text-black">
          Settings
        </h1>

        <section
          className="mt-8 rounded-[20px] border border-[#EDEEEF] bg-white p-7"
          aria-labelledby="account-heading"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#F4F3FF]">
              <UserRound
                className="h-5 w-5 text-[#5146E5]"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#77787C]">
                Username
              </p>
              <h2
                id="account-heading"
                className="mt-1 truncate font-unbounded text-lg font-normal text-black"
              >
                {username}
              </h2>
            </div>
          </div>

          <LogoutButton
            label="Sign out"
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-[58px] border border-[#EDEEEF] bg-[#7C51F8] px-5 py-3 font-syne text-xs font-semibold text-white transition hover:bg-[#6d46e6] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </section>
      </main>
    </div>
  );
}
