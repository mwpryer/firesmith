import { beforeEach, describe, expect, it } from "bun:test";

import { allKits } from "./emulator";
import { posts, sampleUser, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("transactions", () => {
      beforeEach(() => kit.clear());

      it("commits reads and writes across a document and a subcollection", async () => {
        const col = kit.db.collection(users);
        const johnPosts = col.doc("john").collection(posts);
        await col.set("john", sampleUser({ age: 36 }));
        await johnPosts.set("p1", { title: "Draft", likes: 0 });

        // All reads precede all writes
        const paths = await kit.db.runTransaction(async (tx) => {
          const john = await tx.collection(users).get("john");
          const post = await tx
            .collection(users)
            .doc("john")
            .collection(posts)
            .get("p1");
          await tx
            .collection(users)
            .set("john", { ...john!, age: john!.age + 1 });
          await tx
            .collection(users)
            .doc("john")
            .collection(posts)
            .doc("p1")
            .set({ ...post!, likes: post!.likes + 1 });

          return [john!.meta.path, post!.meta.path];
        });

        expect(paths).toEqual(["users/john", "users/john/posts/p1"]);
        expect((await col.get("john"))!.age).toBe(37);
        expect((await johnPosts.get("p1"))!.likes).toBe(1);
      });

      it("accepts a merge set and an explicit maxAttempts", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser({ age: 36 }));
        await kit.db.runTransaction(
          async (tx) => {
            const john = await tx.collection(users).get("john");
            await tx
              .collection(users)
              .set("john", { age: john!.age + 1 }, { merge: true });
          },
          { maxAttempts: 1 },
        );
        const john = await col.get("john");
        expect(john!.age).toBe(37);
        expect(john!.name).toBe("John Doe");
      });

      it("rejects a read issued after a write", async () => {
        await kit.db.collection(users).set("john", sampleUser());
        await expect(
          kit.db.runTransaction(async (tx) => {
            tx.collection(users).set("john", sampleUser({ age: 99 }));
            await tx.collection(users).get("john");
          }),
        ).rejects.toThrow();
      });
    });
  });
}
