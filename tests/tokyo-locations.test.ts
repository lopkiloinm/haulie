import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INITIAL_STATE,
  parseSnapshot,
  type DemoJob,
} from "../src/lib/demo";
import {
  TORANOMON_FORUM,
  distanceKm,
  getAreaCenter,
  getJobMapLocations,
} from "../src/lib/map-locations";
import { SEEDED_DELIVERY_ROUTES } from "../src/lib/tokyo-locations";

const locationFields = [
  "pickup",
  "destination",
  "pickupAddress",
  "destinationAddress",
] as const;
type Route = Pick<DemoJob, (typeof locationFields)[number]>;
const oldDefault: Route = {
  pickup: "Hayes Valley",
  destination: "Mission District",
  pickupAddress: "450 Hayes St, San Francisco",
  destinationAddress: "890 Valencia St, San Francisco",
};
const oldRoutes: Record<string, Route> = {
  "HL-1048": { ...oldDefault },
  "HL-1047": {
    pickup: "Lower Haight",
    destination: "Pacific Heights",
    pickupAddress: "203 Fillmore St, San Francisco",
    destinationAddress: "2100 Jackson St, San Francisco",
  },
  "HL-1046": {
    ...oldDefault,
    destination: "SoMa",
    destinationAddress: "830 Folsom St, San Francisco",
  },
  "HL-1045": { ...oldDefault, pickup: "Castro" },
  "HL-1044": { ...oldDefault, destination: "Noe Valley" },
  "HL-1043": { ...oldDefault, pickup: "Nob Hill", destination: "Marina" },
};

function withoutLocations(job: DemoJob) {
  return Object.fromEntries(
    Object.entries(job).filter(
      ([key]) => !locationFields.includes(key as (typeof locationFields)[number]),
    ),
  );
}

describe("Toranomon delivery areas", () => {
  it("maps every seeded pickup and drop-off within three kilometers of the Forum", () => {
    assert.equal(INITIAL_STATE.jobs.length, 6);
    assert.deepEqual(TORANOMON_FORUM.point, [35.66694, 139.74944]);
    assert.equal(getAreaCenter(TORANOMON_FORUM.name), TORANOMON_FORUM.point);
    for (const job of INITIAL_STATE.jobs) {
      const route = getJobMapLocations(job);
      assert.ok(route.pickup, `${job.id} pickup must have a map marker`);
      assert.ok(route.destination, `${job.id} drop-off must have a map marker`);
      for (const point of [route.pickup, route.destination])
        assert.ok(distanceKm(TORANOMON_FORUM.point, point) < 3, `${job.id} stays local`);
      assert.match(job.pickupAddress, /Minato-ku, Tokyo$/);
      assert.match(job.destinationAddress, /Minato-ku, Tokyo$/);
      assert.doesNotMatch(JSON.stringify(job), /San Francisco/);
    }
    const available = INITIAL_STATE.jobs.find((job) => job.id === "HL-1046")!;
    assert.equal(available.pickup, "Toranomon Hills Forum");
    assert.equal(available.destination, "Kamiyacho");
    assert.equal(available.status, "FUNDED");
  });

  it("supports the nearby area labels and preserves legacy/custom lookup behavior", () => {
    for (const name of [
      "Toranomon Hills Station Tower",
      "Toranomon Hills Business Tower",
      "Atago",
      "Nishi-Shimbashi",
      "Shinbashi",
      "Kamiyacho",
      "Shiba Park",
      "Azabudai Hills",
    ]) {
      const point = getAreaCenter(`  ${name.toUpperCase()}  `);
      assert.ok(point, name);
      assert.ok(distanceKm(TORANOMON_FORUM.point, point) < 3);
    }
    assert.ok(getAreaCenter("Hayes Valley"), "custom legacy jobs retain their map locations");
    assert.equal(getAreaCenter("Unknown delivery location"), null);
  });
});

describe("saved seed route migration", () => {
  it("updates old routes without losing delivery progress, World proofs, wallets, or history", () => {
    const saved = structuredClone(INITIAL_STATE);
    saved.businessName = "Saved workspace";
    saved.jobs = saved.jobs.map((job) => ({ ...job, ...oldRoutes[job.id] }));
    const verified = saved.jobs.find((job) => job.id === "HL-1046")!;
    Object.assign(verified, {
      status: "ASSIGNED",
      courier: "Jamie Chen",
      initials: "JC",
      acceptVerified: true,
      pickupVerified: true,
      payoutWallet: `0x${"a".repeat(64)}`,
      worldAcceptedAt: 1_790_409_600,
      worldPickedUpAt: 1_790_409_660,
    });
    verified.events.push({
      title: "World pickup verified",
      actor: "Courier",
      at: "2026-09-26T09:01:00.000Z",
    });
    const migrated = parseSnapshot(JSON.stringify(saved));
    assert.equal(migrated.businessName, saved.businessName);
    for (const [index, job] of migrated.jobs.entries()) {
      assert.deepEqual(withoutLocations(job), withoutLocations(saved.jobs[index]));
      for (const field of locationFields)
        assert.equal(job[field], SEEDED_DELIVERY_ROUTES[job.id][field]);
    }
    assert.deepEqual(parseSnapshot(JSON.stringify(migrated)), migrated, "migration is idempotent");
  });

  it("preserves each user-edited field while migrating untouched seeded fields", () => {
    for (const original of INITIAL_STATE.jobs) {
      for (const editedField of locationFields) {
        const edited = {
          ...original,
          ...oldRoutes[original.id],
          [editedField]: "A user-selected location",
        };
        const parsed = parseSnapshot(JSON.stringify({ ...INITIAL_STATE, jobs: [edited] }));
        const migrated = parsed.jobs[0];
        assert.equal(migrated[editedField], "A user-selected location");
        for (const field of locationFields.filter((value) => value !== editedField))
          assert.equal(migrated[field], SEEDED_DELIVERY_ROUTES[original.id][field]);
        assert.deepEqual(withoutLocations(migrated), withoutLocations(edited));
      }
    }
  });

  it("does not relocate custom jobs or overwrite routes already edited in Tokyo", () => {
    const custom = {
      ...structuredClone(INITIAL_STATE.jobs[0]),
      ...oldDefault,
      id: "HL-9000",
      title: "User-created delivery",
    };
    const edited = {
      ...structuredClone(INITIAL_STATE.jobs[1]),
      pickup: "Roppongi",
      destination: "Akasaka",
      pickupAddress: "Roppongi 1-chome, Minato-ku, Tokyo",
      destinationAddress: "Akasaka 2-chome, Minato-ku, Tokyo",
    };
    const saved = { ...INITIAL_STATE, jobs: [custom, edited] };
    assert.deepEqual(parseSnapshot(JSON.stringify(saved)), saved);
  });
});
