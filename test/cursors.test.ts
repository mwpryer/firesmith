import { beforeEach, describe, expect, it } from "bun:test";

import { documentId } from "@/index";
import { allKits } from "./emulator";
import { places, posts, samplePlace, seedUsers, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("cursors", () => {
      beforeEach(async () => {
        await kit.clear();
        await seedUsers(kit);
      });

      it("bounds inclusively with startAt/endAt, exclusively with startAfter/endBefore", async () => {
        const byAge = kit.db.collection(users).orderBy("age");
        const startAt = await byAge.startAt(30).get();
        expect(startAt.map((u) => u.name)).toEqual(["B", "C"]);
        const startAfter = await byAge.startAfter(30).get();
        expect(startAfter.map((u) => u.name)).toEqual(["C"]);
        const endAt = await byAge.endAt(30).get();
        expect(endAt.map((u) => u.name)).toEqual(["A", "B"]);
        const endBefore = await byAge.endBefore(30).get();
        expect(endBefore.map((u) => u.name)).toEqual(["A"]);
      });

      it("paginates with startAfter from a fetched value", async () => {
        const byAge = kit.db.collection(users).orderBy("age");
        const first = await byAge.limit(1).get();
        expect(first.map((u) => u.name)).toEqual(["A"]);
        const next = await byAge.startAfter(first[0]!.age).limit(1).get();
        expect(next.map((u) => u.name)).toEqual(["B"]);
      });

      it("paginates through equal sort values without skipping documents", async () => {
        const col = kit.db.collection(posts);
        await col.set("a", {
          title: "A",
          likes: 10,
        });
        await col.set("b", {
          title: "B",
          likes: 10,
        });
        await col.set("c", {
          title: "C",
          likes: 20,
        });

        const byLikes = col.orderBy("likes").orderBy(documentId()).limit(1);
        const first = await byLikes.get();
        expect(first.map((post) => post.id)).toEqual(["a"]);
        const second = await byLikes
          .startAfter(first[0]!.likes, first[0]!.id)
          .get();
        expect(second.map((post) => post.id)).toEqual(["b"]);
        const third = await byLikes
          .startAfter(second[0]!.likes, second[0]!.id)
          .get();
        expect(third.map((post) => post.id)).toEqual(["c"]);
        expect(
          await byLikes.startAfter(third[0]!.likes, third[0]!.id).get(),
        ).toEqual([]);
      });

      it("starts after a returned document, tie-broken by its id", async () => {
        const col = kit.db.collection(places);
        await col.set("a", samplePlace());
        await col.set("b", samplePlace());
        await col.set("c", {
          ...samplePlace(),
          stats: {
            visits: 1,
            lastVisit: new Date("2020-01-01T00:00:00.000Z"),
          },
        });
        const byVisits = col.orderBy("stats.visits").orderBy(documentId());
        const first = (await byVisits.limit(1).get())[0]!;

        const next = await byVisits.startAfterDoc(first).get();

        expect(next.map((place) => place.id)).toEqual(["b", "c"]);
      });

      it("bounds by a Date cursor", async () => {
        // Seeded users share the sample date, so an earlier bound is empty
        const byDate = kit.db.collection(users).orderBy("createdAt");
        expect((await byDate.get()).length).toBe(3);
        const earlier = new Date("2019-01-01T00:00:00.000Z");
        expect(await byDate.endBefore(earlier).get()).toEqual([]);
      });

      it("rejects a cursor without an orderBy", async () => {
        await expect(
          // @ts-expect-error a cursor needs an orderBy
          kit.db.collection(users).query().startAt(20).get(),
        ).rejects.toThrow();
      });
    });
  });
}
