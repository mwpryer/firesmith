import { beforeEach, describe, expect, it } from "bun:test";

import { increment, isTimestampLike } from "@/index";
import { allKits } from "./emulator";
import { posts, sampleUser, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("batched writes", () => {
      beforeEach(() => kit.clear());

      it("buffers writes and commits them together", async () => {
        const col = kit.db.collection(users);
        await col.set(
          "jane",
          sampleUser({
            name: "Jane Doe",
            age: 36,
          }),
        );

        const batch = kit.db.batch();
        batch.collection(users).set("john", sampleUser());
        batch.collection(users).update("jane", { age: increment(4) });
        batch.collection(users).doc("john").collection(posts).set("p1", {
          title: "Notes",
          likes: 3,
        });
        // Buffered, nothing is applied before commit
        expect(await col.get("john")).toBeNull();

        await batch.commit();
        expect((await col.get("john"))!.name).toBe("John Doe");
        expect((await col.get("jane"))!.age).toBe(40);
        const post = await col.doc("john").collection(posts).get("p1");
        expect(post!.title).toBe("Notes");
        // Batch writes coerce like direct writes
        expect(
          isTimestampLike((await kit.rawGet("users/john"))!.createdAt),
        ).toBe(true);
      });

      it("merges and deletes in a batch", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        await col.set("jane", sampleUser({ name: "Jane Doe" }));

        const batch = kit.db.batch();
        batch.collection(users).set("john", { age: 37 }, { merge: true });
        batch.collection(users).delete("jane");
        await batch.commit();

        const john = await col.get("john");
        expect(john!.age).toBe(37);
        expect(john!.name).toBe("John Doe");
        expect(await col.get("jane")).toBeNull();
      });
    });
  });
}
