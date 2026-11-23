import Link from "next/link";

import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { buttonClass, fieldInputClass } from "@/components/ui/styles";

/** Centered card used by the small account screens (forgot / change password). */
export function AuthCard({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
        <Link className="flex items-center gap-3" href="/">
          <ClubCrest priority size={52} />
          <span className="text-sm font-semibold leading-5 text-brand-600">{CLUB_NAME}</span>
        </Link>
        <h1 className="mt-6 text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600">{title}</h1>
        {description ? <p className="mt-2 text-ink-subtle">{description}</p> : null}
        {children}
      </section>
    </main>
  );
}

export const authInputClass = fieldInputClass("lg");

export const authButtonClass = `${buttonClass("primary", "lg")} w-full`;
