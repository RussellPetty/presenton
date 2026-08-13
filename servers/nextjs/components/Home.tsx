"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { RootState } from "@/store/store";
import OnBoardingSlidebar from "./OnBoarding/OnBoardingSlidebar";
import OnBoardingHeader from "./OnBoarding/OnBoardingHeader";
import PresentonMode from "./OnBoarding/PresentonMode";
import FinalStep from "./OnBoarding/FinalStep";
import Image from "next/image";

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<number>(2)
  const [providerStep, setProviderStep] = useState<number>(1)
  const config = useSelector((state: RootState) => state.userConfig);

  const canChangeKeys = config.can_change_keys;

  useEffect(() => {
    if (!canChangeKeys) {
      router.push("/upload");
    }
  }, [canChangeKeys, router]);

  if (!canChangeKeys) {
    return null;
  }

  const isInitialProviderStep = step === 2 && providerStep === 1;

  if (isInitialProviderStep) {
    return (
      <div className="grid min-h-screen bg-white xl:grid-cols-[minmax(0,840px)_600px]">
        <main className="relative min-w-0 px-6 pb-10 pt-[134px] sm:px-12 xl:px-0">
          <div className="absolute left-6 top-12 flex h-6 items-center gap-[29px] sm:left-12 xl:left-[162px]">
            <Image
              src="/onboarding-presenton-logo.png"
              alt="Presenton"
              width={116}
              height={24}
              priority
              className="h-6 w-[116px] object-contain"
            />
            <div className="flex items-center gap-[3px]" aria-hidden="true">
              <span className="h-1 w-[7px] rounded-full bg-[#EDEEEF]" />
              <span className="h-1 w-[14px] rounded-full bg-[#7A5AF8]" />
              <span className="h-1 w-[7px] rounded-full bg-[#EDEEEF]" />
              <span className="h-1 w-[7px] rounded-full bg-[#EDEEEF]" />
            </div>
          </div>
          <div className="mx-auto w-full max-w-[520px] xl:ml-[160px] xl:mr-0">
            <PresentonMode
              providerStep={providerStep}
              setStep={setStep}
              setProviderStep={setProviderStep}
            />
          </div>
        </main>
        <aside className="hidden h-[757px] overflow-hidden xl:sticky xl:top-0 xl:block">
          <Image
            src="/onboarding-presenton-cloud.png"
            alt=""
            width={600}
            height={757}
            priority
            className="h-full w-full object-cover object-top"
          />
        </aside>
      </div>
    );
  }

  return (

    <div className="flex min-h-screen relative">
      <OnBoardingSlidebar step={step} />
      <main className="w-full pl-20 pr-8 max-w-[1440px] mx-auto relative z-10">

        <OnBoardingHeader currentStep={step} providerStep={providerStep} setStep={setStep} setProviderStep={setProviderStep} />
        {step === 2 && <PresentonMode providerStep={providerStep} setStep={setStep} setProviderStep={setProviderStep} />}
        {step === 3 && <FinalStep />}
      </main>
    </div>
  );
}
