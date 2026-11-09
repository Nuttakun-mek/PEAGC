/**
 * Admin list pages share `?status=` between the filter dropdown and post-action feedback
 * (e.g. `?status=updated`). Only treat the value as a filter when it is a real filter option,
 * otherwise a successful save would filter the list down to nothing.
 */
export function pickFilter(value: string | undefined, allowed: readonly string[], fallback = "all") {
  return value && allowed.includes(value) ? value : fallback;
}
