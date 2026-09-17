"use client";

import { FlagsList } from "@/components/FlagsList";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { ReadinessMatrix } from "@/components/ReadinessMatrix";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";

export function ReadyPage() {
  const { trip, flags, toggleChecklist } = useTrip();
  const { isTraveller, canEditPerson, myPersonId } = usePermissions();
  if (!trip) return null;

  return (
    <>
      <PageHeader title="Group readiness" />
      {isTraveller ? (
        <ViewOnlyBanner>
          You can tick <strong>your</strong> column only
          {myPersonId
            ? ` (${trip.people.find((p) => p.id === myPersonId)?.name ?? "you"})`
            : ""}
          . Other travellers’ boxes are locked.
        </ViewOnlyBanner>
      ) : null}
      <FlagsList flags={flags} />
      <div style={{ height: "0.85rem" }} />
      <ReadinessMatrix
        trip={trip}
        onToggle={toggleChecklist}
        canEditPerson={canEditPerson}
      />
    </>
  );
}
