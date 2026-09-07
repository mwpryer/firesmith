export { collection } from "@/core/schema";
export type { CollectionOptions } from "@/core/schema";
export {
  arrayRemove,
  arrayUnion,
  deleteField,
  documentId,
  increment,
  isTimestampLike,
  serverTimestamp,
} from "@/core/firestore";
export type {
  ArrayRemoveSentinel,
  ArrayUnionSentinel,
  DeleteFieldSentinel,
  DocumentIdRef,
  DocumentReference,
  GeoPoint,
  IncrementSentinel,
  ServerTimestampSentinel,
  Timestamp,
  VectorValue,
} from "@/core/firestore";
export { FiresmithError } from "@/core/errors";

export { Batch, Database, Transaction } from "@/core/database";
export type { TransactionOptions, Unsubscribe } from "@/core/driver";
export {
  BatchCollectionHandle,
  BatchDocumentHandle,
  CollectionHandle,
  DocumentHandle,
  TxCollectionHandle,
  TxDocumentHandle,
} from "@/core/handles";
export type { DocSnapshotObserver } from "@/core/handles";
export { QueryBuilder } from "@/core/query";
export type {
  NumericField,
  QuerySnapshotObserver,
  WhereField,
  WhereValue,
} from "@/core/query";

export type {
  ArrayElement,
  CollectionDef,
  Doc,
  DocMeta,
  FieldPath,
  InferOutput,
  MergeOptions,
  NumericFieldPath,
  OrderByDirection,
  SentinelFor,
  UpdateData,
  UpdatePaths,
  UpdateValue,
  ValueAtPath,
  WhereFilterOp,
  WithFieldValue,
} from "@/core/types";
