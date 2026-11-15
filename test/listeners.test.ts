import { beforeEach, describe, expect, it } from "bun:test";

import { documentId, serverTimestamp } from "@/index";
import { allKits } from "./emulator";
import { sampleUser, settle, users, waitUntil } from "./support";

for (const kit of allKits) {
  describe(kit.name, () => {
    describe("listeners", () => {
      beforeEach(() => kit.clear());

      it("emits the current document and subsequent changes", async () => {
        const seen: Array<{ name: string; path: string } | null> = [];
        const unsub = kit.db
          .collection(users)
          .doc("john")
          .onSnapshot((doc) =>
            seen.push(
              doc
                ? {
                    name: doc.name,
                    path: doc.meta.path,
                  }
                : null,
            ),
          );
        await waitUntil(() => seen.length >= 1);
        await kit.db.collection(users).set("john", sampleUser());
        await waitUntil(() => seen.at(-1)?.name === "John Doe");
        unsub();
        expect(seen[0]).toBeNull();
        expect(seen.at(-1)).toEqual({
          name: "John Doe",
          path: "users/john",
        });
      });

      it("emits live collection results", async () => {
        const pages: Array<Array<{ name: string; path: string }>> = [];
        const unsub = kit.db.collection(users).onSnapshot((docs) =>
          pages.push(
            docs.map((u) => ({
              name: u.name,
              path: u.meta.path,
            })),
          ),
        );
        await waitUntil(() => pages.length >= 1);
        await kit.db.collection(users).set("john", sampleUser());
        await waitUntil(() => pages.at(-1)?.[0]?.name === "John Doe");
        unsub();
        expect(pages[0]).toEqual([]);
        expect(pages.at(-1)).toEqual([
          {
            name: "John Doe",
            path: "users/john",
          },
        ]);
      });

      it("does not re-deliver a document when an unrelated document changes", async () => {
        await kit.db.collection(users).set("john", sampleUser());
        const seen: (string | null)[] = [];
        const unsub = kit.db
          .collection(users)
          .doc("john")
          .onSnapshot((doc) => seen.push(doc ? doc.name : null));
        await waitUntil(() => seen.length >= 1);
        await kit.db
          .collection(users)
          .set("other", sampleUser({ name: "Other" }));
        await settle();
        unsub();
        // The unrelated write must not re-fire john's listener, so only the initial delivery shows
        expect(seen).toEqual(["John Doe"]);
      });

      it("does not re-deliver a query when its result is unchanged", async () => {
        await kit.db.collection(users).set("a", sampleUser({ name: "A" }));
        const pages: string[][] = [];
        const unsub = kit.db
          .collection(users)
          .where("name", "==", "A")
          .onSnapshot((docs) => pages.push(docs.map((u) => u.name)));
        await waitUntil(() => pages.length >= 1);
        await kit.db.collection(users).set("b", sampleUser({ name: "B" }));
        await settle();
        unsub();
        // The non-matching write leaves the result set unchanged, so no second delivery
        expect(pages).toEqual([["A"]]);
      });

      it("accepts an observer object on a document listener", async () => {
        await kit.db.collection(users).set("john", sampleUser());
        const seen: (string | null)[] = [];
        const unsub = kit.db
          .collection(users)
          .doc("john")
          .onSnapshot({ next: (doc) => seen.push(doc ? doc.name : null) });
        await waitUntil(() => seen.length >= 1);
        unsub();
        expect(seen[0]).toBe("John Doe");
      });

      it("passes a listener error to the observer's error handler", async () => {
        const col = kit.db.collection(users);
        const errors: string[] = [];
        const observer = {
          next: () => {},
          error: (error: unknown) => errors.push(String(error)),
        };
        // Backend rejects reserved __*__ ids after the listen starts
        const unsubDoc = col.doc("__john__").onSnapshot(observer);
        const unsubQuery = col
          .where(documentId(), "==", "__john__")
          .onSnapshot(observer);
        await waitUntil(() => errors.length >= 2);
        unsubDoc();
        unsubQuery();
        const reserved =
          'Resource id "__john__" is invalid because it is reserved';
        expect(errors).toEqual([
          expect.stringContaining(reserved),
          expect.stringContaining(reserved),
        ]);
      });

      it("emits a pending serverTimestamp as a Date", async () => {
        const col = kit.db.collection(users);
        await col.set("john", sampleUser());
        const seen: Date[] = [];
        const unsubDoc = col
          .doc("john")
          .onSnapshot((doc) => seen.push(doc!.createdAt));
        const unsubQuery = col.onSnapshot((docs) =>
          seen.push(docs[0]!.createdAt),
        );
        await waitUntil(() => seen.length >= 2);
        await col.update("john", { createdAt: serverTimestamp() });
        await waitUntil(() => seen.length >= 4);
        unsubDoc();
        unsubQuery();
        for (const createdAt of seen) {
          expect(createdAt).toBeInstanceOf(Date);
        }
      });
    });
  });
}
