"use client";

import Link from "next/link";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
};

export function PageHeader({ title, subtitle, backHref = "/" }: Props) {
  return (
    <header className="page-header">
      <Link href={backHref} className="page-back">
        ‹ Back
      </Link>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
