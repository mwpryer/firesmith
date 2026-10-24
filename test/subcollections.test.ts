import { beforeEach, describe, expect, it } from "bun:test";

import { documentId } from "@/index";
import { allKits } from "./emulator";
import { posts, sampleUser, users } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("subcollections", () => {
      beforeEach(() => kit.clear());

      it("round-trips a nested collection at the composed path", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        const johnPosts = col.doc("john").collection(posts);
        await johnPosts.set("p1", { title: "A", likes: 1 });
        expect(await johnPosts.get("p1")).toEqual({
          id: "p1",
          meta: { path: "users/john/posts/p1" },
          title: "A",
          likes: 1,
        });
      });

      it("queries a collection group across every parent", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        await col.set("jane", sampleUser({ name: "Jane Doe" }));
        await col
          .doc("john")
          .collection(posts)
          .set("p1", { title: "A", likes: 1 });
        await col
          .doc("jane")
          .collection(posts)
          .set("p2", { title: "B", likes: 5 });

        const popular = await kit.db
          .collectionGroup(posts)
          .where("likes", ">=", 3)
          .get();
        expect(popular.map((p) => p.title)).toEqual(["B"]);
      });

      it("distinguishes identical collection-group documents by their paths", async () => {
        const col = kit.db.collection(users);
        await col.doc("jane").collection(posts).set("same", {
          title: "Same",
          likes: 1,
        });
        await col.doc("john").collection(posts).set("same", {
          title: "Same",
          likes: 1,
        });

        const docs = await kit.db
          .collectionGroup(posts)
          .orderBy(documentId())
          .get();

        expect(docs).toEqual([
          {
            id: "same",
            meta: { path: "users/jane/posts/same" },
            title: "Same",
            likes: 1,
          },
          {
            id: "same",
            meta: { path: "users/john/posts/same" },
            title: "Same",
            likes: 1,
          },
        ]);
      });

      it("paginates past a collection-group document using its returned path", async () => {
        const col = kit.db.collection(users);
        await col.doc("jane").collection(posts).set("same", {
          title: "Same",
          likes: 1,
        });
        await col.doc("john").collection(posts).set("same", {
          title: "Same",
          likes: 1,
        });
        const query = kit.db.collectionGroup(posts).orderBy(documentId());
        const first = (await query.limit(1).get())[0]!;

        const next = await query.startAfter(first.meta.path).limit(1).get();

        expect(next).toEqual([
          {
            id: "same",
            meta: { path: "users/john/posts/same" },
            title: "Same",
            likes: 1,
          },
        ]);
      });

      it("paginates past a collection-group document passed as the cursor", async () => {
        const col = kit.db.collection(users);
        await col.doc("jane").collection(posts).set("same", {
          title: "Same",
          likes: 1,
        });
        await col.doc("john").collection(posts).set("same", {
          title: "Same",
          likes: 1,
        });
        const query = kit.db.collectionGroup(posts).orderBy(documentId());
        const first = (await query.limit(1).get())[0]!;

        const next = await query.startAfterDoc(first).get();

        expect(next.map((post) => post.meta.path)).toEqual([
          "users/john/posts/same",
        ]);
      });
    });
  });
}
