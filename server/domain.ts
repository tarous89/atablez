import { z } from "zod";
import { randomUUID } from "node:crypto";
export const Field = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  instruction: z.string().max(2000).default(""),
  type: z.enum([
    "string",
    "text",
    "integer",
    "number",
    "date",
    "boolean",
    "select",
    "url",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string().max(100)).max(100).default([]),
  fixed: z.boolean().default(false),
  fixedValue: z.any().optional(),
});
export const Fields = z
  .array(Field)
  .min(1)
  .max(50)
  .refine(
    (v) => new Set(v.map((f) => f.id)).size === v.length,
    "Column IDs must be unique",
  );
export type Column = z.infer<typeof Field>;
export type Table = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  fields: Column[];
  rows: { id: string; values: Record<string, any> }[];
  updatedAt: number;
};
export type State = {
  tables: Table[];
  history: { id: string; label: string; tables: Table[]; at: number }[];
  requests: Record<string, any>;
};
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function valuesFor(
  fields: Column[],
  input: Record<string, any>,
  previous: Record<string, any> = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Problem(400, "Values must be an object");
  for (const key of Object.keys(input))
    if (!fields.some((f) => f.id === key))
      throw new Problem(400, `Unknown column: ${key}`);
  const result: Record<string, any> = {};
  for (const f of fields) {
    let value = Object.hasOwn(input, f.id)
      ? input[f.id]
      : (previous[f.id] ?? null);
    if (f.fixed) {
      if (
        Object.hasOwn(input, f.id) &&
        JSON.stringify(input[f.id]) !== JSON.stringify(f.fixedValue ?? null)
      )
        throw new Problem(
          400,
          `${f.name} is fixed. Edit the structure to change it.`,
        );
      value = f.fixedValue ?? null;
    }
    if (value === null || value === "") {
      result[f.id] = null;
      continue;
    }
    const fail = () => {
      throw new Problem(400, `${f.name}: enter a valid ${f.type}`);
    };
    if (["string", "text", "url", "date", "select"].includes(f.type)) {
      if (typeof value !== "string" || value.length > 10000) fail();
    }
    if (f.type === "integer" && !Number.isSafeInteger(value)) fail();
    if (
      f.type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      fail();
    if (f.type === "boolean" && typeof value !== "boolean") fail();
    if (f.type === "select" && !f.options.includes(value)) fail();
    if (f.type === "url") {
      try {
        if (!["https:", "http:"].includes(new URL(value).protocol)) fail();
      } catch {
        fail();
      }
    }
    if (
      f.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      fail();
    result[f.id] = value;
  }
  return result;
}
const name = z.string().trim().min(1).max(120);
export function apply(state: State, op: any, guest: boolean) {
  const data = structuredClone(state);
  const now = Date.now();
  const before = structuredClone(data.tables);
  const table = data.tables.find((t) => t.id === op.tableId);
  let result: any = {};
  if (op.action === "create") {
    if (data.tables.length >= (guest ? 3 : 20))
      throw new Problem(400, "Table limit reached");
    const fields = Fields.parse(op.fields);
    fields.forEach((f) => valuesFor([f], {}));
    const rows = z
      .array(z.record(z.string(), z.any()))
      .max(guest ? 100 : 2000)
      .parse(op.rows ?? [])
      .map((values) => ({
        id: randomUUID(),
        values: valuesFor(fields, values),
      }));
    const t: Table = {
      id: randomUUID(),
      name: name.parse(op.name || `${fields[0].name} table`),
      description: z
        .string()
        .max(2000)
        .parse(op.description ?? ""),
      instructions: z
        .string()
        .max(5000)
        .parse(op.instructions ?? ""),
      fields,
      rows,
      updatedAt: now,
    };
    data.tables.push(t);
    result = { tableId: t.id };
  } else if (op.action === "undo") {
    const last = data.history.pop();
    if (!last) throw new Problem(400, "Nothing to undo");
    data.tables = last.tables;
    return { data, result: {} };
  } else {
    if (!table) throw new Problem(404, "Table not found");
    if (op.action === "metadata") {
      if (op.name !== undefined) table.name = name.parse(op.name);
      if (op.description !== undefined)
        table.description = z.string().max(2000).parse(op.description);
      if (op.instructions !== undefined)
        table.instructions = z.string().max(5000).parse(op.instructions);
    } else if (op.action === "structure") {
      const fields = Fields.parse(op.fields);
      const removed = table.fields.filter(
        (f) => !fields.some((n) => n.id === f.id),
      );
      if (removed.length && table.rows.length && !op.confirmRemoval)
        throw new Problem(
          409,
          "Removing columns affects existing entries. Confirm after reviewing the columns.",
        );
      const changedFixed = fields.filter(
        (f) =>
          f.fixed &&
          table.rows.some(
            (r) =>
              JSON.stringify(r.values[f.id] ?? null) !==
              JSON.stringify(f.fixedValue ?? null),
          ),
      );
      if (changedFixed.length && !op.confirmRemoval)
        throw new Problem(
          409,
          "Fixed values will replace existing values. Confirm after reviewing.",
        );
      table.rows = table.rows.map((r) => {
        const retained = Object.fromEntries(
          fields
            .filter((f) => Object.hasOwn(r.values, f.id) && !f.fixed)
            .map((f) => [f.id, r.values[f.id]]),
        );
        return { ...r, values: valuesFor(fields, retained) };
      });
      table.fields = fields;
      if (op.instructions !== undefined)
        table.instructions = z.string().max(5000).parse(op.instructions);
    } else if (op.action === "add") {
      const rows = z
        .array(z.record(z.string(), z.any()))
        .min(1)
        .max(100)
        .parse(op.rows)
        .map((values) => ({
          id: randomUUID(),
          values: valuesFor(table.fields, values),
        }));
      table.rows.push(...rows);
      result = { rowIds: rows.map((r) => r.id) };
    } else if (op.action === "patch") {
      const row = table.rows.find((r) => r.id === op.rowId);
      if (!row) throw new Problem(404, "Entry not found");
      row.values = valuesFor(table.fields, op.values, row.values);
    } else if (op.action === "deleteRow") {
      if (!table.rows.some((r) => r.id === op.rowId))
        throw new Problem(404, "Entry not found");
      table.rows = table.rows.filter((r) => r.id !== op.rowId);
    } else if (op.action === "deleteTable") {
      data.tables = data.tables.filter((t) => t.id !== table.id);
    } else throw new Problem(400, "Unknown action");
    table.updatedAt = now;
  }
  if (data.tables.reduce((n, t) => n + t.rows.length, 0) > (guest ? 100 : 2000))
    throw new Problem(400, "Entry limit reached");
  data.history.push({
    id: randomUUID(),
    label: op.action,
    at: now,
    tables: before,
  });
  data.history = data.history.slice(-10);
  if (JSON.stringify(data).length > 5_000_000)
    throw new Problem(400, "Workspace storage limit reached");
  return { data, result };
}
export function publicState(row: any) {
  return {
    id: row.id,
    revision: row.revision,
    expiresAt: row.expires_at ? Number(row.expires_at) : null,
    tables: row.data.tables,
    canUndo: row.data.history.length > 0,
  };
}
