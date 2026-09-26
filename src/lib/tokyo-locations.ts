import type { MapPoint } from "./map-locations";

export const TORANOMON_FORUM = {
  name: "Toranomon Hills Forum",
  point: [35.66694, 139.74944] as MapPoint,
  address:
    "Toranomon Hills Mori Tower 5F, 1-23-3 Toranomon, Minato-ku, Tokyo",
};

// These are approximate area centers, not geocoded doorsteps. Apart from the
// public Forum venue, addresses identify a neighborhood block rather than a
// fictional business, recipient's building, or entrance.
export const TOKYO_DELIVERY_PLACES = {
  forum: TORANOMON_FORUM,
  stationTower: {
    name: "Toranomon Hills Station Tower",
    point: [35.66796, 139.7478] as MapPoint,
    address: "Toranomon 2-chome, Minato-ku, Tokyo",
  },
  businessTower: {
    name: "Toranomon Hills Business Tower",
    point: [35.66745, 139.75015] as MapPoint,
    address: "Toranomon 1-chome, Minato-ku, Tokyo",
  },
  atago: {
    name: "Atago",
    point: [35.66475, 139.74996] as MapPoint,
    address: "Atago 1-chome, Minato-ku, Tokyo",
  },
  nishiShimbashi: {
    name: "Nishi-Shimbashi",
    point: [35.6659, 139.7535] as MapPoint,
    address: "Nishi-Shimbashi 2-chome, Minato-ku, Tokyo",
  },
  shinbashi: {
    name: "Shinbashi",
    point: [35.6662, 139.7581] as MapPoint,
    address: "Shinbashi 3-chome, Minato-ku, Tokyo",
  },
  kamiyacho: {
    name: "Kamiyacho",
    point: [35.66294, 139.74584] as MapPoint,
    address: "Toranomon 5-chome, Minato-ku, Tokyo",
  },
  shibaPark: {
    name: "Shiba Park",
    point: [35.6553, 139.749] as MapPoint,
    address: "Shibakoen 4-chome, Minato-ku, Tokyo",
  },
  azabudaiHills: {
    name: "Azabudai Hills",
    point: [35.66004, 139.74045] as MapPoint,
    address: "Azabudai 1-chome, Minato-ku, Tokyo",
  },
};

type DeliveryRoute = {
  pickup: string;
  destination: string;
  pickupAddress: string;
  destinationAddress: string;
};

function route(
  from: keyof typeof TOKYO_DELIVERY_PLACES,
  to: keyof typeof TOKYO_DELIVERY_PLACES,
): DeliveryRoute {
  const pickup = TOKYO_DELIVERY_PLACES[from];
  const destination = TOKYO_DELIVERY_PLACES[to];
  return {
    pickup: pickup.name,
    destination: destination.name,
    pickupAddress: pickup.address,
    destinationAddress: destination.address,
  };
}

export const SEEDED_DELIVERY_ROUTES: Record<string, DeliveryRoute> = {
  "HL-1048": route("forum", "shinbashi"),
  "HL-1047": route("businessTower", "atago"),
  "HL-1046": route("forum", "kamiyacho"),
  "HL-1045": route("stationTower", "nishiShimbashi"),
  "HL-1044": route("forum", "shibaPark"),
  "HL-1043": route("azabudaiHills", "forum"),
};

const legacyDefaults: DeliveryRoute = {
  pickup: "Hayes Valley",
  destination: "Mission District",
  pickupAddress: "450 Hayes St, San Francisco",
  destinationAddress: "890 Valencia St, San Francisco",
};
const LEGACY_SEEDED_ROUTES: Record<string, DeliveryRoute> = {
  "HL-1048": { ...legacyDefaults },
  "HL-1047": {
    pickup: "Lower Haight",
    destination: "Pacific Heights",
    pickupAddress: "203 Fillmore St, San Francisco",
    destinationAddress: "2100 Jackson St, San Francisco",
  },
  "HL-1046": {
    ...legacyDefaults,
    destination: "SoMa",
    destinationAddress: "830 Folsom St, San Francisco",
  },
  "HL-1045": { ...legacyDefaults, pickup: "Castro" },
  "HL-1044": { ...legacyDefaults, destination: "Noe Valley" },
  "HL-1043": { ...legacyDefaults, pickup: "Nob Hill", destination: "Marina" },
};

export function migrateSeededRoute<T extends DeliveryRoute & { id: string }>(
  job: T,
): T {
  if (!Object.hasOwn(LEGACY_SEEDED_ROUTES, job.id)) return job;
  const oldRoute = LEGACY_SEEDED_ROUTES[job.id];
  const nextRoute = SEEDED_DELIVERY_ROUTES[job.id];
  let updated = job;
  for (const key of Object.keys(oldRoute) as Array<keyof DeliveryRoute>) {
    if (job[key] === oldRoute[key]) {
      if (updated === job) updated = { ...job };
      updated[key] = nextRoute[key];
    }
  }
  return updated;
}
