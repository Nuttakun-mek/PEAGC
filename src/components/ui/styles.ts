/**
 * Shared class strings so buttons and fields look the same on every page. Colours come from the
 * design tokens in globals.css; do not put hex values in className.
 *
 * Sizes are chosen through the builders, not by appending utilities: Tailwind v4 orders utilities
 * of the same property by value, so `${buttonPrimary} h-9` keeps h-10 and `text-base` loses to
 * `text-sm`. Use `buttonClass("danger", "sm")` or `fieldInputClass("lg")` instead.
 */

export type ButtonVariant = "primary" | "secondary" | "gold" | "danger" | "ghost";
export type ControlSize = "sm" | "md" | "lg";

const buttonSizes: Record<ControlSize, string> = {
  lg: "h-12 px-5 text-base",
  md: "h-10 px-4 text-sm",
  sm: "h-9 px-3 text-sm",
};

const buttonVariants: Record<ButtonVariant, string> = {
  // Main action of a form or page (plum).
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  // Secondary / cancel / "แก้ไข" (white with border).
  secondary: "border border-line bg-white text-brand-600 hover:border-brand-600 hover:bg-brand-50",
  // Gold accent. Dark gold with white text passes WCAG AA (5.27:1); never white on gold-500.
  gold: "bg-gold-700 text-white hover:bg-gold-ink",
  // Destructive (delete, archive, reject).
  danger: "border border-danger/30 bg-white text-danger hover:bg-danger-bg",
  // Low-emphasis text button.
  ghost: "text-brand-600 hover:bg-brand-50",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ControlSize = "md") {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonSizes[size]} ${buttonVariants[variant]}`;
}

export const buttonPrimary = buttonClass("primary");
export const buttonSecondary = buttonClass("secondary");
export const buttonGold = buttonClass("gold");
export const buttonDanger = buttonClass("danger");

/** Form label above a field. */
export const fieldLabel = "block text-sm font-medium text-ink-muted";

const inputHeights: Record<ControlSize, string> = { lg: "h-12", md: "h-11", sm: "h-10" };

const fieldSurface =
  "w-full rounded-lg border border-line bg-white text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10";

/** Text input / select with the label-gap margin. Font size is forced to 16px globally (see globals.css). */
export function fieldInputClass(size: ControlSize = "md", { margin = true }: { margin?: boolean } = {}) {
  return `${margin ? "mt-1.5 " : ""}${inputHeights[size]} px-3 ${fieldSurface}`;
}

export const fieldInput = fieldInputClass("md");

/** Multi-line text. */
export const fieldTextarea = `mt-1.5 min-h-28 px-3 py-2.5 ${fieldSurface}`;

/** Helper text under a field. */
export const fieldHint = "mt-1 block text-xs text-ink-subtle";

/** White card surface. */
export const card = "rounded-xl border border-line bg-white p-5 shadow-card";
