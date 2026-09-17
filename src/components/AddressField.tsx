"use client";

import { useEffect, useRef, useState } from "react";
import {
  ADDRESS_PLACEHOLDER,
  addressFormatWarning,
  softNormalizeUkAddress,
} from "@/lib/addressFormat";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
};

/**
 * Local draft while typing so cloud sync / parent re-renders don’t eat spaces
 * or reset the caret mid-keystroke.
 */
export function AddressField({ label, value, onChange, className, id }: Props) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function flush(next: string, normalize: boolean) {
    const out = normalize ? softNormalizeUkAddress(next) : next;
    if (normalize && out !== next) setDraft(out);
    if (out !== value) onChange(out);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next, false), 500);
  }

  return (
    <label className={className ? `field ${className}` : "field"}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        value={draft}
        placeholder={ADDRESS_PLACEHOLDER}
        autoComplete="street-address"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          if (timer.current) clearTimeout(timer.current);
          flush(draft, true);
        }}
        onChange={handleChange}
      />
      {addressFormatWarning(draft) ? (
        <span className="address-format-warn">{addressFormatWarning(draft)}</span>
      ) : null}
    </label>
  );
}
