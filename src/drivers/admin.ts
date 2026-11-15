import {
  AggregateField,
  FieldPath as AdminFieldPath,
  FieldValue as AdminFieldValue,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type FirestoreDataConverter,
  type Query,
  type QueryDocumentSnapshot,
  type SetOptions,
  Timestamp as AdminTimestamp,
} from "firebase-admin/firestore";

import { toNative } from "@/core/coerce";
import type {
  BatchDriver,
  Constraint,
  DocObserver,
  DocumentData,
  Driver,
  FieldRef,
  NativeAdapter,
  QueryObserver,
  QuerySource,
  RawConverter,
  RawSnapshot,
  TransactionOptions,
  TxDriver,
  Unsubscribe,
  WriteOptions,
} from "@/core/driver";
import { FiresmithError } from "@/core/errors";
import {
  ArrayRemoveSentinel,
  ArrayUnionSentinel,
  DeleteFieldSentinel,
  IncrementSentinel,
  type Sentinel,
  ServerTimestampSentinel,
} from "@/core/firestore";

// Driver for the firebase-admin OO method-based SDK
export class AdminDriver implements Driver {
  readonly native: NativeAdapter;
  readonly #fs: Firestore;

  constructor(firestore: Firestore) {
    this.#fs = firestore;
    this.native = {
      timestamp: (seconds, nanoseconds) =>
        new AdminTimestamp(seconds, nanoseconds),
      timestampFromDate: (date) => AdminTimestamp.fromDate(date),
      fieldValue: (sentinel) => this.#fieldValue(sentinel),
      // Admin serialises a Uint8Array as bytes, so hand it straight through
      bytesFromUint8Array: (bytes) => bytes,
    };
  }

  #fieldValue(sentinel: Sentinel): AdminFieldValue {
    if (sentinel instanceof ServerTimestampSentinel) {
      return AdminFieldValue.serverTimestamp();
    }
    if (sentinel instanceof IncrementSentinel) {
      return AdminFieldValue.increment(sentinel.by);
    }
    if (sentinel instanceof ArrayUnionSentinel) {
      return AdminFieldValue.arrayUnion(...this.#values(sentinel.values));
    }
    if (sentinel instanceof ArrayRemoveSentinel) {
      return AdminFieldValue.arrayRemove(...this.#values(sentinel.values));
    }
    if (sentinel instanceof DeleteFieldSentinel) {
      return AdminFieldValue.delete();
    }
    throw new FiresmithError("Unknown sentinel");
  }

  #values(values: readonly unknown[]): unknown[] {
    return values.map((value) => toNative(value, this.native));
  }

  #setOptions(options?: WriteOptions): SetOptions {
    if (options?.mergeFields) {
      return { mergeFields: [...options.mergeFields] };
    }
    if (options?.merge) {
      return { merge: true };
    }

    return {};
  }

  #doc(segments: readonly string[]): DocumentReference {
    return this.#fs.doc(segments.join("/"));
  }

  #collection(segments: readonly string[]): CollectionReference {
    return this.#fs.collection(segments.join("/"));
  }

  #query(source: QuerySource, constraints: readonly Constraint[]): Query {
    let query: Query =
      source.kind === "collection"
        ? this.#collection(source.segments)
        : this.#fs.collectionGroup(source.collectionId);
    // Admin rejects where() after a cursor, filters are ANDed so apply them first
    const filtersFirst = [
      ...constraints.filter((constraint) => constraint.type === "where"),
      ...constraints.filter((constraint) => constraint.type !== "where"),
    ];
    for (const constraint of filtersFirst) {
      query = this.#applyConstraint(query, constraint);
    }

    return query;
  }

  #applyConstraint(query: Query, constraint: Constraint): Query {
    switch (constraint.type) {
      case "where":
        return query.where(
          fieldRef(constraint.field),
          constraint.op,
          toNative(constraint.value, this.native),
        );
      case "orderBy":
        return query.orderBy(fieldRef(constraint.field), constraint.direction);
      case "limit":
        return query.limit(constraint.limit);
      case "startAt":
        return query.startAt(...this.#values(constraint.values));
      case "startAfter":
        return query.startAfter(...this.#values(constraint.values));
      case "endAt":
        return query.endAt(...this.#values(constraint.values));
      case "endBefore":
        return query.endBefore(...this.#values(constraint.values));
    }
  }

  async getDoc(segments: readonly string[]): Promise<RawSnapshot | null> {
    return rawSnapshot(await this.#doc(segments).get());
  }

  async setDoc(
    segments: readonly string[],
    data: DocumentData,
    options?: WriteOptions,
  ): Promise<void> {
    await this.#doc(segments).set(data, this.#setOptions(options));
  }

  async updateDoc(
    segments: readonly string[],
    data: DocumentData,
  ): Promise<void> {
    await this.#doc(segments).update(data);
  }

  async addDoc(
    segments: readonly string[],
    data: DocumentData,
  ): Promise<string> {
    const ref = await this.#collection(segments).add(data);

    return ref.id;
  }

  async deleteDoc(segments: readonly string[]): Promise<void> {
    await this.#doc(segments).delete();
  }

  async runQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<RawSnapshot[]> {
    const snapshot = await this.#query(source, constraints).get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      path: doc.ref.path,
      data: doc.data(),
    }));
  }

  async count(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<number> {
    const snapshot = await this.#query(source, constraints).count().get();

    return snapshot.data().count;
  }

  async sum(
    source: QuerySource,
    constraints: readonly Constraint[],
    field: string,
  ): Promise<number> {
    const snapshot = await this.#query(source, constraints)
      .aggregate({ value: AggregateField.sum(field) })
      .get();

    return snapshot.data().value;
  }

  async average(
    source: QuerySource,
    constraints: readonly Constraint[],
    field: string,
  ): Promise<number | null> {
    const snapshot = await this.#query(source, constraints)
      .aggregate({ value: AggregateField.average(field) })
      .get();

    return snapshot.data().value;
  }

  onSnapshotDoc(
    segments: readonly string[],
    observer: DocObserver,
  ): Unsubscribe {
    return this.#doc(segments).onSnapshot(
      (snapshot) => observer.next(rawSnapshot(snapshot)),
      observer.error?.bind(observer),
    );
  }

  onSnapshotQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
    observer: QueryObserver,
  ): Unsubscribe {
    return this.#query(source, constraints).onSnapshot(
      (snapshot) =>
        observer.next(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            path: doc.ref.path,
            data: doc.data(),
          })),
        ),
      observer.error?.bind(observer),
    );
  }

  runTransaction<T>(
    fn: (tx: TxDriver) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return this.#fs.runTransaction((transaction) => {
      const tx: TxDriver = {
        native: this.native,
        ref: transaction,
        get: async (segments) =>
          rawSnapshot(await transaction.get(this.#doc(segments))),
        set: (segments, data, options) => {
          transaction.set(this.#doc(segments), data, this.#setOptions(options));
        },
        update: (segments, data) => {
          transaction.update(this.#doc(segments), data);
        },
        delete: (segments) => {
          transaction.delete(this.#doc(segments));
        },
      };

      return fn(tx);
    }, options);
  }

  batch(): BatchDriver {
    const batch = this.#fs.batch();

    return {
      native: this.native,
      set: (segments, data, options) => {
        batch.set(this.#doc(segments), data, this.#setOptions(options));
      },
      update: (segments, data) => {
        batch.update(this.#doc(segments), data);
      },
      delete: (segments) => {
        batch.delete(this.#doc(segments));
      },
      commit: async () => {
        await batch.commit();
      },
    };
  }

  docRef(segments: readonly string[], converter: RawConverter): unknown {
    return this.#doc(segments).withConverter(adaptConverter(converter));
  }

  collectionRef(segments: readonly string[], converter: RawConverter): unknown {
    return this.#collection(segments).withConverter(adaptConverter(converter));
  }

  queryRef(
    source: QuerySource,
    constraints: readonly Constraint[],
    converter: RawConverter,
  ): unknown {
    return this.#query(source, constraints).withConverter(
      adaptConverter(converter),
    );
  }
}

// Document id reference translates to SDK documentId field path
function fieldRef(field: FieldRef): string | AdminFieldPath {
  return typeof field === "string" ? field : AdminFieldPath.documentId();
}

function rawSnapshot(snapshot: DocumentSnapshot): RawSnapshot | null {
  const data = snapshot.data();

  return data === undefined
    ? null
    : {
        id: snapshot.id,
        path: snapshot.ref.path,
        data,
      };
}

function adaptConverter(
  converter: RawConverter,
): FirestoreDataConverter<DocumentData> {
  return {
    toFirestore: (model) => converter.toNative(model),
    fromFirestore: (snapshot: QueryDocumentSnapshot) =>
      converter.fromNative({
        id: snapshot.id,
        path: snapshot.ref.path,
        data: snapshot.data(),
      }),
  };
}
