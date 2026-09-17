"use client";

import {
  ADDRESS_PLACEHOLDER,
  addressFormatWarning,
} from "@/lib/addressFormat";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
};

/** Shared address input — placeholder shows the expected format; warn only when needed. */
export function AddressField({ label, value, onChange, className, id }: Props) {
  const warning = addressFormatWarning(value);

  return (
    <label className={className ? `field ${className}` : "field"}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={ADDRESS_PLACEHOLDER}
        autoComplete="street-address"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {warning ? <span className="address-format-warn">{warning}</span> : null}
    </label>
  );
}
