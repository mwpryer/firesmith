import { beforeEach, describe, expect, it } from "bun:test";
import {
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
  });
});

describe("web", () => {
  describe("refs", () => {
    beforeEach(() => webKit.clear());

    it("coerces through the ref converter and never stores id or meta", async () => {
      const ref = webDocRef(webKit.db.collection(users).doc("john"));
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
  });
});
