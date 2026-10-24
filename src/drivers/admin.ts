import {
  AggregateField,
  FieldPath as AdminFieldPath,
  FieldValue as AdminFieldValue,
  type CollectionReference,
  type DocumentReference,
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
  CollectionLocation,
  Constraint,
  DocLocation,
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

  #setOptions(options?: WriteOptions): SetOptions | undefined {
    if (options?.mergeFields) {
      return { mergeFields: [...options.mergeFields] };
    }
    if (options?.merge) {
      return { merge: true };
    }
    return undefined;
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
    for (const constraint of constraints) {
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

  async getDoc(path: DocLocation): Promise<RawSnapshot> {
    const snapshot = await this.#doc(path.segments).get();

    return {
      id: snapshot.id,
      path: snapshot.ref.path,
      exists: snapshot.exists,
      data: snapshot.data(),
    };
  }

  async setDoc(
    path: DocLocation,
    data: DocumentData,
    options?: WriteOptions,
  ): Promise<void> {
    const ref = this.#doc(path.segments);
    const setOptions = this.#setOptions(options);
    await (setOptions ? ref.set(data, setOptions) : ref.set(data));
  }

  async updateDoc(path: DocLocation, data: DocumentData): Promise<void> {
    await this.#doc(path.segments).update(data);
  }

  async addDoc(path: CollectionLocation, data: DocumentData): Promise<string> {
    const ref = await this.#collection(path.segments).add(data);
    return ref.id;
  }

  async deleteDoc(path: DocLocation): Promise<void> {
    await this.#doc(path.segments).delete();
  }

  async runQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<RawSnapshot[]> {
    const snapshot = await this.#query(source, constraints).get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      path: doc.ref.path,
      exists: true,
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

  onSnapshotDoc(path: DocLocation, observer: DocObserver): Unsubscribe {
    return this.#doc(path.segments).onSnapshot(
      (snapshot) =>
        observer.next({
          id: snapshot.id,
          path: snapshot.ref.path,
          exists: snapshot.exists,
          data: snapshot.data(),
        }),
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
            exists: true,
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
        get: async (path) => {
          const snapshot = await transaction.get(this.#doc(path.segments));
          return {
            id: snapshot.id,
            path: snapshot.ref.path,
            exists: snapshot.exists,
            data: snapshot.data(),
          };
        },
        set: (path, data, options) => {
          const ref = this.#doc(path.segments);
          const setOptions = this.#setOptions(options);
          if (setOptions) {
            transaction.set(ref, data, setOptions);
          } else {
            transaction.set(ref, data);
          }
        },
        update: (path, data) => {
          transaction.update(this.#doc(path.segments), data);
        },
        delete: (path) => {
          transaction.delete(this.#doc(path.segments));
        },
      };
      return fn(tx);
    }, options);
  }

  batch(): BatchDriver {
    const batch = this.#fs.batch();
    return {
      set: (path, data, options) => {
        const ref = this.#doc(path.segments);
        const setOptions = this.#setOptions(options);
        if (setOptions) {
          batch.set(ref, data, setOptions);
        } else {
          batch.set(ref, data);
        }
      },
      update: (path, data) => {
        batch.update(this.#doc(path.segments), data);
      },
      delete: (path) => {
        batch.delete(this.#doc(path.segments));
      },
      commit: async () => {
        await batch.commit();
      },
    };
  }

  docRef(path: DocLocation, converter: RawConverter): unknown {
    return this.#doc(path.segments).withConverter(adaptConverter(converter));
  }

  collectionRef(path: CollectionLocation, converter: RawConverter): unknown {
    return this.#collection(path.segments).withConverter(
      adaptConverter(converter),
    );
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

function adaptConverter(
  converter: RawConverter,
): FirestoreDataConverter<DocumentData> {
  return {
    toFirestore: (model) => converter.toNative(model),
    fromFirestore: (snapshot: QueryDocumentSnapshot) =>
      converter.fromNative(
        snapshot.id,
        snapshot.ref.path,
        snapshot.data(),
      ) as DocumentData,
  };
}
