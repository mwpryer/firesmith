import type { DocumentIdRef, Sentinel } from "@/core/firestore";
import type { WhereFilterOp } from "@/core/types";

export type DocumentData = Record<string, unknown>;

// Field for where()/orderBy(), dotted path or document id reference
export type FieldRef = string | DocumentIdRef;

// Document location, even-length segments like [collection, id, ...]
export interface DocLocation {
  readonly kind: "doc";
  readonly segments: readonly string[];
}

export function docLocation(segments: readonly string[]): DocLocation {
  return { kind: "doc", segments };
}

// Collection location, odd-length segments [collection, id, ..., collection]
export interface CollectionLocation {
  readonly kind: "collection";
  readonly segments: readonly string[];
}

export function collectionLocation(
  segments: readonly string[],
): CollectionLocation {
  return { kind: "collection", segments };
}

export interface CollectionGroupLocation {
  readonly kind: "collectionGroup";
  readonly collectionId: string;
}

export type QuerySource = CollectionLocation | CollectionGroupLocation;

// Neutral query AST each driver translates to its SDK
export type Constraint =
  | { type: "where"; field: FieldRef; op: WhereFilterOp; value: unknown }
  | { type: "orderBy"; field: FieldRef; direction: "asc" | "desc" }
  | { type: "limit"; limit: number }
  | { type: "startAt"; values: readonly unknown[] }
  | { type: "startAfter"; values: readonly unknown[] }
  | { type: "endAt"; values: readonly unknown[] }
  | { type: "endBefore"; values: readonly unknown[] };

export interface RawSnapshot {
  readonly id: string;
  readonly path: string;
  readonly exists: boolean;
  readonly data: DocumentData | undefined;
}

export interface WriteOptions {
  readonly merge?: boolean;
  // Field paths to merge, exclusive with merge
  readonly mergeFields?: readonly string[];
}

export interface TransactionOptions {
  readonly maxAttempts?: number;
}

export type Unsubscribe = () => void;

// Absent error handler must reach the SDK as absent, its default handling wins
export interface DocObserver {
  next(snapshot: RawSnapshot): void;
  error?(error: unknown): void;
}

export interface QueryObserver {
  next(snapshots: readonly RawSnapshot[]): void;
  error?(error: unknown): void;
}

// Turns neutral values into SDK's Timestamp, FieldValue and bytes type
export interface NativeAdapter {
  timestamp(seconds: number, nanoseconds: number): unknown;
  timestampFromDate(date: Date): unknown;
  fieldValue(sentinel: Sentinel): unknown;
  bytesFromUint8Array(bytes: Uint8Array): unknown;
}

export interface RawConverter {
  toNative(data: DocumentData): DocumentData;
  fromNative(id: string, path: string, data: DocumentData): unknown;
}

// Transaction writes buffer until commit, so only get awaits
export interface TxDriver {
  get(path: DocLocation): Promise<RawSnapshot>;
  set(path: DocLocation, data: DocumentData, options?: WriteOptions): void;
  update(path: DocLocation, data: DocumentData): void;
  delete(path: DocLocation): void;
}

// Blind batched writes, buffer synchronously until an explicit commit
export interface BatchDriver {
  set(path: DocLocation, data: DocumentData, options?: WriteOptions): void;
  update(path: DocLocation, data: DocumentData): void;
  delete(path: DocLocation): void;
  commit(): Promise<void>;
}

export interface Driver {
  readonly native: NativeAdapter;

  getDoc(path: DocLocation): Promise<RawSnapshot>;
  setDoc(
    path: DocLocation,
    data: DocumentData,
    options?: WriteOptions,
  ): Promise<void>;
  updateDoc(path: DocLocation, data: DocumentData): Promise<void>;
  addDoc(path: CollectionLocation, data: DocumentData): Promise<string>;
  deleteDoc(path: DocLocation): Promise<void>;

  runQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<RawSnapshot[]>;
  count(
    source: QuerySource,
    constraints: readonly Constraint[],
  ): Promise<number>;
  sum(
    source: QuerySource,
    constraints: readonly Constraint[],
    field: string,
  ): Promise<number>;
  // Null when no document matches, empty set has no average
  average(
    source: QuerySource,
    constraints: readonly Constraint[],
    field: string,
  ): Promise<number | null>;

  onSnapshotDoc(path: DocLocation, observer: DocObserver): Unsubscribe;
  onSnapshotQuery(
    source: QuerySource,
    constraints: readonly Constraint[],
    observer: QueryObserver,
  ): Unsubscribe;

  runTransaction<T>(
    fn: (tx: TxDriver) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;

  batch(): BatchDriver;

  docRef(path: DocLocation, converter: RawConverter): unknown;
  collectionRef(path: CollectionLocation, converter: RawConverter): unknown;
  queryRef(
    source: QuerySource,
    constraints: readonly Constraint[],
    converter: RawConverter,
  ): unknown;
}
