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
