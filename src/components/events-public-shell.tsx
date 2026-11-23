import { CLUB_NAME, ClubCrest } from "@/components/brand";

/** Frame for the public event pages (no sign-in): crest + club name, then the page. */
export function EventsPublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <ClubCrest priority size={40} />
          <p className="text-base font-semibold text-brand-600">{CLUB_NAME}</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
