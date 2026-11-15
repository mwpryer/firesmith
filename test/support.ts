import * as z from "zod";

import type { Database } from "@/core/database";
import { collection } from "@/index";
import type { GeoPoint, Timestamp } from "@/index";

// Each driver under test supplies one of these, the suites are otherwise driver agnostic
export interface DriverKit {
  readonly name: string;
  readonly db: Database;
  // Raw stored data read through the underlying SDK, bypassing firesmith coercion
  rawGet(path: string): Promise<Record<string, unknown> | undefined>;
  // Wipe every document so each test starts from an empty database
  clear(): Promise<void>;
  // A genuine SDK Timestamp for this driver, the read path must hand it back untouched
  timestamp(seconds: number, nanoseconds: number): Timestamp;
  // Whether a value is this driver's real SDK Timestamp class, not a firesmith copy
  isSdkTimestamp(value: unknown): boolean;
  // A genuine SDK GeoPoint, an unrecognised class instance the boundary passes through untouched
  geoPoint(latitude: number, longitude: number): GeoPoint;
  // Whether a value is this driver's real SDK GeoPoint class
  isSdkGeoPoint(value: unknown): boolean;
  // A genuine SDK bytes value, web a Bytes class and admin a Buffer
  bytes(data: Uint8Array): unknown;
  // Whether a value is this driver's raw stored bytes form, not a neutral Uint8Array
  isSdkBytes(value: unknown): boolean;
}

export const users = collection(
  "users",
  z.object({
    name: z.string(),
    age: z.number(),
    createdAt: z.date(),
    tags: z.array(z.string()).default([]),
    profile: z.object({ bio: z.string() }).optional(),
  }),
);

export const posts = collection(
  "posts",
  z.object({
    title: z.string(),
    likes: z.number(),
  }),
);

// Shared by the dotted-path writes suite and the update/write type surfaces
export const places = collection(
  "places",
  z.object({
    name: z.string(),
    address: z.object({
      city: z.string(),
      zip: z.string(),
      geo: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      note: z.string().optional(),
    }),
    stats: z.object({
      visits: z.number(),
      lastVisit: z.date(),
    }),
  }),
);

export function sampleUser(
  overrides: Partial<z.output<typeof users.schema>> = {},
) {
  return {
    name: "John Doe",
    age: 36,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    tags: ["tag1"],
    ...overrides,
  };
}

export function samplePlace() {
  return {
    name: "Acme",
    address: {
      city: "London",
      zip: "111",
      geo: {
        lat: 1,
        lng: 2,
      },
    },
    stats: {
      visits: 0,
      lastVisit: new Date("2020-01-01T00:00:00.000Z"),
    },
  };
}

// Seed users a, b, c aged 20, 30, 40 for the query and cursor suites
export async function seedUsers(kit: DriverKit): Promise<void> {
  const col = kit.db.collection(users);
  await col.set(
    "a",
    sampleUser({
      name: "A",
      age: 20,
    }),
  );
  await col.set(
    "b",
    sampleUser({
      name: "B",
      age: 30,
    }),
  );
  await col.set(
    "c",
    sampleUser({
      name: "C",
      age: 40,
    }),
  );
}

// Let an awaited write settle and any spurious listener delivery arrive
export function settle(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll until a listener has reached the expected state, real listeners are async
export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
