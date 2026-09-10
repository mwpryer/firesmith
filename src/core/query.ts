import type { StandardSchemaV1 } from "@standard-schema/spec";

import { makeConverter, readSnapshot } from "@/core/coerce";
import type {
  Constraint,
  Driver,
  FieldRef,
  QuerySource,
  RawSnapshot,
  Unsubscribe,
} from "@/core/driver";
import type { DocumentIdRef } from "@/core/firestore";
import type {
  ArrayElement,
  CollectionDef,
  Doc,
  FieldPath,
  InferOutput,
  NumericFieldPath,
  OrderByDirection,
  ValueAtPath,
  WhereFilterOp,
} from "@/core/types";

interface QueryContext<S extends StandardSchemaV1> {
  driver: Driver;
  def: CollectionDef<S>;
  source: QuerySource;
}

// where() and orderBy() field typing, dotted paths reach into nested maps
export type WhereField<S extends StandardSchemaV1> = FieldPath<InferOutput<S>>;
// Exclude undefined only, null is queryable
export type WhereValue<
  S extends StandardSchemaV1,
  K extends WhereField<S>,
> = Exclude<ValueAtPath<InferOutput<S>, K>, undefined>;

// sum() and average() field typing, numeric dotted paths only
export type NumericField<S extends StandardSchemaV1> = NumericFieldPath<
  InferOutput<S>
>;

export type QuerySnapshotObserver<S extends StandardSchemaV1> =
  | ((docs: Array<Doc<S>>) => void)
  | {
      next: (docs: Array<Doc<S>>) => void;
      error?: (error: unknown) => void;
    };

export class QueryBuilder<S extends StandardSchemaV1> {
  readonly #ctx: QueryContext<S>;
  readonly #constraints: readonly Constraint[];

  constructor(ctx: QueryContext<S>, constraints: readonly Constraint[] = []) {
    this.#ctx = ctx;
    this.#constraints = constraints;
  }

  #append(constraint: Constraint): QueryBuilder<S> {
    return new QueryBuilder(this.#ctx, [...this.#constraints, constraint]);
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
    return this.#append({ type: "where", field, op, value });
  }

  orderBy(field: WhereField<S>, direction?: OrderByDirection): QueryBuilder<S>;
  orderBy(field: DocumentIdRef, direction?: OrderByDirection): QueryBuilder<S>;
  orderBy(
    field: FieldRef,
    direction: OrderByDirection = "asc",
  ): QueryBuilder<S> {
    return this.#append({ type: "orderBy", field, direction });
  }

  limit(limit: number): QueryBuilder<S> {
    return this.#append({ type: "limit", limit });
  }

  startAt(...values: unknown[]): QueryBuilder<S> {
    return this.#append({ type: "startAt", values });
  }

  startAfter(...values: unknown[]): QueryBuilder<S> {
    return this.#append({ type: "startAfter", values });
  }

  endAt(...values: unknown[]): QueryBuilder<S> {
    return this.#append({ type: "endAt", values });
  }

  endBefore(...values: unknown[]): QueryBuilder<S> {
    return this.#append({ type: "endBefore", values });
  }

  async get(): Promise<Array<Doc<S>>> {
    const snapshots = await this.#ctx.driver.runQuery(
      this.#ctx.source,
      this.#constraints,
    );
    return this.#toDocs(snapshots);
  }

  list(): Promise<Array<Doc<S>>> {
    return this.get();
  }

  count(): Promise<number> {
    return this.#ctx.driver.count(this.#ctx.source, this.#constraints);
  }

  sum(field: NumericField<S>): Promise<number> {
    return this.#ctx.driver.sum(this.#ctx.source, this.#constraints, field);
  }

  average(field: NumericField<S>): Promise<number | null> {
    return this.#ctx.driver.average(this.#ctx.source, this.#constraints, field);
  }

  onSnapshot(observer: QuerySnapshotObserver<S>): Unsubscribe {
    const next =
      typeof observer === "function" ? observer : observer.next.bind(observer);
    const onError =
      typeof observer === "function"
        ? undefined
        : observer.error?.bind(observer);
    return this.#ctx.driver.onSnapshotQuery(
      this.#ctx.source,
      this.#constraints,
      {
        next: (snapshots) => next(this.#toDocs(snapshots)),
        ...(onError && { error: onError }),
      },
    );
  }

  #toDocs(snapshots: readonly RawSnapshot[]): Array<Doc<S>> {
    const docs: Array<Doc<S>> = [];
    for (const snapshot of snapshots) {
      const result = readSnapshot(this.#ctx.def, snapshot);
      if (result !== null) {
        docs.push(result);
      }
    }
    return docs;
  }

  // Raw query with the coercing converter attached
  get ref(): unknown {
    return this.#ctx.driver.queryRef(
      this.#ctx.source,
      this.#constraints,
      makeConverter(this.#ctx.def, this.#ctx.driver.native),
    );
  }
}
