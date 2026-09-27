import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <header className="border-line bg-bg/85 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <Image src="/icon.svg" alt="" width={28} height={28} className="size-7" />
          <span>AI Learning</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {email && (
            <form action="/auth/signout" method="post" className="flex items-center gap-3">
              <span className="text-muted hidden text-sm sm:inline">{email}</span>
              <button className="text-ink-2 hover:bg-surface-2 rounded-lg px-3 py-1.5 text-sm">Sign out</button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
