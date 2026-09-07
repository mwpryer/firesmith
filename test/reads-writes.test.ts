import { beforeEach, describe, expect, it } from "bun:test";
import { getDocs, query, where } from "firebase/firestore";
import { z } from "zod";

import { collectionRef as adminCollectionRef } from "@/admin";
import { collection, isTimestampLike } from "@/index";
import { collectionRef as webCollectionRef } from "@/web";
import { allKits } from "./emulator";
import { sampleUser, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("reads and writes", () => {
      beforeEach(() => kit.clear());

      it("round-trips a document with its id and meta merged in", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        const john = await col.get("john");
        expect(john!.id).toBe("john");
        expect(john!.meta).toEqual({ path: "users/john" });
        expect(john!.name).toBe("John Doe");
      });

      it("strips id and meta from writes but stores a path data field", async () => {
        const records = collection(
          "records",
          z.object({
            name: z.string(),
            path: z.string(),
          }),
        );
        const col = kit.db.collection(records);
        const fields = {
          name: "Original",
          path: "data/path",
        };
        await col.set("one", fields);
        await col.set("tx-update", fields);
        await col.set("batch-update", fields);
        const source = (await col.get("one"))!;

        await col.set("copy", source);
        await col.set("merge", source, { merge: true });
        await col.update("one", source);
        await col.add(source);

        await kit.db.runTransaction(async (tx) => {
          const txCol = tx.collection(records);
          const doc = (await txCol.get("one"))!;
          txCol.set("tx-copy", doc);
          txCol.set("tx-merge", doc, { merge: true });
          txCol.update("tx-update", doc);
        });

        const batch = kit.db.batch();
        const batchCol = batch.collection(records);
        batchCol.set("batch-copy", source);
        batchCol.set("batch-merge", source, { merge: true });
        batchCol.update("batch-update", source);
        await batch.commit();

        const matches =
          kit.name === "admin"
            ? await adminCollectionRef(col).where("id", "==", "one").get()
            : await getDocs(
                query(webCollectionRef(col), where("id", "==", "one")),
              );
        expect(matches.docs.map((doc) => doc.id)).toEqual([]);

        const metaMatches =
          kit.name === "admin"
            ? await adminCollectionRef(col)
                .where("meta.path", "==", "records/one")
                .get()
            : await getDocs(
                query(
                  webCollectionRef(col),
                  where("meta.path", "==", "records/one"),
                ),
              );
        expect(metaMatches.docs.map((doc) => doc.id)).toEqual([]);

        const copies = await col.query().get();
        expect(copies).toHaveLength(10);
        for (const copy of copies) {
          expect(copy).toMatchObject({
            name: "Original",
            path: "data/path",
          });
        }
        expect(source).toEqual({
          id: "one",
          meta: { path: "records/one" },
          name: "Original",
          path: "data/path",
        });
      });

      it("coerces dates at any depth, Date on read, timestamp in storage", async () => {
        const events = collection(
          "events",
          z.object({ at: z.date(), stats: z.object({ start: z.date() }) }),
        );
        const col = kit.db.collection(events);
        const date = new Date("2020-01-01T00:00:00.000Z");
        await col.set("e1", { at: date, stats: { start: date } });

        const e = await col.get("e1");
        expect(e!.at).toBeInstanceOf(Date);
        expect(e!.at.getTime()).toBe(date.getTime());
        expect(e!.stats.start).toBeInstanceOf(Date);

        const stored = (await kit.rawGet("events/e1"))! as {
          at: unknown;
          stats: { start: unknown };
        };
        expect(isTimestampLike(stored.at)).toBe(true);
        expect(isTimestampLike(stored.stats.start)).toBe(true);
      });

      it("reports existence and returns null for a missing document", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        expect(await col.doc("john").exists()).toBe(true);
        expect(await col.doc("nope").exists()).toBe(false);
        expect(await col.get("nope")).toBeNull();
      });

      it("add generates an id", async () => {
        const col = kit.db.collection(users);
        const id = await col.add(sampleUser());
        expect(typeof id).toBe("string");
        expect((await col.get(id))!.name).toBe("John Doe");
      });

      it("delete removes the document", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        await col.delete("john");
        expect(await col.get("john")).toBeNull();
      });
    });
  });
}
