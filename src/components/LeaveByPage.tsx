"use client";

import { LeaveByPanel } from "@/components/LeaveByPanel";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { withDriver, withDriverStartAddress } from "@/lib/driver";
import { withPersonAddress } from "@/lib/personAddress";

export function LeaveByPage() {
  const { trip, update } = useTrip();
  const { canEditTrip } = usePermissions();
  if (!trip) return null;

  return (
    <>
      <PageHeader title="Leave home by" />
      {!canEditTrip ? (
        <ViewOnlyBanner>
          View only — leave-by times and pick-ups are managed by the trip owner.
        </ViewOnlyBanner>
      ) : null}
      <div className={canEditTrip ? undefined : "page-readonly"}>
        <LeaveByPanel
          trip={trip}
          readOnly={!canEditTrip}
          onChangeDriver={(personId) => update((t) => withDriver(t, personId))}
          onChangeFromTown={(fromTown) => update((t) => ({ ...t, fromTown }))}
          onChangeToTown={(toTown) => update((t) => ({ ...t, toTown }))}
          onChangeHomeAddress={(address) =>
            update((t) => withDriverStartAddress(t, address))
          }
          onChangePersonAddress={(personId, address) =>
            update((t) => withPersonAddress(t, personId, address))
          }
          onChangeDrive={(minutes, distanceKm, legs, orderedStops) =>
            update((t) => ({
              ...t,
              driveMinutes: minutes,
              ...(distanceKm !== undefined ? { driveDistanceKm: distanceKm } : {}),
              ...(legs !== undefined ? { driveLegs: legs } : { driveLegs: undefined }),
              ...(orderedStops !== undefined ? { extraStops: orderedStops } : {}),
            }))
          }
          onChangeParking={(minutes) => update((t) => ({ ...t, parkingMinutes: minutes }))}
          onChangeExtraStops={(extraStops) => update((t) => ({ ...t, extraStops }))}
        />
      </div>
    </>
  );
}
