"use client";

import { useMemo } from "react";
import { useCloud } from "@/context/CloudContext";
import {
  canEditPersonChecks,
  canEditTripStructure,
  isOwnerEditingOther,
  isTravellerMember,
  isTripOwner,
} from "@/lib/permissions";

export function usePermissions() {
  const { meta } = useCloud();

  return useMemo(() => {
    const myPersonId = meta?.personId;
    return {
      meta,
      myPersonId,
      isOwner: isTripOwner(meta),
      isTraveller: isTravellerMember(meta),
      canEditTrip: canEditTripStructure(meta),
      canEditPerson: (personId: string) => canEditPersonChecks(meta, personId),
      isEditingOther: (personId: string) => isOwnerEditingOther(meta, personId),
    };
  }, [meta]);
}
