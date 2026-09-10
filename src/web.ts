import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  CollectionReference,
  DocumentReference,
  Firestore,
  Query,
} from "firebase/firestore";

import { Database } from "@/core/database";
import type { CollectionHandle, DocumentHandle } from "@/core/handles";
import type { QueryBuilder } from "@/core/query";
import type { InferOutput } from "@/core/types";
import { WebDriver } from "@/drivers/web";

export function createDatabase(firestore: Firestore): Database {
  return new Database(new WebDriver(firestore));
}

// Typed escape hatches, cast the neutral unknown .ref to the web SDK ref
export function docRef<S extends StandardSchemaV1>(
  handle: DocumentHandle<S>,
): DocumentReference<InferOutput<S>> {
  return handle.ref as DocumentReference<InferOutput<S>>;
}

export function collectionRef<S extends StandardSchemaV1>(
  handle: CollectionHandle<S>,
): CollectionReference<InferOutput<S>> {
  return handle.ref as CollectionReference<InferOutput<S>>;
}

export function queryRef<S extends StandardSchemaV1>(
  builder: QueryBuilder<S>,
): Query<InferOutput<S>> {
  return builder.ref as Query<InferOutput<S>>;
}

export * from "@/index";
