"use client";

type Props = {
  children: React.ReactNode;
};

/** Soft notice when a linked traveller is viewing a page they can’t edit. */
export function ViewOnlyBanner({ children }: Props) {
  return (
    <div className="view-only-banner" role="status">
      {children}
    </div>
  );
}

type OwnerProps = {
  personName: string;
};

export function OwnerEditWarning({ personName }: OwnerProps) {
  return (
    <div className="owner-edit-banner" role="status">
      You’re editing <strong>{personName}</strong>’s list as the trip owner. Each change asks for
      confirmation so a mis-tap doesn’t update them by accident.
    </div>
  );
}
