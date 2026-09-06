<p align="center">
  <img src="assets/firesmith.png" alt="firesmith" width="192">
</p>

<h1 align="center">firesmith</h1>

<p align="center">Both Firestore SDKs behind one thin, schema-typed TypeScript interface.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/firesmith"><img src="https://img.shields.io/npm/v/firesmith" alt="npm version"></a>
  <a href="skills/firesmith/SKILL.md"><img src="https://img.shields.io/badge/agent-ready-brightgreen" alt="agent-ready"></a>
  <a href="https://github.com/mwpryer/firesmith/stargazers"><img src="https://img.shields.io/github/stars/mwpryer/firesmith" alt="GitHub stars"></a>
</p>

`firesmith` is a thin wrapper over Firestore's SDKs, giving both one schema-typed interface: `firebase-admin` on the server and `firebase` on the web. Define a collection's schema once, in a validator you already use. Reads come back coerced and typed, and queries are typed to its fields. Underneath it's still plain Firestore, so you can reach for the SDK whenever you like.

- **Type-safe end to end.** Reads, writes, queries, listeners, transactions, batches and subcollections all take their types from your schema. Misspell a field or pass the wrong value type and it won't compile, rather than returning nothing at runtime.
- **Typed query builder.** `where` and `orderBy` are checked against the schema, with typed `count` / `sum` / `average` aggregations and nested dotted paths.
- **Constrained sentinels.** `increment`, `serverTimestamp`, `arrayUnion`, `arrayRemove` and `deleteField`, each limited to the field types it fits.
- **One schema, both SDKs.** One Firebase-free definition gives the same typed surface on `firebase-admin` (server) and `firebase` (web).
- **Coercion at the boundary.** A `Timestamp` reads back as a `Date`, `Bytes` as a `Uint8Array`, deep through maps and arrays, so you never hand-write a converter.
- **Still Firestore.** A thin wrapper, not an ORM; every handle exposes `.ref` to drop to the raw SDK.

## Why

In TypeScript you write your model as an interface, then keep the Firestore SDK in step with it by hand, and nothing checks that you have. A read returns `DocumentData`, so you cast it to your model and the compiler takes your word for it. `setDoc` accepts whatever shape you pass, so a wrong-typed field writes without complaint. Queries name fields as bare strings, so a misspelt one is not a compile error, it just quietly returns no documents. The value types don't line up either, the `Date` you wrote reads back as a `Timestamp`, so each model grows a converter of `.toDate()` calls. And on the server and in the browser you keep two copies of all of it, because the admin and web SDKs are different libraries with different types.

```ts
// raw SDK
const snap = await getDoc(doc(db, "posts", "hello-world"));
// DocumentData | undefined
const data = snap.data();
const post = data && {
  id: snap.id,
  // a cast, the compiler just trusts you
  title: data.title as string,
  likes: data.likes as number,
  // still a Timestamp, convert by hand
  createdAt: (data.createdAt as Timestamp).toDate(),
};
await setDoc(doc(db, "posts", "hello-world"), {
  title: "Hello world",
  // wrong type, stored anyway
  likes: "10",
});
// misspelt field, no error, just silently no results
const top = await getDocs(
  query(collection(db, "posts"), where("liks", ">=", 10)),
);

// firesmith
const post = await db.collection(posts).get("hello-world");
// { id: string; title: string; likes: number; createdAt: Date } | null

await db.collection(posts).set("hello-world", {
  title: "Hello world",
  likes: 10,
  // becomes a Timestamp on write
  createdAt: new Date(),
});
// @ts-expect-error likes is a number, caught before it reaches Firestore
await db.collection(posts).set("hello-world", { likes: "10" });

// @ts-expect-error "liks" is not a field, so it never runs an empty query
db.collection(posts).where("liks", ">=", 10);
```

`firesmith` moves all of this onto the collection definition, built from a schema you already have.

The schema is a [Standard Schema](https://standardschema.dev) validator, so Zod, Valibot, ArkType or any other compliant library supplies the types. `firesmith` depends only on the spec's type definitions and never runs your schema; there is no runtime validation unless you want some, and then you run the same schema yourself.

Timestamps round-trip. Write a `Date`, read a `Date`, however deeply it sits in maps and arrays. And one definition covers both SDKs: the same typed surface works with `firebase-admin` on the server and `firebase` on the web, so the model code you used to duplicate lives in one module, and that module imports no Firebase.

The whole surface is typed against the schema: reads and writes, the query builder and its aggregations, listeners, transactions, subcollections and collection-group queries. A misspelt field is a compile error rather than an empty result.

Underneath, it is still plain Firestore. `firesmith` is a thin wrapper, not an ORM, and every handle exposes `.ref`, so you can always drop to the raw SDK.

## Install

```sh
npm install firesmith

# server
npm install firebase-admin
# web
npm install firebase
```

## Agent skill

`firesmith` ships with an [agent skill](skills/firesmith/SKILL.md) that gives coding agents the small bit of context they need to use `firesmith` idiomatically, with a full API reference alongside.

```bash
npx skills add mwpryer/firesmith
```

## Quick start

Define a collection, connect a database, then read, write and query typed documents.

```ts
import { collection, increment } from "firesmith";
import { createDatabase } from "firesmith/admin";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

const posts = collection(
  "posts",
  z.object({
    title: z.string(),
    likes: z.number(),
    createdAt: z.date(),
  }),
);

const db = createDatabase(getFirestore());

await db.collection(posts).set("hello-world", {
  title: "Hello world",
  likes: 0,
  createdAt: new Date(),
});

// { id, title, likes, createdAt } | null, createdAt is a Date
const post = await db.collection(posts).get("hello-world");

// atomic field update via a neutral sentinel
await db.collection(posts).update("hello-world", { likes: increment(1) });

// typed query builder returning Doc[], fields checked against the schema
const popular = await db
  .collection(posts)
  .where("likes", ">=", 10)
  .orderBy("likes", "desc")
  .limit(10)
  .get();
```

## Define a schema

A collection definition is a plain value (`name` + `schema`) with no database binding, so it's reusable at any path, including subcollections. The schema module imports only `firesmith`, so Firebase never reaches a frontend bundle.

The schema should describe a document Firestore can store: an object of fields, with no directly nested arrays (an array of arrays). `firesmith` does not police this, so a non-storable shape surfaces as an SDK error at write time rather than a `firesmith` one.

```ts
import { collection } from "firesmith";
import { z } from "zod";

export const posts = collection(
  "posts",
  z.object({
    title: z.string(),
    likes: z.number(),
    // round-trips a Firestore Timestamp at the boundary
    createdAt: z.date(),
  }),
);
```

## Connect

Pass a Firestore instance to `createDatabase`. The server entrypoint uses `firebase-admin`.

```ts
// server.ts
import { createDatabase } from "firesmith/admin";
import { getFirestore } from "firebase-admin/firestore";

const db = createDatabase(getFirestore());
```

The web entrypoint is the same, but uses the modular `firebase` SDK.

```ts
import { createDatabase } from "firesmith/web";
import { getFirestore } from "firebase/firestore";

const db = createDatabase(getFirestore(app));
```

`db.collection(def)` returns a typed collection handle. `.doc(id)` narrows it to a single document.

## Read

```ts
// Doc | null, where Doc = T & { id }
const post = await db.collection(posts).get("hello-world");
// the same, from a document handle
const same = await db.collection(posts).doc("hello-world").get();
const there = await db.collection(posts).doc("hello-world").exists();
const total = await db.collection(posts).count();
```

## Write

```ts
// full write, coerced
await db.collection(posts).set("hello-world", {
  title: "Hello world",
  likes: 0,
  createdAt: new Date(),
});

// merge / partial update, coerced and typed
await db.collection(posts).set("hello-world", { likes: 10 }, { merge: true });
await db.collection(posts).update("hello-world", { likes: increment(1) });

// merge only the listed fields
await db
  .collection(posts)
  .set(
    "hello-world",
    { likes: 10, title: "ignored" },
    { mergeFields: ["likes"] },
  );

// auto-id insert returns the new id
const id = await db
  .collection(posts)
  .add({ title: "Second post", likes: 0, createdAt: new Date() });

// delete by id
await db.collection(posts).delete(id);
```

Every write also works on a document handle, like `db.collection(posts).doc("hello-world").set(...) / .update(...) / .delete()`.

`increment`, `serverTimestamp`, `arrayUnion`, `arrayRemove` and `deleteField` import from `firesmith`, see [Sentinels](#sentinels).

## Query

The builder is immutable and chainable. `.get()` (alias `.list()`) returns `Doc[]`.

```ts
import { documentId } from "firesmith";

const popular = await db
  .collection(posts)
  .where("likes", ">=", 10)
  .orderBy("likes")
  .limit(10)
  .get();

// cursors for pagination, startAt / startAfter / endAt / endBefore
const nextPage = await db
  .collection(posts)
  .orderBy("title")
  .orderBy(documentId())
  .startAfter(last.title, last.id)
  .limit(10)
  .get();

const count = await db.collection(posts).where("likes", ">=", 10).count();
const totalLikes = await db.collection(posts).sum("likes");
// number | null, null over an empty match
const meanLikes = await db.collection(posts).average("likes");
```

`last` is the previous page's final document. Ordering by ID too prevents skipping posts with matching titles.

`where` is typed against the schema. The field must exist and the value must match its type (`in` / `not-in` take an array, `array-contains` takes an element, and so on). A mismatch is a compile error.

Dotted paths reach into nested maps, typed end to end. `where("customer.address.city", "==", "London")` requires that path to exist and its value to be a string. Paths stop at arrays and timestamps (those are queried as whole values), so `where("tags", "array-contains", "vip")` is valid but `where("tags.0", ...)` is not.

The document id is not a schema field, so target it with `documentId()` (imported from `firesmith`). Use it to filter by id, or as an ordering tiebreak. Id values are plain strings, not the schema's field types.

```ts
import { documentId } from "firesmith";

const some = await db
  .collection(posts)
  .where(documentId(), "in", ["hello-world", "second-post"])
  .get();

const ordered = await db
  .collection(posts)
  .orderBy("likes")
  .orderBy(documentId())
  .get();
```

## Live updates

`onSnapshot` returns an unsubscribe function. Pass a callback, or an observer object `{ next, error }`.

```ts
const unsub = db
  .collection(posts)
  .where("likes", ">=", 10)
  .onSnapshot((docs) => {
    // docs: Doc[]
  });

db.collection(posts)
  .doc("hello-world")
  .onSnapshot({
    next: (doc) => {
      // doc: Doc | null
    },
    error: (err) => {
      // network or permission error
    },
  });
```

On the web SDK, a pending `serverTimestamp()` in a latency-compensated snapshot reads as an estimated `Date` rather than the SDK's default `null`, so the field keeps its schema type. Admin always reads committed server data, so the case never arises there.

## Subcollections and collection groups

A collection definition is reusable, so the same `def` works at any depth. Open a subcollection from a document handle, and query across every collection of that name with `collectionGroup`.

```ts
const comments = collection(
  "comments",
  z.object({ text: z.string(), createdAt: z.date() }),
);

await db.collection(posts).doc("hello-world").collection(comments).set("c1", {
  text: "Great post",
  createdAt: new Date(),
});

// every "comments" subcollection, regardless of parent
const recent = await db
  .collectionGroup(comments)
  .orderBy("createdAt", "desc")
  .limit(20)
  .get();
```

## Transactions

`runTransaction` hands you transaction-scoped handles. As with the SDK, reads must precede writes and the callback may retry, so keep it side-effect free.

```ts
await db.runTransaction(async (tx) => {
  const post = await tx.collection(posts).get("hello-world");
  if (!post) return;
  tx.collection(posts).update("hello-world", { likes: post.likes + 1 });
});
```

Inside a transaction, reads are async (await them), but writes buffer synchronously and commit at the end, so they take no `await`.

Cap the retries with `runTransaction(fn, { maxAttempts })`; Firestore defaults to 5.

## Batched writes

`db.batch()` returns a batch whose collection handles expose write-only `set` / `update` / `delete`. Each buffers synchronously and takes no `await`; nothing is applied until `commit()`, which writes the whole batch atomically.

```ts
const batch = db.batch();
batch.collection(posts).update("hello-world", { likes: increment(1) });
batch.collection(posts).delete("old-draft");
await batch.commit();
```

It is the right tool for blind atomic writes. A transaction would cover these too, but brings retry and contention machinery along for reads you never make, and in the web SDK a transaction cannot run offline while a batch can. The handle is write-only: there is no `get` (a batch never reads) and no `add` (nothing returns an id before commit). Writes are coerced and typed exactly as on a normal handle.

## What's guaranteed

`firesmith` types and coerces. It does not validate.

Reads are coerced and typed. A read coerces stored Firestore values to neutral types (every `Timestamp` becomes a `Date`), then merges the document id in flat as `(T & { id }) | null`. `firesmith` never runs your schema, so a document that has drifted from it still comes back, typed as valid. Validate on read yourself where that matters.

Writes are coerced. `set`, `add`, `update` and merge `set` coerce `Date` to `Timestamp` and translate sentinels, then write. The typed surface constrains every field at compile time, but nothing is checked at runtime.

### Sentinels

`firesmith` provides its own sentinels (`serverTimestamp`, `increment`, `arrayUnion`, `arrayRemove`, `deleteField`) because a neutral schema can't reference the admin or web `FieldValue` class. Each driver translates them to its own SDK at write time.

In `update` and merge `set`, each sentinel is constrained to the field types it fits. `increment` works only on a number field, `arrayUnion` / `arrayRemove` only on a matching array, `serverTimestamp` only on a `Date` or `Timestamp` field, and `deleteField` only on an optional field. A mismatch is a compile error.

```ts
// ok
await db.collection(posts).update("hello-world", { likes: increment(1) });
// @ts-expect-error increment is not valid on a string field
await db.collection(posts).update("hello-world", { title: increment(1) });
```

### Nested updates

`update` also takes dotted-path keys reaching into nested maps, typed end to end against the schema. The value is typed to that path and sentinels stay constrained, so `increment` works on a nested number path and `deleteField` only on an optional one. A whole-map write still replaces the map; a dotted path touches one field and leaves its siblings intact.

```ts
// ok, siblings kept
await db.collection(orders).update("o1", { "totals.items": increment(1) });
// @ts-expect-error value type must match the path
await db.collection(orders).update("o1", { "totals.items": "many" });
```

Dotted keys are a field-path notation in `update` only. In a merge `set`, Firestore writes them as a field named literally `"totals.items"`, so they stay off that surface; nest with an object instead (`set({ totals: { items } }, { merge: true })`).

Merge `set` accepts recursively partial maps with either `merge: true` or `mergeFields`, including in transactions and batches. Nested fields accept type-compatible sentinels, including `deleteField()` on optional fields. Array elements and atomic values such as dates must stay complete. Whole-map `update` values still require every required child because they replace the map.

## Timestamps

Schemas speak `Date`. The boundary coerces between `Date` and `Timestamp` deeply (including nested maps and arrays) by runtime type. On read, every Firestore `Timestamp` becomes a `Date`. On write, a `Date` becomes a `Timestamp`.

> [!WARNING]
> `Date` is millisecond precision and Firestore `Timestamp` is nanosecond, so the round-trip truncates sub-millisecond precision.

If a field needs full nanosecond precision, keep it raw with the `raw` option (a list of dotted field paths). Those paths return the raw SDK value uncoerced on read, whatever the type, so your schema types them as the SDK type (`Timestamp` here) rather than a `Date`. The same option keeps any other field raw too, for example an SDK `Bytes` instead of a coerced `Uint8Array`.

```ts
import { collection, isTimestampLike, type Timestamp } from "firesmith";
import { z } from "zod";

const events = collection(
  "events",
  z.object({
    name: z.string(),
    // stays a Timestamp, full precision
    at: z.custom<Timestamp>(isTimestampLike),
  }),
  { raw: ["at"] },
);
```

## Bytes

Bytes are the binary analogue of timestamps. Schemas speak `Uint8Array`, the JS-native binary type, with no SDK import. The boundary coerces it to the SDK bytes type on write (the web `Bytes` class, an admin `Buffer`) and back to a plain `Uint8Array` on read, deeply, the same as `Date` and `Timestamp`. Lossless, so no precision caveat.

```ts
import { collection } from "firesmith";
import { z } from "zod";

const files = collection("files", z.object({ blob: z.custom<Uint8Array>() }));

await db.collection(files).set("f", { blob: new Uint8Array([1, 2, 3]) });
const file = await db.collection(files).get("f");
// a plain Uint8Array on both SDKs
file?.blob;
```

## Neutral value types

A schema can name Firestore's other value types without importing either SDK. `firesmith` ships structural `GeoPoint`, `DocumentReference` and `VectorValue` interfaces that mirror neutral `Timestamp`. They are types only: `firesmith` does not coerce them. They round-trip uncoerced as the SDK class instance you read and write.

```ts
import { collection, type GeoPoint } from "firesmith";
import { z } from "zod";

const places = collection(
  "places",
  z.object({
    name: z.string(),
    // an SDK GeoPoint, passed through untouched
    at: z.custom<GeoPoint>(),
  }),
);
```

## Schema drift

`firesmith` does not validate, so it does not catch drift. Stored data can diverge from the current schema: legacy docs, partial migrations, edits from other services or the console. A drifted document comes back coerced and typed as valid rather than throwing. Where that matters, run your schema on the result yourself, or drop to the SDK via `.ref`.

## Escape hatch

Every handle exposes a `.ref` with the converter attached, so raw Firestore calls that `firesmith` doesn't wrap still run through it where the SDK invokes it. The converter coerces both directions: a read coerces stored values to neutral types and merges the id in, a write coerces `Date` to `Timestamp` and translates sentinels.

`.ref` is typed `unknown` so the neutral core imports no SDK. Each entrypoint ships typed helpers, `docRef` / `collectionRef` / `queryRef`, that hand back the SDK ref typed to your schema, so you don't cast by hand.

```ts
// or "firesmith/web"
import { docRef } from "firesmith/admin";

// DocumentReference<Doc<typeof posts.schema>>
const ref = docRef(db.collection(posts).doc("hello-world"));

// raw SDK call firesmith does not wrap, data() is still coerced
const unsub = ref.onSnapshot((snap) => {
  // post: Doc<typeof posts.schema> | undefined
  const post = snap.data();
});
```

If you need to drop fully to the raw SDK type yourself, `.ref` is still there to cast at the boundary.

> [!WARNING]
> Firestore runs no converter for `updateDoc` / `ref.update(...)`, so a raw `update` through `.ref` skips coercion entirely (you pass native values). The typed `.update(...)` and merge `set` still coerce.

## Errors

- `FiresmithError` is the base class for the few errors `firesmith` raises itself (such as an unknown sentinel). `firesmith` polices neither ids nor write/query shapes, so those surface as the SDK's own error.
- Firestore, network, and permission errors propagate untouched.
