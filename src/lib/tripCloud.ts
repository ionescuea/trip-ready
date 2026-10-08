import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trip } from "@/lib/types";

export type RemoteTripRow = {
  id: string;
  invite_code: string;
  name: string;
  data: Trip;
  updated_at: string;
};

export async function fetchRemoteTrip(
  client: SupabaseClient,
  tripId: string,
): Promise<RemoteTripRow | null> {
  const { data, error } = await client
    .from("trips")
    .select("id, invite_code, name, data, updated_at")
    .eq("id", tripId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RemoteTripRow;
}

export async function pushTrip(
  client: SupabaseClient,
  tripId: string,
  trip: Trip,
): Promise<{ error?: string }> {
  const payload = { ...trip, updatedAt: new Date().toISOString() };
  const { error } = await client
    .from("trips")
    .update({
      name: trip.name || "My trip",
      data: payload,
      updated_at: payload.updatedAt,
    })
    .eq("id", tripId);
  if (error) return { error: error.message };
  return {};
}

/** Organiser deletes a holiday they own (members cascade). */
export async function deleteOwnerTrip(
  client: SupabaseClient,
  tripId: string,
): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { data: member, error: memberError } = await client
    .from("trip_members")
    .select("role")
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) return { error: memberError.message };
  if (!member || member.role !== "owner") {
    return { error: "Only the organiser can remove this trip." };
  }

  const { error } = await client.from("trips").delete().eq("id", tripId);
  if (error) return { error: error.message };
  return {};
}

/** Create cloud trip + owner membership. Returns invite code. */
export async function createCloudTrip(
  client: SupabaseClient,
  trip: Trip,
  displayName?: string,
): Promise<{ tripId: string; inviteCode: string; error?: string }> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { tripId: "", inviteCode: "", error: "Sign in first." };

  const payload = { ...trip, updatedAt: new Date().toISOString() };

  const { data, error } = await client.rpc("create_trip_as_owner", {
    p_name: trip.name || "My trip",
    p_data: payload,
    p_display_name: displayName || user.email || "Owner",
  });

  if (error) {
    return { tripId: "", inviteCode: "", error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id || !row?.invite_code) {
    return { tripId: "", inviteCode: "", error: "Could not create trip." };
  }

  return { tripId: row.id as string, inviteCode: row.invite_code as string };
}

export async function setMemberPerson(
  client: SupabaseClient,
  tripId: string,
  personId: string | null,
  displayName?: string,
): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { error } = await client
    .from("trip_members")
    .update({
      person_id: personId,
      ...(displayName ? { display_name: displayName } : {}),
    })
    .eq("trip_id", tripId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  return {};
}

export async function joinCloudTrip(
  client: SupabaseClient,
  code: string,
  personId?: string,
  displayName?: string,
): Promise<{ tripId: string; inviteCode: string; trip: Trip | null; error?: string }> {
  const { data: tripId, error } = await client.rpc("join_trip", {
    code: code.trim(),
    p_person_id: personId ?? null,
    p_display_name: displayName ?? null,
  });

  if (error || !tripId) {
    return {
      tripId: "",
      inviteCode: "",
      trip: null,
      error: error?.message || "Could not join trip.",
    };
  }

  const remote = await fetchRemoteTrip(client, tripId as string);
  if (!remote) {
    return { tripId: tripId as string, inviteCode: code.trim().toUpperCase(), trip: null };
  }

  return {
    tripId: remote.id,
    inviteCode: remote.invite_code,
    trip: remote.data,
  };
}

export async function lookupInvite(
  client: SupabaseClient,
  code: string,
): Promise<{ people: { id: string; name: string }[]; name: string; error?: string }> {
  const { data, error } = await client.rpc("find_trip_by_invite", {
    code: code.trim(),
  });
  if (error) return { people: [], name: "", error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { people: [], name: "", error: "Invite code not found." };
  const trip = row.data as Trip;
  return {
    name: row.name || trip?.name || "Trip",
    people: (trip?.people ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
}

export type OwnerTripSummary = {
  tripId: string;
  inviteCode: string;
  personId?: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  updatedAt: string;
};

/** All holidays this signed-in user organises. */
export async function fetchMyOwnerTrips(
  client: SupabaseClient,
): Promise<{ trips: OwnerTripSummary[]; error?: string }> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { trips: [], error: "Sign in first." };

  const { data: members, error: memberError } = await client
    .from("trip_members")
    .select("trip_id, person_id, created_at")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .order("created_at", { ascending: false });

  if (memberError) return { trips: [], error: memberError.message };
  if (!members?.length) return { trips: [] };

  const ids = members.map((m) => m.trip_id as string);
  const { data: rows, error: tripError } = await client
    .from("trips")
    .select("id, invite_code, name, data, updated_at")
    .in("id", ids);

  if (tripError) return { trips: [], error: tripError.message };

  const byId = new Map(
    (rows ?? []).map((r) => [r.id as string, r as RemoteTripRow & { updated_at: string }]),
  );
  const personByTrip = new Map(
    members.map((m) => [m.trip_id as string, (m.person_id as string | null) ?? undefined]),
  );

  const trips: OwnerTripSummary[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const data = row.data as Trip;
    trips.push({
      tripId: row.id,
      inviteCode: row.invite_code,
      personId: personByTrip.get(id),
      name: (data?.name || row.name || "My trip").trim() || "My trip",
      destination: (data?.destination || "").trim(),
      startDate: (data?.startDate || "").trim(),
      endDate: (data?.endDate || "").trim(),
      updatedAt: row.updated_at || data?.updatedAt || "",
    });
  }

  trips.sort((a, b) => {
    const ta = Date.parse(a.updatedAt || "") || 0;
    const tb = Date.parse(b.updatedAt || "") || 0;
    return tb - ta;
  });

  return { trips };
}

/** Latest traveller membership for the signed-in user (if any). */
export async function fetchMyTravellerMembership(client: SupabaseClient): Promise<{
  tripId: string;
  inviteCode: string;
  role: "traveller";
  personId?: string;
  trip: Trip | null;
  error?: string;
} | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data: member, error: memberError } = await client
    .from("trip_members")
    .select("trip_id, role, person_id")
    .eq("user_id", user.id)
    .eq("role", "traveller")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (memberError) {
    return {
      tripId: "",
      inviteCode: "",
      role: "traveller",
      trip: null,
      error: memberError.message,
    };
  }
  if (!member?.trip_id) return null;

  const remote = await fetchRemoteTrip(client, member.trip_id as string);
  if (!remote) {
    return {
      tripId: member.trip_id as string,
      inviteCode: "",
      role: "traveller",
      personId: member.person_id ?? undefined,
      trip: null,
      error: "Trip not found.",
    };
  }

  return {
    tripId: remote.id,
    inviteCode: remote.invite_code,
    role: "traveller",
    personId: (member.person_id as string | null) ?? undefined,
    trip: remote.data,
  };
}

/** @deprecated Prefer fetchMyOwnerTrips + selectTrip; kept for one-trip lookups. */
export async function fetchMyMembership(client: SupabaseClient): Promise<{
  tripId: string;
  inviteCode: string;
  role: "owner" | "traveller";
  personId?: string;
  trip: Trip | null;
  error?: string;
} | null> {
  const traveller = await fetchMyTravellerMembership(client);
  if (traveller?.tripId) return traveller;

  const { trips, error } = await fetchMyOwnerTrips(client);
  if (error) {
    return {
      tripId: "",
      inviteCode: "",
      role: "owner",
      trip: null,
      error,
    };
  }
  const first = trips[0];
  if (!first) return null;
  const remote = await fetchRemoteTrip(client, first.tripId);
  return {
    tripId: first.tripId,
    inviteCode: first.inviteCode,
    role: "owner",
    personId: first.personId,
    trip: remote?.data ?? null,
  };
}

export async function claimTripByEmail(
  client: SupabaseClient,
  code: string,
  email: string,
): Promise<{
  tripId: string;
  inviteCode: string;
  personId: string;
  personName: string;
  trip: Trip | null;
  error?: string;
}> {
  const { data, error } = await client.rpc("claim_trip_by_email", {
    p_code: code.trim(),
    p_email: email.trim(),
  });
  if (error) {
    return {
      tripId: "",
      inviteCode: "",
      personId: "",
      personName: "",
      trip: null,
      error: error.message,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.trip_id || !row?.person_id) {
    return {
      tripId: "",
      inviteCode: "",
      personId: "",
      personName: "",
      trip: null,
      error: "No traveller with that email on this trip.",
    };
  }
  return {
    tripId: row.trip_id as string,
    inviteCode: (row.invite_code as string) || code.trim().toUpperCase(),
    personId: row.person_id as string,
    personName: (row.person_name as string) || "",
    trip: (row.data as Trip) ?? null,
  };
}

export async function pushTravellerSelf(
  client: SupabaseClient,
  args: {
    code: string;
    email: string;
    personId: string;
    address?: string;
    checklist?: Record<string, string>;
    luggage?: Record<string, string>;
  },
): Promise<{ trip: Trip | null; error?: string }> {
  const { data, error } = await client.rpc("push_traveller_self", {
    p_code: args.code.trim(),
    p_email: args.email.trim(),
    p_person_id: args.personId,
    p_address: args.address ?? null,
    p_checklist: args.checklist ?? null,
    p_luggage: args.luggage ?? null,
  });
  if (error) return { trip: null, error: error.message };
  return { trip: (data as Trip) ?? null };
}

export async function openOrganiserByEmail(
  client: SupabaseClient,
  email: string,
): Promise<{
  tripId: string;
  inviteCode: string;
  trip: Trip | null;
  error?: string;
}> {
  const { data, error } = await client.rpc("open_organiser_by_email", {
    p_email: email.trim(),
  });
  if (error) {
    return { tripId: "", inviteCode: "", trip: null, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.trip_id) {
    return { tripId: "", inviteCode: "", trip: null, error: "No trip for that email." };
  }
  return {
    tripId: row.trip_id as string,
    inviteCode: row.invite_code as string,
    trip: (row.data as Trip) ?? null,
  };
}

export async function createTripByOrganiserEmail(
  client: SupabaseClient,
  email: string,
  trip: Trip,
): Promise<{
  tripId: string;
  inviteCode: string;
  trip: Trip | null;
  error?: string;
}> {
  const payload = {
    ...trip,
    organiserEmail: email.trim().toLowerCase(),
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await client.rpc("create_trip_by_organiser_email", {
    p_email: email.trim(),
    p_name: trip.name || "My trip",
    p_data: payload,
  });
  if (error) {
    return { tripId: "", inviteCode: "", trip: null, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.trip_id || !row?.invite_code) {
    return { tripId: "", inviteCode: "", trip: null, error: "Could not create trip." };
  }
  return {
    tripId: row.trip_id as string,
    inviteCode: row.invite_code as string,
    trip: (row.data as Trip) ?? payload,
  };
}

/** Attach organiser email to an existing invite-code trip (or open if already set). */
export async function adoptOrganiserByCode(
  client: SupabaseClient,
  code: string,
  email: string,
): Promise<{
  tripId: string;
  inviteCode: string;
  trip: Trip | null;
  error?: string;
}> {
  const { data, error } = await client.rpc("adopt_organiser_by_code", {
    p_code: code.trim(),
    p_email: email.trim(),
  });
  if (error) {
    return { tripId: "", inviteCode: "", trip: null, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.trip_id) {
    return { tripId: "", inviteCode: "", trip: null, error: "Could not open trip." };
  }
  return {
    tripId: row.trip_id as string,
    inviteCode: row.invite_code as string,
    trip: (row.data as Trip) ?? null,
  };
}

export async function pushOrganiserTrip(
  client: SupabaseClient,
  email: string,
  trip: Trip,
): Promise<{ trip: Trip | null; error?: string }> {
  const { data, error } = await client.rpc("push_organiser_trip", {
    p_email: email.trim(),
    p_data: {
      ...trip,
      organiserEmail: email.trim().toLowerCase(),
    },
  });
  if (error) return { trip: null, error: error.message };
  return { trip: (data as Trip) ?? null };
}

/** After password sign-in: attach trip whose organiserEmail matches the account. */
export async function claimOrganiserByEmail(client: SupabaseClient): Promise<{
  tripId: string;
  inviteCode: string;
  trip: Trip | null;
  error?: string;
} | null> {
  const { data, error } = await client.rpc("claim_organiser_by_email");
  if (error) {
    return { tripId: "", inviteCode: "", trip: null, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.trip_id) return null;
  return {
    tripId: row.trip_id as string,
    inviteCode: row.invite_code as string,
    trip: (row.data as Trip) ?? null,
  };
}

/** Signed-in organiser links an existing invite-code trip as owner. */
export async function claimOrganiserByCode(
  client: SupabaseClient,
  code: string,
): Promise<{
  tripId: string;
  inviteCode: string;
  trip: Trip | null;
  error?: string;
}> {
  const { data, error } = await client.rpc("claim_organiser_by_code", {
    p_code: code.trim(),
  });
  if (error) {
    return { tripId: "", inviteCode: "", trip: null, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.trip_id) {
    return { tripId: "", inviteCode: "", trip: null, error: "Could not open trip." };
  }
  return {
    tripId: row.trip_id as string,
    inviteCode: row.invite_code as string,
    trip: (row.data as Trip) ?? null,
  };
}
