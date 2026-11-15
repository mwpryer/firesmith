import { beforeEach, describe, expect, it } from "bun:test";
import * as z from "zod";

import { collection, documentId } from "@/index";
import { allKits } from "./emulator";
import { sampleUser, seedUsers, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("queries", () => {
      beforeEach(async () => {
        await kit.clear();
        await seedUsers(kit);
      });

      it("filters and orders", async () => {
        const docs = await kit.db
          .collection(users)
          .where("age", ">=", 30)
          .orderBy("age", "desc")
          .list();
        expect(docs.map((u) => u.name)).toEqual(["C", "B"]);
      });

      it("limits", async () => {
        const docs = await kit.db
          .collection(users)
          .orderBy("age")
          .limit(1)
          .get();
        expect(docs.map((u) => u.name)).toEqual(["A"]);
      });

      it("filters with in", async () => {
        const docs = await kit.db
          .collection(users)
          .where("age", "in", [20, 40])
          .get();
        expect(docs.map((u) => u.name).sort()).toEqual(["A", "C"]);
      });

      it("filters with array-contains", async () => {
        const col = kit.db.collection(users);
        await col.set(
          "d",
          sampleUser({
            name: "D",
            tags: ["tag2"],
          }),
        );
        const docs = await col.where("tags", "array-contains", "tag2").get();
        expect(docs.map((u) => u.name)).toEqual(["D"]);
      });

      it("counts, sums, and averages, whole collection and filtered", async () => {
        const col = kit.db.collection(users);
        expect(await col.count()).toBe(3);
        expect(await col.where("age", ">=", 30).count()).toBe(2);
        expect(await col.sum("age")).toBe(90);
        expect(await col.average("age")).toBe(30);
        const adults = col.where("age", ">=", 30);
        expect(await adults.sum("age")).toBe(70);
        expect(await adults.average("age")).toBe(35);
      });

      it("aggregates an empty match to a 0 sum and null average", async () => {
        const none = kit.db.collection(users).where("age", ">", 100);
        expect(await none.sum("age")).toBe(0);
        expect(await none.average("age")).toBeNull();
      });

      it("filters and orders by document id", async () => {
        const col = kit.db.collection(users);
        const within = await col.where(documentId(), "in", ["a", "c"]).get();
        expect(within.map((u) => u.id).sort()).toEqual(["a", "c"]);
        const equal = await col.where(documentId(), "==", "b").get();
        expect(equal.map((u) => u.id)).toEqual(["b"]);
        const from = await col.where(documentId(), ">=", "b").get();
        expect(from.map((u) => u.id)).toEqual(["b", "c"]);
        // Standalone descending key scans are unsupported by Firestore, so order ascending
        const first = await col.orderBy(documentId()).limit(2).get();
        expect(first.map((u) => u.id)).toEqual(["a", "b"]);
      });

      it("orders an unordered query by document id, not insertion order", async () => {
        const col = kit.db.collection(users);
        await col.set("z", sampleUser({ name: "Z" }));
        await col.set("m", sampleUser({ name: "M" }));
        // a, b, c are seeded, then z, m, so insertion order is a b c z m
        const docs = await col.query().get();
        expect(docs.map((u) => u.id)).toEqual(["a", "b", "c", "m", "z"]);
      });

      it("breaks orderBy ties by document id in the sort direction", async () => {
        const col = kit.db.collection(users);
        // c and d both have age 40, so the id tiebreak decides their relative order
        await col.set(
          "d",
          sampleUser({
            name: "D",
            age: 40,
          }),
        );
        const asc = await col.orderBy("age").get();
        expect(asc.map((u) => u.id)).toEqual(["a", "b", "c", "d"]);
        const desc = await col.orderBy("age", "desc").get();
        expect(desc.map((u) => u.id)).toEqual(["d", "c", "b", "a"]);
      });

      it("excludes documents missing the field from a != query", async () => {
        const items = collection(
          "items",
          z.object({
            label: z.string(),
            score: z.number().optional(),
          }),
        );
        const col = kit.db.collection(items);
        await col.set("withScore", {
          label: "x",
          score: 5,
        });
        await col.set("noScore", { label: "y" });
        await col.set("other", {
          label: "z",
          score: 9,
        });
        // withScore is equal, noScore is missing the field, so only other remains
        const docs = await col.where("score", "!=", 5).get();
        expect(docs.map((i) => i.id)).toEqual(["other"]);
      });
    });
  });
}
