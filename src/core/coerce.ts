import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  DocumentData,
  NativeAdapter,
  RawConverter,
  RawSnapshot,
} from "@/core/driver";
import { isSentinel, isTimestampLike } from "@/core/firestore";
import type { CollectionDef, Doc } from "@/core/types";

// Exact stored timestamp behind each Date read, a Date holds only milliseconds
const readTimestamps = new WeakMap<
  Date,
  { time: number; seconds: number; nanoseconds: number }
>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Web SDK Bytes, duck-typed so core imports no SDK (admin bytes are a Uint8Array)
function isBytesLike(value: unknown): value is { toUint8Array(): Uint8Array } {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.toUint8Array === "function" &&
    typeof candidate.toBase64 === "function"
  );
}

// Read path, Firestore storage values to neutral domain values
function toNeutral(
  value: unknown,
  rawPaths?: ReadonlySet<string>,
  path = "",
): unknown {
  // Primitives never coerce, skip object guards on scalar fields
  if (value === null || typeof value !== "object") {
    return value;
  }
  // Listed path stays the raw SDK value, whole subtree, no recursion
  if (rawPaths?.has(path)) {
    return value;
  }
  if (isTimestampLike(value)) {
    const date = value.toDate();
    readTimestamps.set(date, {
      time: date.getTime(),
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    });

    return date;
  }
  // Admin bytes are a Buffer, normalise to a plain Uint8Array so neither leaks
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (isBytesLike(value)) {
    return value.toUint8Array();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toNeutral(item, rawPaths, path));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      const childPath = rawPaths ? (path ? `${path}.${key}` : key) : "";
      out[key] = toNeutral(value[key], rawPaths, childPath);
    }
    return out;
  }
  return value;
}

// Write path, neutral domain values to Firestore storage values
export function toNative(value: unknown, native: NativeAdapter): unknown {
  // Primitives never coerce, skip object guards on scalar fields
  if (value === null || typeof value !== "object") {
    return value;
  }
  // Rebuilt so either SDK's Timestamp writes through this driver
  if (isTimestampLike(value)) {
    return native.timestamp(value.seconds, value.nanoseconds);
  }
  if (value instanceof Date) {
    const read = readTimestamps.get(value);
    // A date mutated since read no longer matches its stored timestamp
    if (read?.time === value.getTime()) {
      return native.timestamp(read.seconds, read.nanoseconds);
    }

    return native.timestampFromDate(value);
  }
  if (isSentinel(value)) {
    return native.fieldValue(value);
  }
  // Buffer is a Uint8Array, web needs its Bytes class, admin takes it as-is
  if (value instanceof Uint8Array) {
    return native.bytesFromUint8Array(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => toNative(v, native));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      out[key] = toNative(value[key], native);
    }
    return out;
  }
  return value;
}

export function toNeutralData(
  data: DocumentData,
  raw?: readonly string[],
): DocumentData {
  const rawPaths = raw && raw.length > 0 ? new Set(raw) : undefined;
  return toNeutral(data, rawPaths) as DocumentData;
}

export function toNativeData(
  data: unknown,
  native: NativeAdapter,
): DocumentData {
  // Location metadata is read-only, never stored
  const {
    id: _,
    meta: _meta,
    ...fields
  } = toNative(data, native) as DocumentData;

  return fields;
}

// Location metadata overrides stored id and meta fields
export function readSnapshot<S extends StandardSchemaV1>(
  def: CollectionDef<S>,
  snapshot: RawSnapshot,
): Doc<S> | null {
  if (!snapshot.exists || snapshot.data === undefined) {
    return null;
  }
  const coerced = toNeutralData(snapshot.data, def.raw);

  return {
    ...(coerced as object),
    id: snapshot.id,
    meta: { path: snapshot.path },
  } as Doc<S>;
}

// Converter for .ref, coerces both ways so the SDK round-trips timestamps
export function makeConverter<S extends StandardSchemaV1>(
  def: CollectionDef<S>,
  native: NativeAdapter,
): RawConverter {
  return {
    toNative(data: DocumentData): DocumentData {
      return toNativeData(data, native);
    },
    fromNative(id: string, path: string, data: DocumentData): unknown {
      const coerced = toNeutralData(data, def.raw);

      return {
        ...(coerced as object),
        id,
        meta: { path },
      };
    },
  };
}
