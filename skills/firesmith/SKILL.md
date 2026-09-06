---
name: firesmith
description: Read and write Firestore through firesmith, a schema-first typed wrapper over both Firestore SDKs (firebase-admin and firebase web) from one Standard Schema definition. Use when a project imports "firesmith", when writing Firestore data-access code in such a project, or when the user mentions firesmith, typed Firestore collections, or schema-typed Firestore queries.
---

# firesmith

Thin typed wrapper over Firestore. It **types and coerces, it does not validate**: the schema is used for type inference only and is never executed, so there is no runtime validation. Underneath it is plain Firestore; every handle exposes `.ref` to drop to the raw SDK.

## Setup

```sh
# server
npm install firesmith firebase-admin
# web
npm install firesmith firebase
```

Three entrypoints:

- `firesmith`: neutral. Schema definition, sentinels, types, `FiresmithError`. Imports no Firebase, safe in shared modules and frontend bundles.
- `firesmith/admin`: `createDatabase(getFirestore())` over `firebase-admin`, plus typed ref helpers. Re-exports the whole neutral core.
- `firesmith/web`: the same over the modular `firebase` SDK.

## Quick start

```ts
import { collection, increment } from "firesmith";
// or "firesmith/web"
import { createDatabase } from "firesmith/admin";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

// Plain, unbound definition, define once in a shared module importing only "firesmith"
const posts = collection(
  "posts",
  z.object({ title: z.string(), likes: z.number(), createdAt: z.date() }),
);

const db = createDatabase(getFirestore());

await db
  .collection(posts)
  .set("hello", { title: "Hello", likes: 0, createdAt: new Date() });
// Doc | null, Doc = T & { id }
const post = await db.collection(posts).get("hello");
await db.collection(posts).update("hello", { likes: increment(1) });
const popular = await db
  .collection(posts)
  .where("likes", ">=", 10)
  .orderBy("likes", "desc")
  .limit(10)
  .get();
```

The schema is any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType). It describes one document's fields, excluding the id.

## Core rules

1. **Ids are path-only.** Never declare an `id` field in a schema (compile error). Reads merge `id` in flat; writes exclude it. `add(data)` returns the generated id.
2. **Missing reads are `null`.** `get()` returns `Doc<S> | null`; there is no `.exists` snapshot to check (use `.doc(id).exists()` for a boolean).
3. **Values coerce at the boundary.** Write a `Date`, read a `Date` (stored as `Timestamp`); write a `Uint8Array`, read a `Uint8Array` (stored as SDK bytes). Deep through maps and arrays.
4. **Sentinels are `firesmith`'s own.** Import `serverTimestamp`, `increment`, `arrayUnion`, `arrayRemove`, `deleteField` from `firesmith`, never `FieldValue` from an SDK. Each is type-constrained to the fields it fits (`increment` on numbers, `deleteField` on optional fields only).
5. **Queries are typed to the schema.** `where` / `orderBy` take typed dotted paths into nested maps (`"customer.address.city"`); a misspelt field or wrong value type is a compile error. Target the id with `documentId()` from `firesmith`.
6. **Dotted-path keys work in `update` only.** `update("o1", { "totals.items": increment(1) })` touches one nested field. Merge `set` accepts recursively partial nested objects with `merge: true` or `mergeFields`, including nested optional-field deletions. Whole-map `update` values must be complete replacements.
7. **Transaction and batch writes take no `await`.** Reads in a transaction are async; writes return `void` and buffer until commit. Batches are write-only (no `get`, no `add`) and apply atomically on `.commit()`.
8. **No runtime validation.** A document drifted from its schema comes back typed as valid. Where drift matters, run the schema on the result yourself.
9. **SDK semantics win.** `firesmith` never wraps Firestore, network, or permission errors; `FiresmithError` covers only `firesmith`'s own failures. Anything `firesmith` does not wrap is reachable via `.ref`.

## Common operations

```ts
const col = db.collection(posts);

// Reads
// Doc | null
await col.get("hello");
// boolean
await col.doc("hello").exists();

// Writes, also on col.doc("hello")
await col.set("hello", { title: "Hi", likes: 0, createdAt: new Date() });
await col.set("hello", { likes: 1 }, { merge: true });
await col.update("hello", { likes: increment(1) });
// returns the new id
const id = await col.add({ title: "New", likes: 0, createdAt: new Date() });
await col.delete(id);

// Queries, immutable builder, .get() alias .list()
await col.where("likes", ">=", 10).orderBy("likes", "desc").limit(5).get();
await col.count();
// 0 over empty match
await col.sum("likes");
// null over empty match
await col.average("likes");
// returns unsubscribe fn
const unsub = col.onSnapshot((docs) => {});

// Subcollection, same def reusable at any depth
db.collection(posts).doc("hello").collection(comments);

// Collection group, every collection with that name
await db.collectionGroup(comments).orderBy("createdAt").get();

// Transaction, reads async, writes sync
await db.runTransaction(async (tx) => {
  const post = await tx.collection(posts).get("hello");
  if (post) tx.collection(posts).update("hello", { likes: post.likes + 1 });
});

// Batch, write-only, atomic on commit
const batch = db.batch();
batch.collection(posts).update("hello", { likes: increment(1) });
await batch.commit();
```

## Full reference

See [REFERENCE.md](REFERENCE.md) for queries and cursors, sentinels and nested updates, live updates, transactions and batches in detail, raw fields and full-precision timestamps, bytes, neutral value types, the `.ref` escape hatch, and gotchas.
