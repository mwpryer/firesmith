import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  BatchDriver,
  Driver,
  TransactionOptions,
  TxDriver,
} from "@/core/driver";
import {
  BatchCollectionHandle,
  CollectionHandle,
  TxCollectionHandle,
} from "@/core/handles";
import { QueryBuilder } from "@/core/query";
import type { CollectionDef } from "@/core/types";

export class Transaction {
  readonly #tx: TxDriver;
  readonly #driver: Driver;

  constructor(tx: TxDriver, driver: Driver) {
    this.#tx = tx;
    this.#driver = driver;
  }

  // Raw SDK transaction
  get ref(): unknown {
    return this.#tx.ref;
  }

  collection<S extends StandardSchemaV1>(
    def: CollectionDef<S>,
  ): TxCollectionHandle<S> {
    return new TxCollectionHandle(this.#tx, this.#driver, def, [def.name]);
  }
}

export class Batch {
  readonly #batch: BatchDriver;
  readonly #driver: Driver;

  constructor(batch: BatchDriver, driver: Driver) {
    this.#batch = batch;
    this.#driver = driver;
  }

  collection<S extends StandardSchemaV1>(
    def: CollectionDef<S>,
  ): BatchCollectionHandle<S> {
    return new BatchCollectionHandle<S>(this.#batch, this.#driver, [def.name]);
  }

  commit(): Promise<void> {
    return this.#batch.commit();
  }
}

export class Database {
  readonly #driver: Driver;

  constructor(driver: Driver) {
    this.#driver = driver;
  }

  collection<S extends StandardSchemaV1>(
    def: CollectionDef<S>,
  ): CollectionHandle<S> {
    return new CollectionHandle(this.#driver, def, [def.name]);
  }

  // Cross-parent query over every collection sharing this id
  collectionGroup<S extends StandardSchemaV1>(
    def: CollectionDef<S>,
  ): QueryBuilder<S> {
    return new QueryBuilder({
      driver: this.#driver,
      def,
      source: { kind: "collectionGroup", collectionId: def.name },
    });
  }

  runTransaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return this.#driver.runTransaction(
      (tx) => fn(new Transaction(tx, this.#driver)),
      options,
    );
  }

  batch(): Batch {
    return new Batch(this.#driver.batch(), this.#driver);
  }
}
