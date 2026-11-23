"use client";

import { House, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { appIcons } from "@/lib/icons";

type Tab = { icon: typeof House; id: string; label: string };

export type MemberTabId = "top" | "lessons" | "events" | "scores" | "me";

/**
 * Phone-only bottom tab bar for /member. Each tab jumps to a section of the same page (#top,
 * #lessons, #events, #scores, #me); tabs for modules the club has switched off are left out.
 * The tab whose section is in the middle of the screen is highlighted. `hrefs` sends a tab to
 * another page (เรียน → /member/lessons); on such a page pass `current` to fix the highlight.
 */
export function MemberTabBar({
  current,
  events,
  hrefs,
  lessons,
  scores,
  unread = 0,
}: {
  /** Fixed active tab (sub-pages such as /member/lessons); turns off the scroll highlight. */
  current?: MemberTabId;
  events: boolean;
  /** Link per tab instead of the same-page anchor `#id`. */
  hrefs?: Partial<Record<MemberTabId, string>>;
  lessons: boolean;
  scores: boolean;
  /** Unread notifications, shown as a count on "ฉัน". */
  unread?: number;
}) {
  const tabs: Tab[] = [
    { icon: House, id: "top", label: "หน้าแรก" },
    ...(lessons ? [{ icon: appIcons.lessons, id: "lessons", label: "เรียน" }] : []),
    ...(events ? [{ icon: appIcons.events, id: "events", label: "กิจกรรม" }] : []),
    ...(scores ? [{ icon: appIcons.scores, id: "scores", label: "สกอร์" }] : []),
    { icon: UserRound, id: "me", label: "ฉัน" },
  ];
  const ids = tabs.map((tab) => tab.id).join(" ");
  const [observed, setActive] = useState("top");
  const active = current ?? observed;

  useEffect(() => {
    if (current || typeof IntersectionObserver === "undefined") return;
    const sections = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    // A thin band across the middle of the screen: the section crossing it is the current one.
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((entry) => entry.isIntersecting);
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [current, ids]);

  return (
    <nav
      aria-label="เมนูสมาชิก"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          const count = tab.id === "me" ? unread : 0;
          return (
            <li className="flex-1" key={tab.id}>
              <a
                aria-current={selected ? (current ? "page" : "location") : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-xs ${selected ? "font-semibold text-brand-600" : "font-medium text-ink-subtle"}`}
                href={hrefs?.[tab.id as MemberTabId] ?? `#${tab.id}`}
                onClick={() => setActive(tab.id)}
              >
                <Icon className="size-5" aria-hidden="true" />
                {tab.label}
                {count ? (
                  <span className="absolute left-1/2 top-2 ml-2 min-w-5 rounded-full bg-gold-500 px-1.5 text-center text-xs font-semibold leading-5 text-gold-ink tabular-nums">
                    {count > 99 ? "99+" : count}
                    <span className="sr-only"> แจ้งเตือนใหม่</span>
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
