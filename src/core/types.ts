import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  ArrayRemoveSentinel,
  ArrayUnionSentinel,
  DeleteFieldSentinel,
  DocumentReference,
  GeoPoint,
  IncrementSentinel,
  ServerTimestampSentinel,
  Timestamp,
  VectorValue,
} from "@/core/firestore";

export interface CollectionDef<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly name: string;
  readonly schema: S;
  // Field paths to return as the raw SDK value instead of coerced
  readonly raw?: readonly string[];
}

export type InferOutput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;

export type Doc<S extends StandardSchemaV1> = InferOutput<S> & { id: string };

type Primitive =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date;

// Atomic Firestore types, the write and path machinery never recurses into them
type NeutralValue =
  | Timestamp
  | GeoPoint
  | DocumentReference
  | VectorValue
  | Uint8Array;

// Full-document write shape, Firestore bans sentinels inside arrays
export type WithFieldValue<T> = T extends Primitive | NeutralValue
  ? T
  : T extends ReadonlyArray<infer E>
    ? Array<E>
    : T extends object
      ? {
          [K in keyof T]: WithFieldValue<T[K]> | SentinelFor<NonNullable<T[K]>>;
        }
      : T;

// Sentinels valid on a field of type V so a wrong one is a compile error
export type SentinelFor<V> =
  | (V extends number ? IncrementSentinel : never)
  | (V extends ReadonlyArray<infer E>
      ? ArrayUnionSentinel<E> | ArrayRemoveSentinel<E>
      : never)
  // serverTimestamp() writes a Timestamp, so allow on Date/Timestamp fields
  | (V extends Date | Timestamp ? ServerTimestampSentinel : never);

// Map values nest sentinels, clear a field with deleteField() not undefined
export type UpdateValue<V> =
  | Exclude<WithFieldValue<V>, undefined>
  | SentinelFor<NonNullable<V>>
  | (undefined extends V ? DeleteFieldSentinel : never);

// Merge maps recursively, array elements and atomic values stay complete
export type UpdateData<T> = T extends FieldPathLeaf
  ? WithFieldValue<T>
  : {
      [K in keyof T]?:
        | Exclude<UpdateData<T[K]>, undefined>
        | SentinelFor<NonNullable<T[K]>>
        | (undefined extends T[K] ? DeleteFieldSentinel : never);
    };

// Merge union of objects into one intersection
type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

// Prefix key with parent segment, re-apply ? since remapping drops modifier
type PrefixPaths<P extends string, T> = {
  [K in keyof T & string as `${P}.${K}`]?: T[K];
};

// Dotted nested-map paths, sentinel-aware like UpdateValue, non-maps give {}
type NestedUpdatePaths<T> = UnionToIntersection<
  {
    [K in keyof T & string]: NonNullable<T[K]> extends FieldPathLeaf
      ? {}
      : NonNullable<T[K]> extends object
        ? PrefixPaths<K, UpdatePaths<NonNullable<T[K]>>>
        : {};
  }[keyof T & string]
>;

// update() write shape, immediate fields plus dotted-path keys, paths only here
export type UpdatePaths<T> = {
  [K in keyof T]?: UpdateValue<T[K]>;
} & NestedUpdatePaths<T>;

// Merge set options, two exclusive modes mirroring Firestore SetOptions
export type MergeOptions<T> =
  | { merge: true }
  | { mergeFields: Array<FieldPath<T>> };

export type WhereFilterOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "array-contains"
  | "in"
  | "not-in"
  | "array-contains-any";

export type OrderByDirection = "asc" | "desc";

export type ArrayElement<T> = T extends ReadonlyArray<infer E> ? E : never;

// Leaves where field path stops, arrays and neutral values query as a whole
type FieldPathLeaf = Primitive | NeutralValue | ReadonlyArray<unknown>;

// Dotted paths into nested maps so where() targets a field by value type
export type FieldPath<T> = T extends object
  ? {
      [K in keyof T & string]:
        | K
        | (NonNullable<T[K]> extends FieldPathLeaf
            ? never
            : `${K}.${FieldPath<NonNullable<T[K]>>}`);
    }[keyof T & string]
  : never;

// FieldPath narrowed to paths whose leaf value is a number, for sum()/average()
export type NumericFieldPath<T> = {
  [P in FieldPath<T>]: NonNullable<ValueAtPath<T, P>> extends number
    ? P
    : never;
}[FieldPath<T>];

// Resolve the value type at a dotted path produced by FieldPath
export type ValueAtPath<
  T,
  P extends string,
> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAtPath<NonNullable<T[Head]>, Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;
