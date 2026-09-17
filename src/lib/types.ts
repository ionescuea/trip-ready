export type BookingType = "flight" | "hotel" | "parking" | "other";

/** What we need from every confirmation. */
export type BookingStatus = "unpaid" | "paid" | "confirmed" | "unknown";

export type BookingDetails = {
  /** Airline route, hotel name, car park name, etc. */
  name?: string;
  /** Booking / confirmation reference */
  number?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  status: BookingStatus;
  /** Passenger / guest names */
  people?: string;
  /** Bags, shuttle, terminal, balance, and other useful bits */
  usefulInfo?: string;
  /**
   * Minutes before departure to be at the airport — only when the booking states it.
   * Leave-by uses this ahead of defaults.
   */
  arriveEarlyMinutes?: string;

  // Kept for leave-by / readiness engines (not shown as main form labels)
  departureAirport?: string;
  arrivalAirport?: string;
  airport?: string;
  cabinBags?: string;
  holdBags?: string;
  locationRelative?: string;
  terminal?: string;
  shuttleIncluded?: string;
  shuttleDetails?: string;
  transferMinutes?: string;
  vehicleReg?: string;
  remainingBalance?: string;
  /**
   * Parking: the “people on booking” driver is confirmed as the trip route start.
   * Required before leave-by routing is trusted.
   */
  routeStart?: boolean;
};

/** @deprecated use BookingDetails — kept for gradual migration */
export type FlightFields = BookingDetails;
export type HotelFields = BookingDetails;
export type ParkingFields = BookingDetails;

export type ChecklistKey =
  | "on_flight"
  | "on_hotel"
  | "paid"
  | "check_in"
  | "tickets_wallet"
  | "passport_packed"
  | "passport_rules"
  | "visa"
  | "cabin_bag"
  | "hold_bag";

/** Per-traveller packing list (separate from document readiness). */
export type LuggageKey =
  | "clothes"
  | "toiletries"
  | "electronics"
  | "meds"
  | "adapters"
  | "documents_wallet"
  | "cabin_packed"
  | "hold_packed";

export type CellStatus = "done" | "todo" | "attention" | "na";

export type Person = {
  id: string;
  name: string;
  /** Home / pick-up address or postcode */
  address?: string;
};

/** User-added stop before parking (petrol, pick-up, etc.). */
export type ExtraStop = {
  id: string;
  label: string;
  /**
   * Time spent at the stop (fill up, wait for traveller).
   * Drive time between addresses comes from the map route.
   */
  minutes: number;
  /** Street / postcode for multi-leg map routing */
  address?: string;
  /** When picking someone up — use that traveller’s address if set */
  personId?: string;
};

/** One road leg from the last map estimate (home → stop → … → parking). */
export type DriveLeg = {
  fromLabel: string;
  toLabel: string;
  minutes: number;
  distanceKm?: number;
};

export type Booking = {
  id: string;
  type: BookingType;
  sourceName: string;
  rawText: string;
  extracted: BookingDetails;
  confirmed: boolean;
  createdAt: string;
};

export type ChecklistState = Record<
  string, // personId
  Partial<Record<ChecklistKey, CellStatus>>
>;

export type LuggageState = Record<
  string, // personId
  Partial<Record<LuggageKey, CellStatus>>
>;

export type Trip = {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  /** Any town/city you leave from */
  fromTown?: string;
  /** Any town/city / airport area you drive to */
  toTown?: string;
  driveAirport?: string;
  /** Home street / postcode — preferred map origin over fromTown alone */
  homePostcode?: string;
  /** Who drives / leaves first — route starts at their address */
  driverPersonId?: string;
  driveMinutes?: number;
  driveDistanceKm?: number;
  /** Last mapped multi-leg breakdown (home → stops → parking) */
  driveLegs?: DriveLeg[];
  parkingMinutes?: number;
  /**
   * Minutes between parking arrival and airport deadline (safety buffer).
   * Default 40 (e.g. parking 02:30 → airport 03:10). Transfer sits inside this.
   */
  parkingSafetyWindowMinutes?: number;
  /**
   * Extra stops before the drive (petrol, pick someone up, etc.).
   * Added into leave-home — parking/airport times stay fixed.
   */
  extraStops?: ExtraStop[];
  people: Person[];
  bookings: Booking[];
  checklist: ChecklistState;
  /** Per-traveller luggage packing checklist */
  luggage?: LuggageState;
  updatedAt: string;
};

export type Flag = {
  id: string;
  severity: "red" | "yellow";
  title: string;
  detail: string;
};

export const CHECKLIST_ROWS: { key: ChecklistKey; label: string }[] = [
  { key: "on_flight", label: "On the flight booking" },
  { key: "on_hotel", label: "Hotel guest list" },
  { key: "paid", label: "Balance / paid" },
  { key: "check_in", label: "Online check-in done" },
  { key: "tickets_wallet", label: "Tickets printed / saved to wallet" },
  { key: "passport_packed", label: "Passport packed" },
  { key: "passport_rules", label: "Passport rules OK" },
  { key: "visa", label: "Visa / ETIAS" },
  { key: "cabin_bag", label: "Cabin bag OK" },
  { key: "hold_bag", label: "Hold bag OK / bought" },
];

/** Documents & trip admin — for each traveller’s personal page */
export const DOCUMENT_ROWS: { key: ChecklistKey; label: string }[] = [
  { key: "passport_packed", label: "Passport packed" },
  { key: "passport_rules", label: "Passport rules OK" },
  { key: "visa", label: "Visa / ETIAS" },
  { key: "check_in", label: "Online check-in done" },
  { key: "tickets_wallet", label: "Tickets printed / saved to wallet" },
  { key: "on_flight", label: "On the flight booking" },
  { key: "on_hotel", label: "On the hotel guest list" },
  { key: "paid", label: "Balance / paid" },
];

/** Luggage packing — each traveller manages their own */
export const LUGGAGE_ROWS: { key: LuggageKey; label: string }[] = [
  { key: "clothes", label: "Clothes packed" },
  { key: "toiletries", label: "Toiletries" },
  { key: "electronics", label: "Phone / laptop / chargers" },
  { key: "adapters", label: "Travel adapters" },
  { key: "meds", label: "Medication" },
  { key: "documents_wallet", label: "Wallet / cards / cash" },
  { key: "cabin_packed", label: "Cabin bag packed" },
  { key: "hold_packed", label: "Hold bag packed" },
];

export const BOOKING_STATUS_OPTIONS: { value: BookingStatus; label: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "unpaid", label: "Unpaid" },
  { value: "paid", label: "Paid" },
  { value: "confirmed", label: "Confirmed / booked" },
];
