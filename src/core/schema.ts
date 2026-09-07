import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { CollectionDef, InferOutput } from "@/core/types";

export interface CollectionOptions {
  raw?: readonly string[];
}

export function collection<S extends StandardSchemaV1>(
  name: string,
  // Check every union member, keyof alone only includes shared fields
  schema: S &
    (Extract<
      "id" | "meta",
      InferOutput<S> extends infer T
        ? T extends unknown
          ? keyof T
          : never
        : never
    > extends never
      ? unknown
      : never),
  options?: CollectionOptions,
): CollectionDef<S> {
  if (options?.raw && options.raw.length > 0) {
    return { name, schema, raw: options.raw };
  }
  return { name, schema };
}
