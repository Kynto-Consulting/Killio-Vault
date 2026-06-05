// Minimal ambient types for @op-engineering/op-sqlite — its shipped types don't
// resolve under this project's moduleResolution. We only use open() + execute().
declare module '@op-engineering/op-sqlite' {
  export interface DB {
    execute(sql: string, params?: any[]): { rows?: any };
    close?(): void;
  }
  export function open(options: { name: string; location?: string }): DB;
}
