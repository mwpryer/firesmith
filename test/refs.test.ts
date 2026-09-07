import { beforeEach, describe, expect, it } from "bun:test";
import {
  doc as webDoc,
  getDoc as webGetDoc,
  getDocs,
  setDoc as webSetDoc,
  updateDoc,
} from "firebase/firestore";

import { docRef as adminDocRef, queryRef as adminQueryRef } from "@/admin";
import { documentId } from "@/index";
import { docRef as webDocRef, queryRef as webQueryRef } from "@/web";
import { adminKit, webKit } from "./emulator";
import { posts, sampleUser, users } from "./support";

// Escape hatches are per entrypoint, so each driver exercises its own SDK calls
describe("admin", () => {
  describe("refs", () => {
    beforeEach(() => adminKit.clear());

    it("coerces through the ref converter and never stores id or meta", async () => {
      const ref = adminDocRef(adminKit.db.collection(users).doc("john"));
      await ref.set({
        ...sampleUser(),
        id: "wrong",
        meta: { path: "wrong/path" },
      });
      const stored = (await adminKit.rawGet("users/john"))!;
      expect("id" in stored).toBe(false);
      expect("meta" in stored).toBe(false);
      expect(adminKit.isSdkTimestamp(stored.createdAt)).toBe(true);
      const doc = (await ref.get()).data()!;
      expect(doc.id).toBe("john");
      expect(doc.meta).toEqual({ path: "users/john" });
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.name).toBe("John Doe");
    });

    it("addresses one collection-group result through its converted path", async () => {
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
      const ref = adminQueryRef(query);
      const first = (await ref.get()).docs[0]!.data();

      await ref.firestore.doc(first.meta.path).update({ likes: 2 });

      expect((await query.get()).map((post) => post.likes)).toEqual([2, 1]);
    });
  });
});

describe("web", () => {
  describe("refs", () => {
    beforeEach(() => webKit.clear());

    it("coerces through the ref converter and never stores id or meta", async () => {
      const ref = webDocRef(webKit.db.collection(users).doc("john"));
      await webSetDoc(ref, {
        ...sampleUser(),
        id: "wrong",
        meta: { path: "wrong/path" },
      });
      const stored = (await webKit.rawGet("users/john"))!;
      expect("id" in stored).toBe(false);
      expect("meta" in stored).toBe(false);
      expect(webKit.isSdkTimestamp(stored.createdAt)).toBe(true);
      const doc = (await webGetDoc(ref)).data()!;
      expect(doc.id).toBe("john");
      expect(doc.meta).toEqual({ path: "users/john" });
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.name).toBe("John Doe");
    });

    it("addresses one collection-group result through its converted path", async () => {
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
      const ref = webQueryRef(query);
      const first = (await getDocs(ref)).docs[0]!.data();

      await updateDoc(webDoc(ref.firestore, first.meta.path), { likes: 2 });

      expect((await query.get()).map((post) => post.likes)).toEqual([2, 1]);
    });
  });
});
