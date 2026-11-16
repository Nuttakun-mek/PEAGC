import Link from "next/link";

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
    <main className="flex min-h-screen items-center justify-center px-4 py-10 text-[#2f3137]">
      <section className="w-full max-w-md rounded-2xl border border-[#e6e2ee] bg-white/95 p-6 shadow-[0_24px_60px_rgba(114,34,87,0.1)] sm:p-8">
        <Link className="flex items-center gap-3" href="/">
          <span className="flex size-11 items-center justify-center rounded-lg bg-gradient-to-br from-[#d9a521] to-[#b07d0c] text-sm font-bold text-white">
            PEA
          </span>
          <span>
            <span className="block text-sm font-bold text-[#722257]">PEAGC</span>
            <span className="block text-xs text-[#6b6475]">ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค</span>
          </span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-[#722257]">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-6 text-[#6b6475]">{description}</p> : null}
        {children}
      </section>
    </main>
  );
}

export const authInputClass =
  "mt-2 h-12 w-full rounded-lg border border-[#d9d3e6] bg-white px-4 outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10";

export const authButtonClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#722257] px-4 text-sm font-semibold text-white transition hover:bg-[#8b2d6b] disabled:cursor-wait disabled:bg-[#9a94a6]";
