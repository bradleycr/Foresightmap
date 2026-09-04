/**
 * PersonAvatar — profile photo with a graceful, branded fallback.
 *
 * A raw <img> shows the browser's broken-image glyph when a URL is dead
 * (people paste links that later expire or were never direct image links).
 * This component owns that failure mode in one place: when there's no URL or
 * the image fails to load, it renders the member's initials over a faint
 * Foresight wheel — the same visual language as the profile header and the
 * signed-in chip in the app header.
 *
 * Sizing/rounding comes from `className` so cards (rounded-full) and the
 * profile hero (rounded-2xl) can share the same behavior.
 */

import { useEffect, useState } from "react";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { cn } from "./ui/utils";

interface PersonAvatarProps {
  /** Full name — used for the initials fallback. */
  name: string;
  /** Image URL; empty/null renders the fallback immediately. */
  src?: string | null;
  /** Size, rounding, border, etc. Applied to both image and fallback. */
  className?: string;
  /** Tune initials size per spot (defaults suit a 40–48px avatar). */
  textClassName?: string;
  /** Browser fetch hint. Table / lists should pass "lazy". */
  loading?: "lazy" | "eager";
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function PersonAvatar({
  name,
  src,
  className,
  textClassName,
  loading,
}: PersonAvatarProps) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt (e.g. user fixes their photo link).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const url = src?.trim() || null;

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        className={cn("object-cover", className)}
        referrerPolicy="no-referrer"
        decoding="async"
        loading={loading}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-sky-50/80",
        className,
      )}
    >
      <img
        src={foresightIconUrl}
        alt=""
        className="absolute inset-0 size-full scale-125 object-contain p-0.5 opacity-40"
      />
      <span
        className={cn(
          "relative z-10 text-xs font-medium text-sky-700/85",
          textClassName,
        )}
      >
        {initialsOf(name)}
      </span>
    </div>
  );
}
