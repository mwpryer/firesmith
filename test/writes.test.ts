import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";

import {
  arrayUnion,
  collection,
  deleteField,
  increment,
  isTimestampLike,
  serverTimestamp,
} from "@/index";
import { allKits } from "./emulator";
import { places, samplePlace, sampleUser, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    beforeEach(() => kit.clear());

    describe("sentinels and partial writes", () => {
      it("passes serverTimestamp through to a native timestamp", async () => {
        await kit.db
          .collection(users)
          .set("john", { ...sampleUser(), createdAt: serverTimestamp() });
        const stored = (await kit.rawGet("users/john"))!;
        expect(isTimestampLike(stored.createdAt)).toBe(true);
      });

      it("applies increment and arrayUnion atomically in update", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser({ age: 36 }));
        await col.update("john", {
          age: increment(4),
          tags: arrayUnion("tag2"),
        });
        const john = await col.get("john");
        expect(john!.age).toBe(40);
        expect(john!.tags).toEqual(["tag1", "tag2"]);
      });

      it("merge set updates the named fields, leaving the rest intact", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        await col.set("john", { age: 37 }, { merge: true });
        const john = await col.get("john");
        expect(john!.age).toBe(37);
        expect(john!.name).toBe("John Doe");
      });

      it("mergeFields writes only the listed fields", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        await col.set(
          "john",
          { age: 50, name: "Jane Doe" },
          {
            mergeFields: ["age"],
          },
        );
        const john = await col.get("john");
        expect(john!.age).toBe(50);
        expect(john!.name).toBe("John Doe");
      });

      it("clears a field with deleteField in update and in a merge set", async () => {
        const docs = collection(
          "docs",
          z.object({ a: z.number(), b: z.number().optional() }),
        );
        const col = kit.db.collection(docs);
        await col.set("x", { a: 1, b: 2 });
        await col.update("x", { b: deleteField() });
        expect((await col.get("x"))!.b).toBeUndefined();

        await col.set("x", { a: 1, b: 5 });
        await col.set("x", { b: deleteField() }, { merge: true });
        expect((await col.get("x"))!.b).toBeUndefined();
      });

      it("merge set preserves required siblings and deletes optional nested fields", async () => {
        const records = collection(
          "records",
          z.object({
            stats: z.object({
              a: z.number(),
              b: z.number(),
              c: z.number().optional(),
            }),
          }),
        );
        const col = kit.db.collection(records);
        await col.set("r1", {
          stats: {
            a: 1,
            b: 2,
            c: 3,
          },
        });

        await col.set(
          "r1",
          {
            stats: {
              a: increment(5),
              c: deleteField(),
            },
          },
          { merge: true },
        );

        expect(await col.get("r1")).toEqual({
          id: "r1",
          meta: { path: "records/r1" },
          stats: {
            a: 6,
            b: 2,
          },
        });
      });

      it("update replaces a nested map wholesale, merge set merges into it", async () => {
        const records = collection(
          "records",
          z.object({
            stats: z.object({ a: z.number(), b: z.number().optional() }),
          }),
        );
        const col = kit.db.collection(records);
        // Update drops b, unlike a merge set
        await col.set("r1", { stats: { a: 1, b: 2 } });
        await col.update("r1", { stats: { a: 9 } });
        expect((await col.get("r1"))!.stats).toEqual({ a: 9 });

        // A merged whole-map value nests sentinels, increment sees the stored value
        await col.set("r1", { stats: { a: increment(5) } }, { merge: true });
        expect((await col.get("r1"))!.stats).toEqual({ a: 14 });

        // Update replaces the map, so the nested increment starts from nothing
        await col.update("r1", { stats: { a: increment(1) } });
        expect((await col.get("r1"))!.stats).toEqual({ a: 1 });
      });
    });

    describe("dotted-path updates", () => {
      it("updates nested fields, sentinels included, by dotted path", async () => {
        const col = kit.db.collection(places);
        await col.set("p1", samplePlace());
        await col.update("p1", { "address.city": "Leeds" });
        await col.update("p1", {
          "address.geo.lat": increment(50),
          "stats.lastVisit": serverTimestamp(),
        });

        const p = await col.get("p1");
        expect(p!.address.city).toBe("Leeds");
        expect(p!.address.geo).toEqual({ lat: 51, lng: 2 });
        const stored = (await kit.rawGet("places/p1"))! as {
          stats: { lastVisit: unknown };
        };
        expect(isTimestampLike(stored.stats.lastVisit)).toBe(true);
      });

      it("deletes an optional nested field by dotted path", async () => {
        const col = kit.db.collection(places);
        await col.set("p1", {
          ...samplePlace(),
          address: {
            city: "London",
            zip: "111",
            geo: { lat: 1, lng: 2 },
            note: "x",
          },
        });
        await col.update("p1", { "address.note": deleteField() });
        expect((await col.get("p1"))!.address.note).toBeUndefined();
      });

      it("mergeFields accepts partial maps and nested deletions, writing only listed paths", async () => {
        const col = kit.db.collection(places);
        await col.set("p1", {
          name: "Acme",
          address: {
            city: "London",
            zip: "111",
            geo: {
              lat: 1,
              lng: 2,
            },
            note: "Remove me",
          },
          stats: {
            visits: 0,
            lastVisit: new Date("2020-01-01T00:00:00.000Z"),
          },
        });
        await col.set(
          "p1",
          {
            name: "New",
            address: {
              city: "Leeds",
              note: deleteField(),
            },
          },
          { mergeFields: ["address.city", "address.note"] },
        );
        expect(await col.get("p1")).toEqual({
          id: "p1",
          meta: { path: "places/p1" },
          name: "Acme",
          address: {
            city: "Leeds",
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
        });
      });
    });
  });
}
