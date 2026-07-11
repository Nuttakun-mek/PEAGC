"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  pendingText?: string;
};

export function SubmitButton({
  children,
  className,
  disabled,
  pendingText = "กำลังบันทึก...",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={disabled || pending} type="submit">
      {pending ? pendingText : children}
    </button>
  );
}
