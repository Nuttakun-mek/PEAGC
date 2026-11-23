import {
  ArrowLeftRight,
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  ClipboardList,
  Coins,
  Download,
  FlagTriangleRight,
  GraduationCap,
  History,
  Hourglass,
  IdCard,
  LayoutDashboard,
  Newspaper,
  Pencil,
  Plus,
  Receipt,
  ScanQrCode,
  Search,
  ToggleRight,
  Trash2,
  Trophy,
  Upload,
  UserCheck,
  Users,
} from "lucide-react";

/**
 * One icon per meaning (UX/UI audit, Nov 2026). Import from here instead of picking a Lucide icon
 * per page, so "รางวัล" is always a trophy and "บันทึก" is always a check mark.
 * Sizes: 16px next to 14–16px text, 20px in menus, 24px in empty states.
 */
export const appIcons = {
  add: Plus,
  audit: History,
  awards: Trophy,
  calendar: CalendarDays,
  checkIn: ScanQrCode,
  coach: UserCheck,
  dashboard: LayoutDashboard,
  delete: Trash2,
  directory: IdCard,
  download: Download,
  edit: Pencil,
  events: FlagTriangleRight,
  lessons: GraduationCap,
  members: Users,
  news: Newspaper,
  notifications: Bell,
  payments: Receipt,
  points: Coins,
  reports: ChartColumn,
  reschedule: ArrowLeftRight,
  save: Check,
  scores: ClipboardList,
  search: Search,
  settings: ToggleRight,
  upload: Upload,
  waitlist: Hourglass,
} as const;

export type AppIconName = keyof typeof appIcons;
