"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AddressField } from "@/components/AddressField";
import { PageHeader } from "@/components/PageHeader";
import { OwnerEditWarning, ViewOnlyBanner } from "@/components/PermissionBanners";
import { PersonalChecklist } from "@/components/PersonalChecklist";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { getDriverPerson } from "@/lib/driver";
import { withPersonAddress, withPersonEmail, withPersonName } from "@/lib/personAddress";
import { DOCUMENT_ROWS, LUGGAGE_ROWS } from "@/lib/types";

export function TravellerDetailPage() {
  const params = useParams<{ personId: string }>();
  const router = useRouter();
  const { trip, toggleChecklist, toggleLuggage, update, updatePersonDetails, removeTraveller } =
    useTrip();
  const { canEditPerson, canEditTrip, isEditingOther, isTraveller, myPersonId } =
    usePermissions();
  if (!trip) return null;

  const person = trip.people.find((p) => p.id === params.personId);
  if (!person) {
    return (
      <>
        <PageHeader title="Traveller" backHref="/travellers" />
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Traveller not found.
          </p>
        </section>
      </>
    );
  }

  const editable = canEditPerson(person.id);
  const ownerOther = isEditingOther(person.id);
  const driver = getDriverPerson(trip);
  const isDriver = driver?.id === person.id;
  const canDelete = canEditTrip && trip.people.length > 1;

  function handleRemove() {
    if (!canDelete) return;
    const ok = window.confirm(
      `Remove ${person!.name} from this trip?\n\nTheir packing ticks will be deleted.`,
    );
    if (!ok) return;
    removeTraveller(person!.id);
    router.replace("/travellers");
  }

  if (isTraveller && myPersonId && person.id !== myPersonId) {
    return (
      <>
        <PageHeader title={person.name} backHref="/travellers" />
        <ViewOnlyBanner>
          This is someone else’s packing list. Open{" "}
          <Link href={`/travellers/${myPersonId}`}>your list</Link> to tick documents and
          bags.
        </ViewOnlyBanner>
        <section className="panel" style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            View-only — you can’t change {person.name}’s checks.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title={person.name} backHref="/travellers" />
      {ownerOther ? <OwnerEditWarning personName={person.name} /> : null}
      {!editable ? (
        <ViewOnlyBanner>View only — you can’t edit this packing list.</ViewOnlyBanner>
      ) : null}
      <div className="toolbar" style={{ marginBottom: "1rem" }}>
        <Link href="/wallet" className="btn btn-ghost">
          Open wallet
        </Link>
        {canDelete ? (
          <button type="button" className="btn btn-ghost" onClick={handleRemove}>
            Remove traveller
          </button>
        ) : null}
      </div>

      <div className="col">
        {canEditTrip ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Name</h2>
            </div>
            <label className="field">
              <span>Traveller</span>
              <input
                value={person.name}
                onChange={(e) =>
                  update((t) => withPersonName(t, person.id, e.target.value))
                }
              />
            </label>
          </section>
        ) : null}

        {editable ? (
          <section className="panel">
            <div className="panel-head">
              <h2>{isDriver ? "Driver start" : "Pick-up address"}</h2>
            </div>
            <p className="muted" style={{ margin: "0 0 0.75rem" }}>
              {isDriver
                ? "You’re the driver — this is where the leave-by route starts (not a pick-up)."
                : "Saved when you leave the field. Leave-by adds you as a stop on the drive automatically."}
            </p>
            <AddressField
              label={isDriver ? "Start address / postcode" : "Address / postcode"}
              value={person.address ?? ""}
              onChange={(address) =>
                updatePersonDetails(person.id, (t) =>
                  withPersonAddress(t, person.id, address),
                )
              }
            />
            {canEditTrip ? (
              <label className="field" style={{ marginTop: "0.85rem" }}>
                <span>Email (for invite access)</span>
                <input
                  type="email"
                  value={person.email ?? ""}
                  placeholder="traveller@email.com"
                  onChange={(e) =>
                    update((t) => withPersonEmail(t, person.id, e.target.value))
                  }
                />
              </label>
            ) : person.email ? (
              <p className="muted" style={{ margin: "0.75rem 0 0" }}>
                Access email: {person.email}
              </p>
            ) : null}
          </section>
        ) : null}

        <PersonalChecklist
          title="Documents"
          items={DOCUMENT_ROWS}
          getStatus={(key) => trip.checklist[person.id]?.[key]}
          onToggle={(key) => {
            if (!editable) return;
            toggleChecklist(person.id, key);
          }}
          disabled={!editable}
        />
        <PersonalChecklist
          title="Luggage"
          items={LUGGAGE_ROWS}
          getStatus={(key) => trip.luggage?.[person.id]?.[key]}
          onToggle={(key) => {
            if (!editable) return;
            toggleLuggage(person.id, key);
          }}
          disabled={!editable}
        />
      </div>
    </>
  );
}
