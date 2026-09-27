// Minimal in-memory stand-in for the parts of the Supabase query builder the
// pipeline uses. Lets the whole map-reduce pipeline run in unit tests.
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rows(t: string) {
    return (this.tables[t] ??= []);
  }
  from(table: string) {
    return new Query(this, table);
  }
}

class Query implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private conflict: string[] = [];
  private wantsRows = false;
  private mode: "many" | "single" | "maybe" = "many";
  private head = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.head = !!opts?.head;
    else this.wantsRows = true;
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  upsert(p: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = p;
    this.conflict = (opts?.onConflict ?? "id").split(",");
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  gt(col: string, v: number) {
    this.filters.push((r) => (r[col] as number) > v);
    return this;
  }
  gte(col: string, v: number) {
    this.filters.push((r) => (r[col] as number) >= v);
    return this;
  }
  lte(col: string, v: number) {
    this.filters.push((r) => (r[col] as number) <= v);
    return this;
  }
  or(expr: string) {
    // Only the lock expression is needed: "col.is.null,col.lt.<iso>"
    const [a, b] = expr.split(",");
    const col = a.split(".")[0];
    const iso = b.split(".lt.")[1];
    this.filters.push((r) => r[col] == null || String(r[col]) < iso);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private match() {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): { data: unknown; error: null; count?: number } {
    const table = this.db.rows(this.table);
    let out: Row[] = [];
    switch (this.op) {
      case "select":
        out = this.match().map((r) => ({ ...r }));
        if (this.head) return { data: null, error: null, count: out.length };
        break;
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        out = list.map((r) => ({ id: randomUUID(), ...structuredClone(r) }));
        table.push(...out);
        if (!this.wantsRows && this.mode === "many") return { data: null, error: null };
        break;
      }
      case "update":
        out = this.match();
        for (const r of out) Object.assign(r, structuredClone(this.payload));
        break;
      case "upsert": {
        const p = this.payload as Row;
        const existing = table.find((r) => this.conflict.every((c) => r[c] === p[c]));
        if (existing) {
          Object.assign(existing, structuredClone(p));
          out = [existing];
        } else {
          const row = { id: randomUUID(), ...structuredClone(p) };
          table.push(row);
          out = [row];
        }
        break;
      }
      case "delete": {
        const doomed = new Set(this.match());
        this.db.tables[this.table] = table.filter((r) => !doomed.has(r));
        return { data: null, error: null };
      }
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => ((a[col] as number) > (b[col] as number) ? 1 : -1) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    if (this.mode === "single") {
      if (out.length !== 1) throw new Error(`single() on ${this.table} matched ${out.length} rows`);
      return { data: { ...out[0] }, error: null };
    }
    if (this.mode === "maybe") return { data: out[0] ? { ...out[0] } : null, error: null };
    return { data: out.map((r) => ({ ...r })), error: null };
  }

  then<T1 = { data: unknown; error: null; count?: number }, T2 = never>(
    ok?: ((v: { data: unknown; error: null; count?: number }) => T1 | PromiseLike<T1>) | null,
    fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }
}
