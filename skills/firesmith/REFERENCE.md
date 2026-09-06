# firesmith reference

Full usage reference for the `firesmith` surface. All snippets assume a `db` from `createDatabase` and defs like:

```ts
import { collection } from "firesmith";
import { z } from "zod";

const posts = collection(
  "posts",
  z.object({
    title: z.string(),
    likes: z.number(),
    tags: z.array(z.string()),
    createdAt: z.date(),
    meta: z
      .object({ views: z.number(), pinned: z.boolean().optional() })
      .optional(),
  }),
);
```

## Reads

```ts
// Doc | null
const post = await db.collection(posts).get("hello");
// same, via document handle
const same = await db.collection(posts).doc("hello").get();
// boolean
const there = await db.collection(posts).doc("hello").exists();
```

`Doc<S> = InferOutput<S> & { id: string }`. The id is merged flat on read and never stored.

## Writes

```ts
// Full write, every field required
await db
  .collection(posts)
  .set("hello", { title: "Hello", likes: 0, tags: [], createdAt: new Date() });

// Merge, partial and typed
await db.collection(posts).set("hello", { likes: 10 }, { merge: true });

// Merge only listed fields
await db
  .collection(posts)
  .set("hello", { likes: 10, title: "ignored" }, { mergeFields: ["likes"] });

// Update, partial with dotted paths and sentinels
await db.collection(posts).update("hello", { likes: increment(1) });

// Auto-id insert, returns the new id
const id = await db
  .collection(posts)
  .add({ title: "Second", likes: 0, tags: [], createdAt: new Date() });

await db.collection(posts).delete(id);
```

Every write also exists on a document handle: `db.collection(posts).doc("hello").set(...) / .update(...) / .delete()`.

## Sentinels

Import from `firesmith`, never an SDK `FieldValue`. Each is constrained at compile time to the field types it fits:

| Sentinel            | Valid on                          |
| ------------------- | --------------------------------- |
| `increment(n)`      | `number` fields                   |
| `serverTimestamp()` | `Date` or `Timestamp` fields      |
| `arrayUnion(...v)`  | matching array fields             |
| `arrayRemove(...v)` | matching array fields             |
| `deleteField()`     | optional fields only, update only |

`set` / `add` accept sentinels per field but not `deleteField` (a full write cannot delete a field). Firestore rejects a sentinel inside an array; `firesmith` forwards that as the SDK's own error.

## Nested updates

`update` takes dotted-path keys through nested maps, each value typed to that path:

```ts
// siblings kept
await db.collection(posts).update("hello", { "meta.views": increment(1) });
// whole map replaced
await db.collection(posts).update("hello", { meta: { views: 0 } });
```

Dotted keys are field-path notation in `update` only. In a merge `set`, Firestore stores `"meta.views"` as a literal field name, so nest an object instead: `set(id, { meta: { views: 0 } }, { merge: true })`.

## Queries

The builder is immutable, so a base query is reusable. `.get()` (alias `.list()`) returns `Doc[]` and drops non-existent snapshots.

```ts
import { documentId } from "firesmith";

const base = db.collection(posts).where("likes", ">=", 10);
const top = await base.orderBy("likes", "desc").limit(10).get();

// Cursors take field values matching the orderBy chain
const byTitle = db.collection(posts).orderBy("title").orderBy(documentId());
const firstPage = await byTitle.limit(10).get();
const last = firstPage.at(-1);
if (last) {
  const nextPage = await byTitle
    .startAfter(last.title, last.id)
    .limit(10)
    .get();
}
// also startAt / endAt / endBefore

// Aggregations, typed to numeric fields
const n = await base.count();
const total = await db.collection(posts).sum("likes");
// number | null, null over empty match
const mean = await db.collection(posts).average("likes");
```

For pagination, order by `documentId()` after the sort field and pass both values from the last document to the cursor. A cursor with only the title skips remaining documents with that title.

Operator typing: `in` / `not-in` take an array, `array-contains` an element, `array-contains-any` an array of elements, comparison operators the field's type. Dotted paths reach into nested maps (`where("meta.views", ">", 100)`) and stop at arrays and timestamps (query those as whole values: `where("tags", "array-contains", "vip")`, never `"tags.0"`).

Chained `where` is AND-only; there is no `or()`. For a disjunction drop to the SDK via `.ref`.

### Query by document id

The id is not a schema field; target it with `documentId()`:

```ts
import { documentId } from "firesmith";

const some = await db
  .collection(posts)
  .where(documentId(), "in", ["a", "b"])
  .get();
// id tiebreak
const stable = await db
  .collection(posts)
  .orderBy("likes")
  .orderBy(documentId())
  .get();
```

## Live updates

`onSnapshot` takes a callback or an observer `{ next, error }` and returns an unsubscribe function:

```ts
const unsub = db
  .collection(posts)
  .where("likes", ">=", 10)
  .onSnapshot((docs) => {
    // Doc[]
  });
db.collection(posts)
  .doc("hello")
  .onSnapshot({
    next: (doc) => {
      // Doc | null
    },
    error: (err) => {
      // network or permission error
    },
  });
```

On web, a pending `serverTimestamp()` in a latency-compensated snapshot reads as an estimated `Date` (not `null`), keeping the schema type. Admin always reads committed data.

## Subcollections and collection groups

A def is unbound, so the same value works at any depth:

```ts
const comments = collection(
  "comments",
  z.object({ text: z.string(), createdAt: z.date() }),
);

await db
  .collection(posts)
  .doc("hello")
  .collection(comments)
  .set("c1", { text: "Hi", createdAt: new Date() });

// Every "comments" collection regardless of parent
const recent = await db
  .collectionGroup(comments)
  .orderBy("createdAt", "desc")
  .limit(20)
  .get();
```

## Transactions

Reads are async and must precede writes; writes return `void`, buffer synchronously, and commit at the end (no `await` on writes). The callback may retry, so keep it side-effect free.

```ts
// options optional, Firestore defaults to 5
await db.runTransaction(
  async (tx) => {
    const post = await tx.collection(posts).get("hello");
    if (!post) return;
    tx.collection(posts).update("hello", { likes: post.likes + 1 });
  },
  { maxAttempts: 3 },
);
```

## Batched writes

Blind atomic writes without transaction retry/contention cost (and they work offline on web). Write-only: no `get`, no `add`.

```ts
const batch = db.batch();
batch.collection(posts).update("hello", { likes: increment(1) });
batch.collection(posts).delete("old-draft");
await batch.commit();
```

## Timestamps, raw fields

Schemas speak `Date`; the boundary coerces `Date` to `Timestamp` on write and back on read, deeply. `Date` is millisecond precision, so the round-trip truncates sub-millisecond precision. For full precision keep the field raw:

```ts
import { collection, isTimestampLike, type Timestamp } from "firesmith";

const events = collection(
  "events",
  z.object({ name: z.string(), at: z.custom<Timestamp>(isTimestampLike) }),
  // dotted paths returned uncoerced on read, whole subtree
  { raw: ["at"] },
);
```

`raw` works for any field, not only timestamps (e.g. keep SDK `Bytes` instead of `Uint8Array`).

## Bytes

Schemas speak `Uint8Array`; coerced to web `Bytes` / admin `Buffer` on write and back on read. Lossless.

```ts
const files = collection("files", z.object({ blob: z.custom<Uint8Array>() }));
await db.collection(files).set("f", { blob: new Uint8Array([1, 2, 3]) });
```

## Neutral value types

`Timestamp`, `GeoPoint`, `DocumentReference`, `VectorValue` are structural interfaces exported from `firesmith`, so a schema names them without importing an SDK. Only timestamps and bytes are coerced; the rest round-trip as the SDK class instance.

```ts
import { type GeoPoint } from "firesmith";
const places = collection("places", z.object({ at: z.custom<GeoPoint>() }));
```

## Escape hatch: `.ref`

Every collection, document, and query handle exposes `.ref`, the raw SDK ref with the coercing converter attached, so unwrapped SDK calls still coerce where the SDK invokes the converter. `.ref` is typed `unknown`; use the entrypoint's typed helpers instead of casting:

```ts
// or /web
import { docRef, collectionRef, queryRef } from "firesmith/admin";

// DocumentReference<Doc<S>>
const ref = docRef(db.collection(posts).doc("hello"));
const unsub = ref.onSnapshot((snap) => {
  // still coerced, Doc | undefined
  const post = snap.data();
});
```

Firestore runs no converter for `updateDoc` / `ref.update(...)`, so a raw update through `.ref` skips coercion entirely (pass native values). The typed `.update(...)` and merge `set` still coerce.

## Errors

`FiresmithError` covers only `firesmith`'s own failures (e.g. an unknown sentinel). Firestore, network, and permission errors propagate untouched, and `firesmith` polices neither ids nor write/query shapes, so an invalid shape surfaces as the SDK's own error.

## Gotchas

- Never declare `id` in a schema; `collection()` rejects it at compile time.
- No runtime validation, ever. Drifted documents come back typed as valid; validate on read yourself where it matters.
- Schemas must describe a Firestore-storable object (no directly nested arrays); `firesmith` does not police this, the SDK errors at write time.
- Transaction and batch writes take no `await`; a forgotten one still enqueues, deliberately.
- `deleteField()` compiles only on optional fields and only in `update` (and merge `set` field values).
- `average()` is `null` over an empty match; `sum()` is `0`.
- Cursor values must match the `orderBy` chain; there is no cursor-by-document.
- Admin-only SDK features (`create`, `getAll`, `BulkWriter`, preconditions) are off the neutral surface; reach them via `.ref`.
