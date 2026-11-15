import { beforeEach, describe, expect, it } from "bun:test";
import {
  getDoc as webGetDoc,
  getDocs,
  onSnapshot,
  setDoc as webSetDoc,
  updateDoc,
} from "firebase/firestore";

import {
  collectionRef as adminCollectionRef,
  docRef as adminDocRef,
  queryRef as adminQueryRef,
  transactionRef as adminTransactionRef,
} from "@/admin";
import { documentId, serverTimestamp } from "@/index";
import {
  collectionRef as webCollectionRef,
  docRef as webDocRef,
  queryRef as webQueryRef,
  transactionRef as webTransactionRef,
} from "@/web";
import { adminKit, webKit } from "./emulator";
import { posts, sampleUser, users, waitUntil } from "./support";

// Escape hatches are per entrypoint, so each driver exercises its own SDK calls
describe("admin", () => {
  describe("refs", () => {
    beforeEach(() => adminKit.clear());

    it("coerces through the ref converter and never stores id or meta", async () => {
      const col = adminKit.db.collection(users);
      const ref = adminDocRef(col.doc("john"));
      // Spread of a read document, the only way id and meta reach a write
      const copy = {
        ...sampleUser(),
        id: "wrong",
        meta: { path: "wrong/path" },
      };
      await ref.set(copy);
      const stored = (await adminKit.rawGet("users/john"))!;
      expect("id" in stored).toBe(false);
      expect("meta" in stored).toBe(false);
      expect(adminKit.isSdkTimestamp(stored.createdAt)).toBe(true);
      const doc = (await ref.get()).data()!;
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.name).toBe("John Doe");
      const listed = (await adminCollectionRef(col).get()).docs[0]!.data();
      expect(listed.createdAt).toBeInstanceOf(Date);
      const queried = (await adminQueryRef(col.query()).get()).docs[0]!.data();
      expect(queried.createdAt).toBeInstanceOf(Date);
    });

    it("runs a collection-group query through the converted ref", async () => {
      const col = adminKit.db.collection(users);
      await col.doc("jane").collection(posts).set("same", {
        title: "Same",
        likes: 1,
      });
      await col.doc("john").collection(posts).set("same", {
        title: "Same",
        likes: 1,
      });
      const query = adminKit.db.collectionGroup(posts).orderBy(documentId());
      const first = (await adminQueryRef(query).get()).docs[0]!;

      await first.ref.update({ likes: 2 });

      expect((await query.get()).map((post) => post.likes)).toEqual([2, 1]);
    });

    it("reads a query inside a transaction through the raw transaction", async () => {
      const col = adminKit.db.collection(posts);
      await col.set("p1", {
        title: "One",
        likes: 1,
      });

      await adminKit.db.runTransaction(async (tx) => {
        const snapshot = await adminTransactionRef(tx).get(
          adminQueryRef(col.query()),
        );
        const post = snapshot.docs[0]!;
        tx.collection(posts).update(post.id, { likes: post.data().likes + 1 });
      });

      expect((await col.get("p1"))!.likes).toBe(2);
    });
  });
});

describe("web", () => {
  describe("refs", () => {
    beforeEach(() => webKit.clear());

    it("coerces through the ref converter and never stores id or meta", async () => {
      const col = webKit.db.collection(users);
      const ref = webDocRef(col.doc("john"));
      // Spread of a read document, the only way id and meta reach a write
      const copy = {
        ...sampleUser(),
        id: "wrong",
        meta: { path: "wrong/path" },
      };
      await webSetDoc(ref, copy);
      const stored = (await webKit.rawGet("users/john"))!;
      expect("id" in stored).toBe(false);
      expect("meta" in stored).toBe(false);
      expect(webKit.isSdkTimestamp(stored.createdAt)).toBe(true);
      const doc = (await webGetDoc(ref)).data()!;
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.name).toBe("John Doe");
      const listed = (await getDocs(webCollectionRef(col))).docs[0]!.data();
      expect(listed.createdAt).toBeInstanceOf(Date);
      const queried = (await getDocs(webQueryRef(col.query()))).docs[0]!.data();
      expect(queried.createdAt).toBeInstanceOf(Date);
    });

    it("runs a collection-group query through the converted ref", async () => {
      const col = webKit.db.collection(users);
      await col.doc("jane").collection(posts).set("same", {
        title: "Same",
        likes: 1,
      });
      await col.doc("john").collection(posts).set("same", {
        title: "Same",
        likes: 1,
      });
      const query = webKit.db.collectionGroup(posts).orderBy(documentId());
      const first = (await getDocs(webQueryRef(query))).docs[0]!;

      await updateDoc(first.ref, { likes: 2 });

      expect((await query.get()).map((post) => post.likes)).toEqual([2, 1]);
    });

    it("reads a document inside a transaction through the raw transaction", async () => {
      const col = webKit.db.collection(users);
      await col.set("john", sampleUser({ age: 36 }));

      await webKit.db.runTransaction(async (tx) => {
        const john = await webTransactionRef(tx).get(
          webDocRef(col.doc("john")),
        );
        tx.collection(users).update("john", { age: john.data()!.age + 1 });
      });

      expect((await col.get("john"))!.age).toBe(37);
    });

    it("estimates a pending serverTimestamp through the ref converter", async () => {
      const col = webKit.db.collection(users);
      await col.set("john", sampleUser());
      const seen: Date[] = [];
      const unsub = onSnapshot(webDocRef(col.doc("john")), (snapshot) =>
        seen.push(snapshot.data()!.createdAt),
      );
      await waitUntil(() => seen.length >= 1);
      await col.update("john", { createdAt: serverTimestamp() });
      await waitUntil(() => seen.length >= 2);
      unsub();
      for (const createdAt of seen) {
        expect(createdAt).toBeInstanceOf(Date);
      }
    });
  });
});
