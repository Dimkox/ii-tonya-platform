type ScopeField = "display_name" | "timezone";

export type ConsentScopeExport =
  | { scopeFields: null; scopeStatus: "absent" | "redacted" }
  | { scopeFields: { fields?: ScopeField[] }; scopeStatus: "complete" };

/** Only the approved scope schema leaves the repository; stored JSON is untouched. */
export function projectConsentScope(value: unknown): ConsentScopeExport {
  if (value === null) return { scopeFields: null, scopeStatus: "absent" };
  if (typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return { scopeFields: {}, scopeStatus: "complete" };
    if (keys.length === 1 && keys[0] === "fields" && "fields" in value) {
      const fields = value.fields;
      if (
        Array.isArray(fields) &&
        fields.length <= 2 &&
        fields.every(
          (field): field is ScopeField =>
            field === "display_name" || field === "timezone",
        ) &&
        new Set(fields).size === fields.length
      ) {
        return {
          scopeFields: { fields: [...fields] },
          scopeStatus: "complete",
        };
      }
    }
  }
  return { scopeFields: null, scopeStatus: "redacted" };
}
