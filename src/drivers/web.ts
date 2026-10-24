import {
  addDoc as webAddDoc,
  arrayRemove as webArrayRemove,
  arrayUnion as webArrayUnion,
  average as webAverage,
  Bytes as WebBytes,
  collection as webCollection,
  collectionGroup as webCollectionGroup,
  deleteDoc as webDeleteDoc,
  deleteField as webDeleteField,
  doc as webDoc,
  documentId as webDocumentId,
  endAt as webEndAt,
  endBefore as webEndBefore,
  getAggregateFromServer,
  getCountFromServer,
  getDoc as webGetDoc,
  getDocs,
  increment as webIncrement,
  limit as webLimit,
  onSnapshot as webOnSnapshot,
  orderBy as webOrderBy,
  query as webQuery,
  runTransaction as webRunTransaction,
  serverTimestamp as webServerTimestamp,
  setDoc as webSetDoc,
  startAfter as webStartAfter,
  startAt as webStartAt,
  sum as webSum,
  Timestamp as WebTimestamp,
  updateDoc as webUpdateDoc,
  where as webWhere,
  writeBatch as webWriteBatch,
  type CollectionReference,
  type DocumentData as WebDocumentData,
  type DocumentReference,
  type FieldPath as WebFieldPath,
  type FieldValue as WebFieldValue,
  type Firestore,
  type FirestoreDataConverter,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type SetOptions,
  type SnapshotOptions,
} from "firebase/firestore";

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

// Pending serverTimestamp() reads null, estimate from clock for the Date type
const SNAPSHOT_OPTIONS: SnapshotOptions = { serverTimestamps: "estimate" };

// Driver for the firebase modular functional web SDK
export class WebDriver implements Driver {
  readonly native: NativeAdapter;
  readonly #fs: Firestore;

  constructor(firestore: Firestore) {
    this.#fs = firestore;
    this.native = {
      timestamp: (seconds, nanoseconds) =>
        new WebTimestamp(seconds, nanoseconds),
      timestampFromDate: (date) => WebTimestamp.fromDate(date),
      fieldValue: (sentinel) => this.#fieldValue(sentinel),
      bytesFromUint8Array: (bytes) => WebBytes.fromUint8Array(bytes),
    };
  }

  #fieldValue(sentinel: Sentinel): WebFieldValue {
    if (sentinel instanceof ServerTimestampSentinel) {
      return webServerTimestamp();
    }
    if (sentinel instanceof IncrementSentinel) {
      return webIncrement(sentinel.by);
    }
    if (sentinel instanceof ArrayUnionSentinel) {
      return webArrayUnion(...this.#values(sentinel.values));
    }
    if (sentinel instanceof ArrayRemoveSentinel) {
      return webArrayRemove(...this.#values(sentinel.values));
    }
    if (sentinel instanceof DeleteFieldSentinel) {
      return webDeleteField();
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
    return webDoc(this.#fs, segments.join("/"));
  }

  #collection(segments: readonly string[]): CollectionReference {
    return webCollection(this.#fs, segments.join("/"));
  }

  #query(source: QuerySource, constraints: readonly Constraint[]): Query {
    const base: Query =
      source.kind === "collection"
        ? this.#collection(source.segments)
        : webCollectionGroup(this.#fs, source.collectionId);
    return webQuery(base, ...constraints.map((c) => this.#constraint(c)));
  }

  #constraint(constraint: Constraint): QueryConstraint {
    switch (constraint.type) {
      case "where":
        return webWhere(
          fieldRef(constraint.field),
          constraint.op,
          toNative(constraint.value, this.native),
        );
      case "orderBy":
        return webOrderBy(fieldRef(constraint.field), constraint.direction);
      case "limit":
        return webLimit(constraint.limit);
      case "startAt":
        return webStartAt(...this.#values(constraint.values));
      case "startAfter":
        return webStartAfter(...this.#values(constraint.values));
      case "endAt":
        return webEndAt(...this.#values(constraint.values));
      case "endBefore":
        return webEndBefore(...this.#values(constraint.values));
    }
  }

  async getDoc(path: DocLocation): Promise<RawSnapshot> {
    const snapshot = await webGetDoc(this.#doc(path.segments));
    return {
      id: snapshot.id,
      path: snapshot.ref.path,
      exists: snapshot.exists(),
      data: snapshot.data(SNAPSHOT_OPTIONS),
    };
  }

  async setDoc(
    path: DocLocation,
    data: DocumentData,
    options?: WriteOptions,
  ): Promise<void> {
    const ref = this.#doc(path.segments);
    const setOptions = this.#setOptions(options);
    await (setOptions
      ? webSetDoc(ref, data, setOptions)
      : webSetDoc(ref, data));
  }

  async updateDoc(path: DocLocation, data: DocumentData): Promise<void> {
    await webUpdateDoc(this.#doc(path.segments), data);
  }

  async addDoc(path: CollectionLocation, data: DocumentData): Promise<string> {
    const ref = await webAddDoc(this.#collection(path.segments), data);
    return ref.id;
  }

  async deleteDoc(path: DocLocation): Promise<void> {
    await webDeleteDoc(this.#doc(path.segments));
  }

  async runQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<RawSnapshot[]> {
    const snapshot = await getDocs(this.#query(source, constraints));
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      path: doc.ref.path,
      exists: true,
      data: doc.data(SNAPSHOT_OPTIONS),
    }));
  }

  async count(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<number> {
    const snapshot = await getCountFromServer(this.#query(source, constraints));
    return snapshot.data().count;
  }

  async sum(
    source: QuerySource,
    constraints: readonly Constraint[],
    field: string,
  ): Promise<number> {
    const snapshot = await getAggregateFromServer(
      this.#query(source, constraints),
      { value: webSum(field) },
    );
    return snapshot.data().value;
  }

  async average(
    source: QuerySource,
    constraints: readonly Constraint[],
    field: string,
  ): Promise<number | null> {
    const snapshot = await getAggregateFromServer(
      this.#query(source, constraints),
      { value: webAverage(field) },
    );
    return snapshot.data().value;
  }

  onSnapshotDoc(path: DocLocation, observer: DocObserver): Unsubscribe {
    return webOnSnapshot(
      this.#doc(path.segments),
      (snapshot) =>
        observer.next({
          id: snapshot.id,
          path: snapshot.ref.path,
          exists: snapshot.exists(),
          data: snapshot.data(SNAPSHOT_OPTIONS),
        }),
      observer.error?.bind(observer),
    );
  }

  onSnapshotQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
    observer: QueryObserver,
  ): Unsubscribe {
    return webOnSnapshot(
      this.#query(source, constraints),
      (snapshot) =>
        observer.next(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            path: doc.ref.path,
            exists: true,
            data: doc.data(SNAPSHOT_OPTIONS),
          })),
        ),
      observer.error?.bind(observer),
    );
  }

  runTransaction<T>(
    fn: (tx: TxDriver) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return webRunTransaction(
      this.#fs,
      (transaction) => {
        const tx: TxDriver = {
          get: async (path) => {
            const snapshot = await transaction.get(this.#doc(path.segments));
            return {
              id: snapshot.id,
              path: snapshot.ref.path,
              exists: snapshot.exists(),
              data: snapshot.data(SNAPSHOT_OPTIONS),
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
      },
      options,
    );
  }

  batch(): BatchDriver {
    const batch = webWriteBatch(this.#fs);
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
function fieldRef(field: FieldRef): string | WebFieldPath {
  return typeof field === "string" ? field : webDocumentId();
}

function adaptConverter(
  converter: RawConverter,
): FirestoreDataConverter<DocumentData, WebDocumentData> {
  return {
    toFirestore: (model) => converter.toNative(model),
    fromFirestore: (
      snapshot: QueryDocumentSnapshot<WebDocumentData>,
      options: SnapshotOptions,
    ) =>
      converter.fromNative(
        snapshot.id,
        snapshot.ref.path,
        snapshot.data(options.serverTimestamps ? options : SNAPSHOT_OPTIONS),
      ) as DocumentData,
  };
}
