import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";

import { collection, deleteField, serverTimestamp } from "@/index";
import { allKits } from "./emulator";
import { sampleUser, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    beforeEach(() => kit.clear());

    describe("invalid sentinel placement", () => {
      it("rejects deleteField in a non-merge set", async () => {
        await expect(
          kit.db
            .collection(users)
            // @ts-expect-error deleteField is not valid in a non-merge set
            .set("john", { ...sampleUser(), name: deleteField() }),
        ).rejects.toThrow();
      });

      it("rejects a sentinel inside an array element", async () => {
        const events = collection(
          "events",
          z.object({ items: z.array(z.object({ at: z.date() })) }),
        );
        await expect(
          kit.db
            .collection(events)
            // @ts-expect-error sentinels are not valid inside array elements
            .set("e1", { items: [{ at: serverTimestamp() }] }),
        ).rejects.toThrow();
      });
    });

    describe("undefined values", () => {
      it("rejects undefined in a set, an update, and a where value", async () => {
        const col = kit.db.collection(users);
        await expect(
          col.set("john", { ...sampleUser(), profile: undefined }),
        ).rejects.toThrow();

        await col.set("john", sampleUser());
        await expect(
          // @ts-expect-error a field is cleared with deleteField, not by writing undefined
          col.update("john", { profile: undefined }),
        ).rejects.toThrow();

        const items = collection(
          "items",
          z.object({ label: z.string(), score: z.number().optional() }),
        );
        await expect(
          kit.db
            .collection(items)
            // @ts-expect-error undefined is not a queryable value
            .where("score", "==", undefined)
            .get(),
        ).rejects.toThrow();
      });
    });

    describe("query validation", () => {
      // Empty and oversized in filters are left to the backend, admin and web SDKs disagree on surfacing
      it("rejects more cursor values than orderBy clauses", async () => {
        await expect(
          // @ts-expect-error one orderBy takes one cursor value
          kit.db.collection(users).orderBy("age").startAt(20, 30).get(),
        ).rejects.toThrow();
      });
    });
  });
}
