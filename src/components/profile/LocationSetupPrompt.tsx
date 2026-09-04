/**
 * LocationSetupPrompt — the first thing new members see after claiming a
 * profile. Without a city they are invisible on the map; this card makes
 * that obvious and keeps the form to one city + country.
 */

import { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle, Loader2, MapPin, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type LocationCheckState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

interface LocationSetupPromptProps {
  firstName: string;
  city: string;
  country: string;
  onCityChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  locationCheck: LocationCheckState;
  isSaving: boolean;
  onSaveAndViewMap: () => void;
  onDismiss: () => void;
}

export function LocationSetupPrompt({
  firstName,
  city,
  country,
  onCityChange,
  onCountryChange,
  locationCheck,
  isSaving,
  onSaveAndViewMap,
  onDismiss,
}: LocationSetupPromptProps) {
  const cityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => cityRef.current?.focus(), 300);
    return () => window.clearTimeout(t);
  }, []);

  const canSave =
    city.trim().length > 0 &&
    !isSaving &&
    locationCheck.status !== "checking";

  return (
    <section
      className="overflow-hidden rounded-[1.75rem] border-2 border-sky-300 bg-gradient-to-br from-sky-50 via-white to-emerald-50 shadow-lg shadow-sky-100/60"
      aria-labelledby="location-setup-title"
    >
      <div className="border-b border-sky-200/80 bg-white/60 px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 ring-1 ring-sky-200/80">
            <MapPin className="size-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2
              id="location-setup-title"
              className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl"
            >
              {firstName ? `${firstName}, where are you based?` : "Where are you based?"}
            </h2>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="location-setup-city">City</Label>
            <Input
              ref={cityRef}
              id="location-setup-city"
              value={city}
              onChange={(e) => onCityChange(e.target.value)}
              placeholder="e.g. Berlin, San Francisco"
              autoComplete="address-level2"
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-setup-country">Country</Label>
            <Input
              id="location-setup-country"
              value={country}
              onChange={(e) => onCountryChange(e.target.value)}
              placeholder="e.g. Germany, United States"
              autoComplete="country-name"
              className="h-11"
            />
          </div>
        </div>

        {locationCheck.status !== "idle" && locationCheck.message ? (
          <LocationSetupNotice state={locationCheck} />
        ) : (
          <p className="text-xs text-gray-500">
            Use one city only — where you&apos;re usually based, not every place
            you travel.
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-[44px] text-sm font-medium text-gray-500 transition-colors hover:text-gray-800 touch-manipulation"
          >
            I&apos;ll do this later
          </button>
          <Button
            type="button"
            size="lg"
            disabled={!canSave}
            onClick={onSaveAndViewMap}
            className="min-h-[48px] w-full gap-2 font-semibold sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden />
                Save &amp; show me on the map
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

function LocationSetupNotice({ state }: { state: LocationCheckState }) {
  const tone =
    state.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state.status === "error"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-sky-200 bg-sky-50 text-sky-900";

  const Icon =
    state.status === "success"
      ? CheckCircle
      : state.status === "error"
        ? AlertCircle
        : Loader2;

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${tone}`}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={`mt-0.5 size-5 shrink-0 ${state.status === "checking" ? "animate-spin" : ""}`}
        aria-hidden
      />
      <span>{state.message}</span>
    </div>
  );
}
