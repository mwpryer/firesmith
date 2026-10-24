import type { Firestore as AdminFirestore } from "firebase-admin/firestore";
import { setDoc } from "firebase/firestore";
import { z } from "zod";

import { docRef as adminDocRef, queryRef as adminQueryRef } from "@/admin";
import type { Database } from "@/core/database";
import {
  arrayUnion,
  collection,
  deleteField,
  documentId,
  increment,
  serverTimestamp,
} from "@/index";
import type {
  Doc,
  DocumentReference,
  GeoPoint,
  MergeOptions,
  VectorValue,
} from "@/index";
import { docRef as webDocRef } from "@/web";
import { places, posts, samplePlace, sampleUser, users } from "./support";

// Compile-time only, never executed, typecheck enforces every ts-expect-error

// Drivers share one Database type, a single surface covers admin and web
declare const db: Database;

function queryTypes(): void {
  const h = db.collection(users);
  // Valid field paths, values, and operators type-check
  void h.where("age", ">=", 18);
  void h.where("age", "in", [20, 40]);
  void h.where("tags", "array-contains", "tag1");
  void h.where("profile.bio", "==", "hi");
  void h.orderBy("createdAt", "desc");
  void h.orderBy("age");
  // @ts-expect-error unknown field is not a valid path
  void h.where("nope", "==", 1);
  // @ts-expect-error value type must match the field (age is a number)
  void h.where("age", "==", "old");
  // @ts-expect-error in takes an array of the field type
  void h.where("age", "in", 30);
  // @ts-expect-error array-contains element must match the array element type
  void h.where("tags", "array-contains", 1);
  // @ts-expect-error path stops at a primitive, cannot reach into it
  void h.where("name.length", "==", 1);
  // @ts-expect-error orderBy unknown field is not a valid path
  void h.orderBy("nope");
  // Document id queries are typed to id strings
  void h.where(documentId(), "in", ["a", "b"]);
  void h.where(documentId(), "==", "a");
  void h.orderBy(documentId());
  // @ts-expect-error document id value is a string, not a number
  void h.where(documentId(), "==", 1);
  // @ts-expect-error in takes an array of id strings
  void h.where(documentId(), "in", "a");
  // Aggregations are constrained to numeric field paths
  void h.sum("age");
  void h.average("age");
  // @ts-expect-error sum requires a numeric field, not a string
  void h.sum("name");
  // @ts-expect-error average requires a numeric field, not a date
  void h.average("createdAt");
  // @ts-expect-error unknown field is not a valid path
  void h.sum("nope");
  // @ts-expect-error undefined is not a queryable value
  void h.where("profile", "==", undefined);
}

function updateTypes(): void {
  const u = db.collection(users);
  // Sentinels are constrained to compatible fields
  // @ts-expect-error increment is not valid on a string field
  void u.update("john", { name: increment(1) });
  // @ts-expect-error serverTimestamp is not valid on a number field
  void u.update("john", { age: serverTimestamp() });
  // @ts-expect-error arrayUnion element type must match (number vs string)
  void u.update("john", { tags: arrayUnion(123) });
  // @ts-expect-error deleteField is not valid on a required field
  void u.update("john", { name: deleteField() });
  void u.update("john", {
    name: "John Doe",
    age: increment(1),
    tags: arrayUnion("tag2"),
    createdAt: serverTimestamp(),
  });
  // Dotted-path update keys are typed
  const p = db.collection(places);
  void p.update("p1", { "address.city": "London" });
  void p.update("p1", { "address.geo.lat": increment(1) });
  void p.update("p1", { "stats.lastVisit": serverTimestamp() });
  void p.update("p1", { "address.geo": { lat: 1, lng: 2 } });
  void p.update("p1", { "address.note": deleteField() });
  // @ts-expect-error whole-map updates require every required child
  void p.update("p1", { address: { city: "Leeds" } });
  // @ts-expect-error dotted whole-map updates also replace their children
  void p.update("p1", { "address.geo": { lat: 1 } });
  // A whole-map value carries nested sentinels, transforms reach inside maps
  void p.update("p1", {
    stats: { visits: increment(1), lastVisit: serverTimestamp() },
  });
  // @ts-expect-error unknown dotted path
  void p.update("p1", { "address.country": "UK" });
  // @ts-expect-error value type must match the path (lat is a number)
  void p.update("p1", { "address.geo.lat": "no" });
  // @ts-expect-error increment is not valid on a string path
  void p.update("p1", { "address.city": increment(1) });
  // @ts-expect-error path stops at a primitive, cannot reach into it
  void p.update("p1", { "name.first": "X" });
  // @ts-expect-error deleteField is not valid on a required path
  void p.update("p1", { "address.city": deleteField() });
}

function writeTypes(): void {
  const u = db.collection(users);
  // A full set takes value sentinels constrained to each field, deleteField excluded
  // @ts-expect-error increment is not valid on a string field
  void u.set("john", { ...sampleUser(), name: increment(1) });
  // @ts-expect-error serverTimestamp is not valid on a number field
  void u.set("john", { ...sampleUser(), age: serverTimestamp() });
  // @ts-expect-error deleteField cannot appear in a non-merge set
  void u.set("john", { ...sampleUser(), name: deleteField() });
  void u.set("john", { ...sampleUser(), createdAt: serverTimestamp() });
  // Sentinels never reach inside arrays, Firestore rejects them there
  const logs = collection(
    "logs",
    z.object({ entries: z.array(z.object({ at: z.date() })) }),
  );
  void db
    .collection(logs)
    // @ts-expect-error sentinels are not valid inside array elements
    .set("l1", { entries: [{ at: serverTimestamp() }] });
  const p = db.collection(places);
  void p.set("p1", { address: { city: "Leeds" } }, { merge: true });
  void p.set(
    "p1",
    { address: { geo: { lat: increment(1) } } },
    { merge: true },
  );
  void p.set("p1", { address: { note: deleteField() } }, { merge: true });
  const patch = {
    address: {
      city: "Leeds",
      note: deleteField(),
    },
  };
  const fields = {
    mergeFields: ["address.city", "address.note"],
  } satisfies MergeOptions<z.output<typeof places.schema>>;
  void p.set("p1", patch, fields);
  void p.doc("p1").set(patch, { merge: true });
  void p.doc("p1").set(patch, fields);
  const batch = db.batch().collection(places);
  batch.set("p1", patch, { merge: true });
  batch.set("p1", patch, fields);
  batch.doc("p1").set(patch, { merge: true });
  batch.doc("p1").set(patch, fields);
  void db.runTransaction(async (tx) => {
    const col = tx.collection(places);
    col.set("p1", patch, { merge: true });
    col.set("p1", patch, fields);
    col.doc("p1").set(patch, { merge: true });
    col.doc("p1").set(patch, fields);
  });
  // @ts-expect-error full writes still require complete nested maps
  void p.set("p1", { ...samplePlace(), address: { city: "Leeds" } });
  // @ts-expect-error merge writes cannot delete required nested fields
  void p.set("p1", { address: { city: deleteField() } }, { merge: true });
  // @ts-expect-error nested values must match their field type
  void p.set("p1", { address: { city: 1 } }, { merge: true });
  // @ts-expect-error nested sentinels must match their field type
  void p.set("p1", { address: { city: increment(1) } }, { merge: true });
  // @ts-expect-error optional nested fields exclude explicit undefined
  void p.set("p1", { address: { note: undefined } }, { merge: true });
  // @ts-expect-error array elements remain complete in merge writes
  void db.collection(logs).set("l1", { entries: [{}] }, { merge: true });
  void db
    .collection(logs)
    // @ts-expect-error merge writes cannot put sentinels inside array elements
    .set("l1", { entries: [{ at: serverTimestamp() }] }, { merge: true });
  // @ts-expect-error dates remain atomic in merge writes
  void p.set("p1", { stats: { lastVisit: {} } }, { merge: true });
  // @ts-expect-error dotted keys are not part of the merge set surface
  void p.set("p1", { "address.city": "London" }, { merge: true });
  // A merge set whole-map value carries nested sentinels
  void p.set(
    "p1",
    { stats: { visits: increment(1), lastVisit: serverTimestamp() } },
    { merge: true },
  );
  // mergeFields names known field paths only
  // @ts-expect-error nope is not a field path on this schema
  void p.set("p1", { name: "x" }, { mergeFields: ["nope"] });
  // Batch handles expose write but never read, and have no add
  const b = db.batch().collection(users);
  void b.set("a", sampleUser());
  void b.update("a", { age: increment(1) });
  void b.delete("a");
  // @ts-expect-error batch handles cannot read
  void b.get("a");
  // @ts-expect-error batch has no add, nothing returns an id pre-commit
  void b.add(sampleUser());
  // @ts-expect-error id comes from the path, not a schema field
  void collection("bad", z.object({ id: z.string() }));
  // @ts-expect-error meta is document metadata, not a schema field
  void collection("bad", z.object({ meta: z.object({ path: z.string() }) }));
  // @ts-expect-error optional meta still conflicts with document metadata
  void collection("bad", z.object({ meta: z.string().optional() }));
  const variants = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("plain"),
      name: z.string(),
    }),
    z.object({
      kind: z.literal("located"),
      meta: z.string(),
    }),
  ]);
  // @ts-expect-error meta is reserved even when only one union member declares it
  void collection("bad", variants);
  // path is an ordinary data field
  void collection("ok", z.object({ path: z.string() }));
  // @ts-expect-error id is excluded from writes
  void u.set("john", { ...sampleUser(), id: "john" });
  // @ts-expect-error meta is excluded from writes
  void u.set("john", { ...sampleUser(), meta: { path: "users/john" } });
  // @ts-expect-error meta is excluded from updates
  void u.update("john", { meta: { path: "users/jane" } });
}

function schemaTypes(): void {
  // Neutral value types are named in a schema without importing an SDK
  const assets = collection(
    "assets",
    z.object({
      location: z.custom<GeoPoint>(),
      owner: z.custom<DocumentReference>(),
      embedding: z.custom<VectorValue>(),
    }),
  );
  function readAsset(doc: Doc<typeof assets.schema>): void {
    const lat: number = doc.location.latitude;
    const id: string = doc.owner.id;
    const path: string = doc.meta.path;
    const vec: number[] = doc.embedding.toArray();
    void lat;
    void id;
    void path;
    void vec;
  }
  void readAsset;
  // Raw paths are checked against the schema, nested maps included
  void collection("events", z.object({ stats: z.object({ ts: z.date() }) }), {
    raw: ["stats.ts"],
  });
  // @ts-expect-error raw path must name a schema field
  void collection("events", z.object({ at: z.date() }), { raw: ["ta"] });
}

// Writes and array-valued query operators take any readonly array, including what a read produced
function readonlyArrayTypes(): void {
  const albums = collection(
    "albums",
    z.object({ tags: z.array(z.string()).readonly() }),
  );
  const a = db.collection(albums);
  function copy(doc: Doc<typeof albums.schema>): void {
    void a.set("copy", doc);
    void a.add(doc);
    void a.update("copy", { tags: doc.tags });
    void a.set("copy", { tags: doc.tags }, { merge: true });
    void a.set("copy", { tags: doc.tags }, { mergeFields: ["tags"] as const });
  }
  void copy;
  const ids = ["a", "b"] as const;
  void a.where("tags", "array-contains-any", ids);
  void a.where(documentId(), "in", ids);
  const ages = [20, 40] as const;
  const tags = ["tag1"] as const;
  const u = db.collection(users);
  void u.where("age", "in", ages);
  void u.where("age", "not-in", ages);
  void u.set("john", { ...sampleUser(), tags });
  // @ts-expect-error array-contains-any element type must match the array element type
  void a.where("tags", "array-contains-any", [1, 2] as const);
  // @ts-expect-error in takes an array of the field type
  void u.where("age", "in", ["old"] as const);
}

declare const user: Doc<typeof users.schema>;
declare const post: Doc<typeof posts.schema>;

function cursorTypes(): void {
  const byAge = db.collection(users).orderBy("age");
  const byAgeThenId = byAge.orderBy(documentId());
  // Values follow the orderBy chain, any non-empty prefix of it
  void byAge.startAfter(30);
  void byAgeThenId.startAfter(30, "john");
  void byAgeThenId.endBefore(30);
  void db.collection(users).orderBy("createdAt").startAt(new Date());
  void db.collectionGroup(users).orderBy(documentId()).startAt("users/john");
  // where() and limit() keep the chain
  void byAge.where("name", "==", "John").limit(1).startAfter(30);
  // @ts-expect-error value type must match the ordered field (age is a number)
  void byAge.startAfter("old");
  // @ts-expect-error a document is not a cursor value
  void byAgeThenId.startAfter(user);
  // Document cursors need documentId() in the chain
  void byAgeThenId.startAfterDoc(user);
  void byAgeThenId.endBeforeDoc(user);
  // @ts-expect-error without documentId() the position is not unique
  void byAge.startAfterDoc(user);
  // @ts-expect-error document must come from the same schema
  void byAgeThenId.startAfterDoc(post);
}

// Typed refs carry the write shape so SDK writes need no id or meta
declare const adminFirestore: AdminFirestore;

function refTypes(): void {
  const p = db.collection(posts);
  const adminRef = adminDocRef(p.doc("hello"));
  void adminRef.set({ title: "Hi", likes: 0 });
  void adminRef.create({ title: "Hi", likes: 0 });
  void adminFirestore.batch().set(adminRef, { title: "Hi", likes: 0 });
  // @ts-expect-error id is location metadata, never part of a write
  void adminRef.set({ title: "Hi", likes: 0, id: "hello" });
  void adminQueryRef(p.orderBy("likes").orderBy(documentId()));
  const webRef = webDocRef(p.doc("hello"));
  void setDoc(webRef, { title: "Hi", likes: 0 });
  // @ts-expect-error meta is location metadata, never part of a write
  void setDoc(webRef, { title: "Hi", likes: 0, meta: { path: "posts/hello" } });
}

void queryTypes;
void updateTypes;
void writeTypes;
void schemaTypes;
void readonlyArrayTypes;
void cursorTypes;
void refTypes;
