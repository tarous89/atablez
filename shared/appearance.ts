import { z } from "zod";

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");
export const Appearance = z
  .object({
    prompt: z.string().max(3000).optional(),
    accent: color.optional(),
    headerColor: color.optional(),
    rowHeight: z.number().int().min(32).max(240).optional(),
    columnWidth: z.number().int().min(80).max(1000).optional(),
    tableHeight: z.number().int().min(180).max(1600).nullable().optional(),
    tableWidth: z.number().int().min(280).max(3000).nullable().optional(),
    columnWidths: z
      .record(z.string().max(64), z.number().int().min(80).max(1000))
      .refine((v) => Object.keys(v).length <= 50)
      .optional(),
    rules: z
      .array(
        z
          .object({
            fieldId: z.string().min(1).max(64),
            operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
            value: z.union([z.number().finite(), z.string().max(200)]),
            color,
            target: z.enum(["background", "text", "bar"]),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict();
export type AppearanceValue = z.infer<typeof Appearance>;
export const defaultAppearance: AppearanceValue = {
  accent: "#2563eb",
  headerColor: "#f7f8fa",
  rowHeight: 52,
  columnWidth: 190,
};
export function appearanceFor(
  workspace?: AppearanceValue,
  table?: AppearanceValue,
): AppearanceValue {
  return {
    ...defaultAppearance,
    ...workspace,
    ...table,
    columnWidths: { ...workspace?.columnWidths, ...table?.columnWidths },
  };
}
export function matchingRules(
  appearance: AppearanceValue,
  fieldId: string,
  value: unknown,
) {
  return (appearance.rules || []).filter((r) => {
    if (
      r.fieldId !== fieldId ||
      value === null ||
      value === undefined ||
      value === ""
    )
      return false;
    if (r.operator === "eq") return value === r.value;
    if (typeof value !== "number" || typeof r.value !== "number") return false;
    return r.operator === "lt"
      ? value < r.value
      : r.operator === "lte"
        ? value <= r.value
        : r.operator === "gt"
          ? value > r.value
          : value >= r.value;
  });
}
