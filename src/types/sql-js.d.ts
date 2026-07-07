declare module "sql.js" {
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
  }

  export interface QueryResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Statement {
    bind(values?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface Database {
    exec(sql: string): QueryResult[];
    run(sql: string, params?: unknown[]): Database;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
