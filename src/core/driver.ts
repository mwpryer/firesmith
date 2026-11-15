import type { DocumentIdRef, Sentinel } from "@/core/firestore";
import type { WhereFilterOp } from "@/core/types";

export type DocumentData = Record<string, unknown>;

// Field for where()/orderBy(), dotted path or document id reference
export type FieldRef = string | DocumentIdRef;

export type QuerySource =
  | { readonly kind: "collection"; readonly segments: readonly string[] }
  | { readonly kind: "collectionGroup"; readonly collectionId: string };

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
  readonly data: DocumentData;
}

export type WriteOptions =
  | { readonly merge: true; readonly mergeFields?: never }
  | { readonly mergeFields: readonly string[]; readonly merge?: never };

export interface TransactionOptions {
  readonly maxAttempts?: number;
}

export type Unsubscribe = () => void;

// Absent error handler must reach the SDK as absent, its default handling wins
export interface DocObserver {
  next(snapshot: RawSnapshot | null): void;
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
  fromNative(snapshot: RawSnapshot): DocumentData;
}

// Transaction writes buffer until commit, so only get awaits
export interface TxDriver {
  readonly native: NativeAdapter;
  readonly ref: unknown;
  get(segments: readonly string[]): Promise<RawSnapshot | null>;
  set(
    segments: readonly string[],
    data: DocumentData,
    options?: WriteOptions,
  ): void;
  update(segments: readonly string[], data: DocumentData): void;
  delete(segments: readonly string[]): void;
}

// Blind batched writes, buffer synchronously until an explicit commit
export interface BatchDriver {
  readonly native: NativeAdapter;
  set(
    segments: readonly string[],
    data: DocumentData,
    options?: WriteOptions,
  ): void;
  update(segments: readonly string[], data: DocumentData): void;
  delete(segments: readonly string[]): void;
  commit(): Promise<void>;
}

export interface Driver {
  readonly native: NativeAdapter;

  getDoc(segments: readonly string[]): Promise<RawSnapshot | null>;
  setDoc(
    segments: readonly string[],
    data: DocumentData,
    options?: WriteOptions,
  ): Promise<void>;
  updateDoc(segments: readonly string[], data: DocumentData): Promise<void>;
  addDoc(segments: readonly string[], data: DocumentData): Promise<string>;
  deleteDoc(segments: readonly string[]): Promise<void>;

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

  onSnapshotDoc(
    segments: readonly string[],
    observer: DocObserver,
  ): Unsubscribe;
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

  docRef(segments: readonly string[], converter: RawConverter): unknown;
  collectionRef(segments: readonly string[], converter: RawConverter): unknown;
  queryRef(
    source: QuerySource,
    constraints: readonly Constraint[],
    converter: RawConverter,
  ): unknown;
}
