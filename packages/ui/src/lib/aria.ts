/** A boolean ARIA state as the attribute value; "false" is a value, not a missing attribute */
export const ariaBoolean = (value: boolean): "true" | "false" => (value ? "true" : "false");
