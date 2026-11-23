"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

/** Password field with a show/hide toggle. Pair it with `<label htmlFor={id}>` (the toggle is a button, so it must not sit inside the label). */
export function PasswordInput({
  autoComplete,
  className,
  describedBy,
  disabled,
  id,
  minLength = 8,
  name,
  required = true,
}: {
  autoComplete: "current-password" | "new-password";
  className: string;
  describedBy?: string;
  disabled?: boolean;
  id: string;
  minLength?: number;
  name: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        aria-describedby={describedBy}
        autoComplete={autoComplete}
        className={`${className} pr-12`}
        data-required-message="กรุณากรอกรหัสผ่าน"
        disabled={disabled}
        id={id}
        minLength={minLength}
        name={name}
        required={required}
        type={visible ? "text" : "password"}
      />
      <button
        aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 mt-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle transition hover:bg-brand-50 hover:text-brand-600"
        onClick={() => setVisible((value) => !value)}
        type="button"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
