import type { SupabaseClient } from "@supabase/supabase-js";
import type { TicketPass } from "@/lib/types";

export const TICKET_BUCKET = "trip-tickets";
/** Soft limit for embedding files in trip JSON (local / no cloud storage). */
export const LOCAL_TICKET_MAX_BYTES = 3_500_000;

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120) || "ticket.pdf";
}

export function ticketObjectPath(
  cloudTripId: string,
  ticketId: string,
  fileName: string,
): string {
  return `${cloudTripId}/${ticketId}/${safeFileName(fileName)}`;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export async function uploadTicketFile(opts: {
  client: SupabaseClient | null;
  cloudTripId: string | null;
  ticketId: string;
  file: File;
}): Promise<{ storagePath?: string; dataUrl?: string; error?: string }> {
  const { client, cloudTripId, ticketId, file } = opts;

  if (client && cloudTripId) {
    const path = ticketObjectPath(cloudTripId, ticketId, file.name);
    const { error } = await client.storage.from(TICKET_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
    if (error) {
      // Bucket missing / RLS — fall through to local embed if small enough
      if (file.size > LOCAL_TICKET_MAX_BYTES) {
        return {
          error: `${error.message} Upload the trip to the cloud and run ticket-storage.sql, or use a smaller file.`,
        };
      }
      const dataUrl = await fileToDataUrl(file);
      return { dataUrl };
    }
    return { storagePath: path };
  }

  if (file.size > LOCAL_TICKET_MAX_BYTES) {
    return {
      error:
        "File is too large to keep in this browser only. Sign in, upload the trip to the cloud, then add the pass again.",
    };
  }
  const dataUrl = await fileToDataUrl(file);
  return { dataUrl };
}

export async function resolveTicketUrl(opts: {
  client: SupabaseClient | null;
  ticket: TicketPass;
}): Promise<{ url?: string; error?: string }> {
  const { client, ticket } = opts;
  if (ticket.dataUrl) return { url: ticket.dataUrl };
  if (!ticket.storagePath) {
    return { error: "This pass has no file attached." };
  }
  if (!client) {
    return { error: "Sign in to open cloud boarding passes." };
  }
  const { data, error } = await client.storage
    .from(TICKET_BUCKET)
    .createSignedUrl(ticket.storagePath, 60 * 60);
  if (error || !data?.signedUrl) {
    return { error: error?.message || "Could not open pass." };
  }
  return { url: data.signedUrl };
}

export async function deleteTicketFile(opts: {
  client: SupabaseClient | null;
  ticket: TicketPass;
}): Promise<{ error?: string }> {
  if (!opts.ticket.storagePath || !opts.client) return {};
  const { error } = await opts.client.storage
    .from(TICKET_BUCKET)
    .remove([opts.ticket.storagePath]);
  if (error) return { error: error.message };
  return {};
}
