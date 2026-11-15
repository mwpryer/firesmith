export interface Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
  isEqual(other: Timestamp): boolean;
}

// Duck-types both SDK Timestamps by shape so one schema can validate either
export function isTimestampLike(value: unknown): value is Timestamp {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.seconds === "number" &&
    typeof candidate.nanoseconds === "number" &&
    typeof candidate.toDate === "function"
  );
}

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
  isEqual(other: GeoPoint): boolean;
}

// Doc reference by id and path, no isEqual since web SDK uses refEqual()
export interface DocumentReference {
  readonly id: string;
  readonly path: string;
}

export interface VectorValue {
  toArray(): number[];
  isEqual(other: VectorValue): boolean;
}

// Neutral write sentinels since a schema cannot reference an SDK FieldValue
export abstract class Sentinel {
  abstract readonly kind: string;
}

export class ServerTimestampSentinel extends Sentinel {
  readonly kind = "serverTimestamp";
}

export class IncrementSentinel extends Sentinel {
  readonly kind = "increment";
  constructor(readonly by: number) {
    super();
  }
}

export class ArrayUnionSentinel<E = unknown> extends Sentinel {
  readonly kind = "arrayUnion";
  constructor(readonly values: ReadonlyArray<E>) {
    super();
  }
}

export class ArrayRemoveSentinel<E = unknown> extends Sentinel {
  readonly kind = "arrayRemove";
  constructor(readonly values: ReadonlyArray<E>) {
    super();
  }
}

export class DeleteFieldSentinel extends Sentinel {
  readonly kind = "deleteField";
}

export function serverTimestamp(): ServerTimestampSentinel {
  return new ServerTimestampSentinel();
}

export function increment(by: number): IncrementSentinel {
  return new IncrementSentinel(by);
}

export function arrayUnion<E>(...values: Array<E>): ArrayUnionSentinel<E> {
  return new ArrayUnionSentinel(values);
}

export function arrayRemove<E>(...values: Array<E>): ArrayRemoveSentinel<E> {
  return new ArrayRemoveSentinel(values);
}

export function deleteField(): DeleteFieldSentinel {
  return new DeleteFieldSentinel();
}

export function isSentinel(value: unknown): value is Sentinel {
  return value instanceof Sentinel;
}

// Neutral doc-id reference for where()/orderBy(), off the schema field surface
export class DocumentIdRef {
  readonly kind = "documentId";
}

const DOCUMENT_ID = new DocumentIdRef();

// Reference doc id in where()/orderBy(), though id is otherwise off the field surface
export function documentId(): DocumentIdRef {
  return DOCUMENT_ID;
}
