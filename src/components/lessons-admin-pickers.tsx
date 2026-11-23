"use client";

import { useState } from "react";

import { fieldHint, fieldInput, fieldLabel } from "@/components/ui/styles";
import { bayOptions, coachLabel, suggestedCapacity } from "@/lib/lessons/admin";
import { venueCapacityWarning } from "@/lib/lessons/planner";

export type PickerCoach = { full_name: string; id: string; nickname: string | null; status: string };
export type PickerVenue = { bay_count: number; capacity_per_bay: number; id: string; name: string; status: string };


/**
 * Coach of a round or course: one of the club's coaches, or a typed name when the person is not
 * in the list (guest coach). Field names: `coachId` (or `idName`) and `coachName`.
 */
export function LessonsAdminCoachPicker({
  coaches,
  currentLabel,
  defaultCoachId,
  defaultCoachName,
  disabled,
  idName = "coachId",
  label = "ผู้สอน",
}: {
  coaches: PickerCoach[];
  /** name to show when the saved coach is no longer in the list (archived) */
  currentLabel?: string | null;
  defaultCoachId?: string | null;
  defaultCoachName?: string | null;
  disabled?: boolean;
  idName?: string;
  label?: string;
}) {
  const [coachId, setCoachId] = useState(defaultCoachId ?? "");
  const options = coaches.filter((coach) => coach.status === "active" || coach.id === defaultCoachId);
  const missing = defaultCoachId && !coaches.some((coach) => coach.id === defaultCoachId) ? defaultCoachId : null;
  return (
    <div className="grid gap-3">
      <label className="block">
        <span className={fieldLabel}>{label}</span>
        <select className={fieldInput} disabled={disabled} name={idName} onChange={(event) => setCoachId(event.target.value)} value={coachId}>
          <option value="">ไม่ระบุ / พิมพ์ชื่อเอง</option>
          {missing ? <option value={missing}>{currentLabel || "ผู้สอนเดิม"} (เก็บถาวรแล้ว)</option> : null}
          {options.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coachLabel(coach)}
              {coach.status !== "active" ? " (พักการสอน)" : ""}
            </option>
          ))}
        </select>
        {!options.length ? <span className={fieldHint}>ยังไม่มีรายชื่อผู้สอน เพิ่มได้ที่แท็บ &quot;ผู้สอนและสถานที่&quot;</span> : null}
      </label>
      {!coachId ? (
        <label className="block">
          <span className={fieldLabel}>ชื่อผู้สอน (ถ้าไม่อยู่ในรายชื่อ)</span>
          <input className={fieldInput} defaultValue={defaultCoachName ?? ""} disabled={disabled} name="coachName" placeholder="เว้นว่างได้" />
        </label>
      ) : null}
    </div>
  );
}

/**
 * Venue + bay of a round: one of the club's venues (and one bay of a multi-bay venue), or a typed
 * place. Shows how many people the venue / bay takes. Field names: `venueId` (or `idName`),
 * `bayLabel`, `venue`.
 */
export function LessonsAdminVenuePicker({
  allowText = true,
  capacity,
  currentLabel,
  defaultBay,
  defaultVenueId,
  defaultVenueText,
  disabled,
  idName = "venueId",
  label = "สถานที่",
  onChange,
  showBay = true,
  venues,
}: {
  /** offer a typed place when none is picked (rounds); off for the course default */
  allowText?: boolean;
  /** current seats per round, for the "รับได้ N คน" warning */
  capacity?: number;
  /** name to show when the saved venue is no longer in the list (archived) */
  currentLabel?: string | null;
  defaultBay?: string | null;
  defaultVenueId?: string | null;
  defaultVenueText?: string | null;
  disabled?: boolean;
  idName?: string;
  label?: string;
  onChange?: (value: { bay: string; suggested: number; venueId: string }) => void;
  showBay?: boolean;
  venues: PickerVenue[];
}) {
  const [venueId, setVenueId] = useState(defaultVenueId ?? "");
  const [bay, setBay] = useState(defaultBay ?? "");
  const options = venues.filter((venue) => venue.status === "active" || venue.id === defaultVenueId);
  const venue = options.find((item) => item.id === venueId) ?? null;
  const missing = defaultVenueId && !venues.some((item) => item.id === defaultVenueId) ? defaultVenueId : null;
  const bays = bayOptions(venue);
  const warning = capacity ? venueCapacityWarning(capacity, venue, bay) : null;

  const change = (nextVenue: string, nextBay: string) => {
    setVenueId(nextVenue);
    setBay(nextBay);
    const picked = options.find((item) => item.id === nextVenue) ?? null;
    onChange?.({ bay: nextBay, suggested: suggestedCapacity(picked, nextBay), venueId: nextVenue });
  };

  return (
    <div className="grid gap-3">
      <div className={`grid gap-3 ${showBay && bays.length ? "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}>
        <label className="block">
          <span className={fieldLabel}>{label}</span>
          <select className={fieldInput} disabled={disabled} name={idName} onChange={(event) => change(event.target.value, "")} value={venueId}>
            <option value="">{allowText ? "ไม่ระบุ / พิมพ์ชื่อเอง" : "ไม่ระบุ"}</option>
            {missing ? <option value={missing}>{currentLabel || "สถานที่เดิม"} (เก็บถาวรแล้ว)</option> : null}
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.status !== "active" ? " (ปิดใช้งาน)" : ""}
              </option>
            ))}
          </select>
        </label>
        {showBay && bays.length ? (
          <label className="block">
            <span className={fieldLabel}>ช่องซ้อม</span>
            <select className={fieldInput} disabled={disabled} name="bayLabel" onChange={(event) => change(venueId, event.target.value)} value={bay}>
              <option value="">ทั้งสถานที่</option>
              {bays.map((label) => (
                <option key={label} value={label}>
                  ช่อง {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {missing && venueId === missing && defaultBay ? <input name="bayLabel" type="hidden" value={defaultBay} /> : null}
      {venue ? (
        <p className={`text-sm ${warning ? "font-medium text-warning" : "text-ink-muted"}`}>
          {warning ?? `${venue.name}${bay ? ` ช่อง ${bay}` : ""} รับได้ ${suggestedCapacity(venue, bay)} คนต่อรอบ`}
        </p>
      ) : venueId ? null : allowText ? (
        <label className="block">
          <span className={fieldLabel}>ชื่อสถานที่ (ถ้าไม่อยู่ในรายการ)</span>
          <input className={fieldInput} defaultValue={defaultVenueText ?? ""} disabled={disabled} name="venue" placeholder="เช่น สนามไดร์ฟ ช่อง 1-8" />
        </label>
      ) : null}
    </div>
  );
}
