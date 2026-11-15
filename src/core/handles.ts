import type { StandardSchemaV1 } from "@standard-schema/spec";

import { makeConverter, readSnapshot, toNativeData } from "@/core/coerce";
import type {
  BatchDriver,
  Driver,
  FieldRef,
  TxDriver,
  Unsubscribe,
  WriteOptions,
} from "@/core/driver";
import type { DocumentIdRef } from "@/core/firestore";
import {
  type NumericField,
  type OrderField,
  QueryBuilder,
  type QuerySnapshotObserver,
  type WhereField,
  type WhereValue,
} from "@/core/query";
import type {
  ArrayElement,
  CollectionDef,
  Doc,
  InferOutput,
  MergeOptions,
  OrderByDirection,
  UpdateData,
  UpdatePaths,
  WhereFilterOp,
  WithFieldValue,
} from "@/core/types";

export class CollectionHandle<S extends StandardSchemaV1> {
  readonly #driver: Driver;
  readonly #def: CollectionDef<S>;
  readonly #segments: readonly string[];

  constructor(
    driver: Driver,
    def: CollectionDef<S>,
    segments: readonly string[],
  ) {
    this.#driver = driver;
    this.#def = def;
    this.#segments = segments;
  }

  doc(id: string): DocumentHandle<S> {
    return new DocumentHandle(this.#driver, this.#def, [...this.#segments, id]);
  }

  get(id: string): Promise<Doc<S> | null> {
    return this.doc(id).get();
  }

  set(id: string, data: WithFieldValue<InferOutput<S>>): Promise<void>;
  set(
    id: string,
    data: UpdateData<InferOutput<S>>,
    options: MergeOptions<InferOutput<S>>,
  ): Promise<void>;
  set(id: string, data: unknown, options?: WriteOptions): Promise<void> {
    return this.doc(id).set(data as never, options as never);
  }

  update(id: string, data: UpdatePaths<InferOutput<S>>): Promise<void> {
    return this.doc(id).update(data);
  }

  async add(data: WithFieldValue<InferOutput<S>>): Promise<string> {
    const native = toNativeData(data, this.#driver.native);

    return this.#driver.addDoc(this.#segments, native);
  }

  delete(id: string): Promise<void> {
    return this.doc(id).delete();
  }

  query(): QueryBuilder<S> {
    return new QueryBuilder({
      driver: this.#driver,
      def: this.#def,
      source: {
        kind: "collection",
        segments: this.#segments,
      },
    });
  }

  where<K extends WhereField<S>>(
    field: K,
    op: "in" | "not-in",
    value: ReadonlyArray<WhereValue<S, K>>,
  ): QueryBuilder<S>;
  where<K extends WhereField<S>>(
    field: K,
    op: "array-contains",
    value: ArrayElement<WhereValue<S, K>>,
  ): QueryBuilder<S>;
  where<K extends WhereField<S>>(
    field: K,
    op: "array-contains-any",
    value: ReadonlyArray<ArrayElement<WhereValue<S, K>>>,
  ): QueryBuilder<S>;
  where<K extends WhereField<S>>(
    field: K,
    op: "==" | "!=" | "<" | "<=" | ">" | ">=",
    value: WhereValue<S, K>,
  ): QueryBuilder<S>;
  // Document id queries, id values are plain strings
  where(
    field: DocumentIdRef,
    op: "in" | "not-in",
    value: readonly string[],
  ): QueryBuilder<S>;
  where(
    field: DocumentIdRef,
    op: "==" | "!=" | "<" | "<=" | ">" | ">=",
    value: string,
  ): QueryBuilder<S>;
  where(field: FieldRef, op: WhereFilterOp, value: unknown): QueryBuilder<S> {
    return this.query().where(field as never, op as never, value as never);
  }

  orderBy<F extends OrderField<S>>(
    field: F,
    direction?: OrderByDirection,
  ): QueryBuilder<S, [F]> {
    return this.query().orderBy(field, direction);
  }

  limit(limit: number): QueryBuilder<S> {
    return this.query().limit(limit);
  }

  count(): Promise<number> {
    return this.query().count();
  }

  sum(field: NumericField<S>): Promise<number> {
    return this.query().sum(field);
  }

  average(field: NumericField<S>): Promise<number | null> {
    return this.query().average(field);
  }

  onSnapshot(observer: QuerySnapshotObserver<S>): Unsubscribe {
    return this.query().onSnapshot(observer);
  }

  // Raw ref with the coercing converter attached
  get ref(): unknown {
    return this.#driver.collectionRef(
      this.#segments,
      makeConverter(this.#def, this.#driver.native),
    );
  }
}

export class TxCollectionHandle<S extends StandardSchemaV1> {
  readonly #tx: TxDriver;
  readonly #def: CollectionDef<S>;
  readonly #segments: readonly string[];

  constructor(
    tx: TxDriver,
    def: CollectionDef<S>,
    segments: readonly string[],
  ) {
    this.#tx = tx;
    this.#def = def;
    this.#segments = segments;
  }

  doc(id: string): TxDocumentHandle<S> {
    return new TxDocumentHandle(this.#tx, this.#def, [...this.#segments, id]);
  }

  get(id: string): Promise<Doc<S> | null> {
    return this.doc(id).get();
  }

  // Buffer writes synchronously so a forgotten await still enqueues pre-commit
  set(id: string, data: WithFieldValue<InferOutput<S>>): void;
  set(
    id: string,
    data: UpdateData<InferOutput<S>>,
    options: MergeOptions<InferOutput<S>>,
  ): void;
  set(id: string, data: unknown, options?: WriteOptions): void {
    this.doc(id).set(data as never, options as never);
  }

  update(id: string, data: UpdatePaths<InferOutput<S>>): void {
    this.doc(id).update(data);
  }

  delete(id: string): void {
    this.doc(id).delete();
  }
}

// Write-only, so it carries no def, there is no read to coerce
export class BatchCollectionHandle<S extends StandardSchemaV1> {
  readonly #batch: BatchDriver;
  readonly #segments: readonly string[];

  constructor(batch: BatchDriver, segments: readonly string[]) {
    this.#batch = batch;
    this.#segments = segments;
  }

  doc(id: string): BatchDocumentHandle<S> {
    return new BatchDocumentHandle<S>(this.#batch, [...this.#segments, id]);
  }

  // Buffer writes synchronously so a forgotten await still enqueues pre-commit
  set(id: string, data: WithFieldValue<InferOutput<S>>): void;
  set(
    id: string,
    data: UpdateData<InferOutput<S>>,
    options: MergeOptions<InferOutput<S>>,
  ): void;
  set(id: string, data: unknown, options?: WriteOptions): void {
    this.doc(id).set(data as never, options as never);
  }

  update(id: string, data: UpdatePaths<InferOutput<S>>): void {
    this.doc(id).update(data);
  }

  delete(id: string): void {
    this.doc(id).delete();
  }
}

export type DocSnapshotObserver<S extends StandardSchemaV1> =
  | ((doc: Doc<S> | null) => void)
  | {
      next: (doc: Doc<S> | null) => void;
      error?: (error: unknown) => void;
    };

export class DocumentHandle<S extends StandardSchemaV1> {
  readonly #driver: Driver;
  readonly #def: CollectionDef<S>;
  readonly #segments: readonly string[];

  constructor(
    driver: Driver,
    def: CollectionDef<S>,
    segments: readonly string[],
  ) {
    this.#driver = driver;
    this.#def = def;
    this.#segments = segments;
  }

  get id(): string {
    return this.#segments[this.#segments.length - 1]!;
  }

  collection<C extends StandardSchemaV1>(
    def: CollectionDef<C>,
  ): CollectionHandle<C> {
    return new CollectionHandle(this.#driver, def, [
      ...this.#segments,
      def.name,
    ]);
  }

  async get(): Promise<Doc<S> | null> {
    const snapshot = await this.#driver.getDoc(this.#segments);

    return snapshot && readSnapshot(this.#def, snapshot);
  }

  async exists(): Promise<boolean> {
    const snapshot = await this.#driver.getDoc(this.#segments);

    return snapshot !== null;
  }

  set(data: WithFieldValue<InferOutput<S>>): Promise<void>;
  set(
    data: UpdateData<InferOutput<S>>,
    options: MergeOptions<InferOutput<S>>,
  ): Promise<void>;
  async set(data: unknown, options?: WriteOptions): Promise<void> {
    const native = toNativeData(data, this.#driver.native);
    await this.#driver.setDoc(this.#segments, native, options);
  }

  async update(data: UpdatePaths<InferOutput<S>>): Promise<void> {
    const native = toNativeData(data, this.#driver.native);
    await this.#driver.updateDoc(this.#segments, native);
  }

  delete(): Promise<void> {
    return this.#driver.deleteDoc(this.#segments);
  }

  onSnapshot(observer: DocSnapshotObserver<S>): Unsubscribe {
    const next =
      typeof observer === "function" ? observer : observer.next.bind(observer);
    const onError =
      typeof observer === "function"
        ? undefined
        : observer.error?.bind(observer);

    return this.#driver.onSnapshotDoc(this.#segments, {
      next: (snapshot) => next(snapshot && readSnapshot(this.#def, snapshot)),
      ...(onError && { error: onError }),
    });
  }

  // Raw ref with the coercing converter attached
  get ref(): unknown {
    return this.#driver.docRef(
      this.#segments,
      makeConverter(this.#def, this.#driver.native),
    );
  }
}

export class TxDocumentHandle<S extends StandardSchemaV1> {
  readonly #tx: TxDriver;
  readonly #def: CollectionDef<S>;
  readonly #segments: readonly string[];

  constructor(
    tx: TxDriver,
    def: CollectionDef<S>,
    segments: readonly string[],
  ) {
    this.#tx = tx;
    this.#def = def;
    this.#segments = segments;
  }

  get id(): string {
    return this.#segments[this.#segments.length - 1]!;
  }

  collection<C extends StandardSchemaV1>(
    def: CollectionDef<C>,
  ): TxCollectionHandle<C> {
    return new TxCollectionHandle(this.#tx, def, [...this.#segments, def.name]);
  }

  async get(): Promise<Doc<S> | null> {
    const snapshot = await this.#tx.get(this.#segments);

    return snapshot && readSnapshot(this.#def, snapshot);
  }

  // Buffer writes synchronously so a forgotten await still enqueues pre-commit
  set(data: WithFieldValue<InferOutput<S>>): void;
  set(
    data: UpdateData<InferOutput<S>>,
    options: MergeOptions<InferOutput<S>>,
  ): void;
  set(data: unknown, options?: WriteOptions): void {
    const native = toNativeData(data, this.#tx.native);
    this.#tx.set(this.#segments, native, options);
  }

  update(data: UpdatePaths<InferOutput<S>>): void {
    const native = toNativeData(data, this.#tx.native);
    this.#tx.update(this.#segments, native);
  }

  delete(): void {
    this.#tx.delete(this.#segments);
  }
}

// Write-only, so it carries no def, there is no read to coerce
export class BatchDocumentHandle<S extends StandardSchemaV1> {
  readonly #batch: BatchDriver;
  readonly #segments: readonly string[];

  constructor(batch: BatchDriver, segments: readonly string[]) {
    this.#batch = batch;
    this.#segments = segments;
  }

  get id(): string {
    return this.#segments[this.#segments.length - 1]!;
  }

  collection<C extends StandardSchemaV1>(
    def: CollectionDef<C>,
  ): BatchCollectionHandle<C> {
    return new BatchCollectionHandle<C>(this.#batch, [
      ...this.#segments,
      def.name,
    ]);
  }

  // Buffer writes synchronously so a forgotten await still enqueues pre-commit
  set(data: WithFieldValue<InferOutput<S>>): void;
  set(
    data: UpdateData<InferOutput<S>>,
    options: MergeOptions<InferOutput<S>>,
  ): void;
  set(data: unknown, options?: WriteOptions): void {
    const native = toNativeData(data, this.#batch.native);
    this.#batch.set(this.#segments, native, options);
  }

  update(data: UpdatePaths<InferOutput<S>>): void {
    const native = toNativeData(data, this.#batch.native);
    this.#batch.update(this.#segments, native);
  }

  delete(): void {
    this.#batch.delete(this.#segments);
  }
}
