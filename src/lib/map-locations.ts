import type { DemoJob } from "@/lib/demo";
import { TOKYO_DELIVERY_PLACES } from "./tokyo-locations";

export { TORANOMON_FORUM } from "./tokyo-locations";

export type MapPoint = [latitude: number, longitude: number];

// Approximate neighborhood centers, not geocoded delivery addresses. Unknown
// neighborhoods deliberately have no marker rather than an invented location.
const AREA_CENTERS: Record<string, MapPoint> = {
  ...Object.fromEntries(
    Object.values(TOKYO_DELIVERY_PLACES).map((place) => [
      place.name.toLowerCase(),
      place.point,
    ]),
  ),
  "toronomon hills forum": TOKYO_DELIVERY_PLACES.forum.point,
  虎ノ門ヒルズフォーラム: TOKYO_DELIVERY_PLACES.forum.point,
  虎ノ門ヒルズ: TOKYO_DELIVERY_PLACES.forum.point,
  神谷町: TOKYO_DELIVERY_PLACES.kamiyacho.point,
  新橋: TOKYO_DELIVERY_PLACES.shinbashi.point,
  愛宕: TOKYO_DELIVERY_PLACES.atago.point,
  西新橋: TOKYO_DELIVERY_PLACES.nishiShimbashi.point,
  芝公園: TOKYO_DELIVERY_PLACES.shibaPark.point,
  麻布台ヒルズ: TOKYO_DELIVERY_PLACES.azabudaiHills.point,
  toranomon: TOKYO_DELIVERY_PLACES.forum.point,
  "toranomon hills": TOKYO_DELIVERY_PLACES.forum.point,
  "nishi shimbashi": TOKYO_DELIVERY_PLACES.nishiShimbashi.point,
  "nishi-shinbashi": TOKYO_DELIVERY_PLACES.nishiShimbashi.point,
  shimbashi: TOKYO_DELIVERY_PLACES.shinbashi.point,
  shibakoen: TOKYO_DELIVERY_PLACES.shibaPark.point,
  // Retain legacy lookups for user-created deliveries outside this workspace.
  "hayes valley": [37.7759, -122.4245],
  "mission district": [37.7599, -122.4148],
  mission: [37.7599, -122.4148],
  "lower haight": [37.7721, -122.4312],
  "pacific heights": [37.7925, -122.4382],
  soma: [37.7785, -122.4056],
  "south of market": [37.7785, -122.4056],
  castro: [37.7609, -122.435],
  "the castro": [37.7609, -122.435],
  "noe valley": [37.7502, -122.4337],
  "nob hill": [37.793, -122.4161],
  marina: [37.803, -122.4368],
  "marina district": [37.803, -122.4368],
  "north beach": [37.8006, -122.409],
  "richmond district": [37.7809, -122.4643],
  "sunset district": [37.7537, -122.4942],
  "financial district": [37.7946, -122.3999],
  dogpatch: [37.7591, -122.3885],
  "potrero hill": [37.7591, -122.401],
};

export function getAreaCenter(area: string): MapPoint | null {
  return AREA_CENTERS[area.trim().toLowerCase()] ?? null;
}

export function getJobMapLocations(
  job: Pick<DemoJob, "pickup" | "destination">,
) {
  return {
    pickup: getAreaCenter(job.pickup),
    destination: getAreaCenter(job.destination),
  };
}

export const NEARBY_RADIUS_KM = 25;

export function distanceKm(from: MapPoint, to: MapPoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(to[0] - from[0]);
  const longitude = radians(to[1] - from[1]);
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(from[0])) *
      Math.cos(radians(to[0])) *
      Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
