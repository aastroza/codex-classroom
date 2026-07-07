import type { Output } from "../types.js";

export function createOutput(jsonMode: boolean, plain: boolean): Output {
  const prefix = plain
    ? { info: "", warn: "warning: ", error: "error: " }
    : { info: "", warn: "Warning: ", error: "Error: " };

  return {
    info(message) {
      if (!jsonMode) {
        console.log(`${prefix.info}${message}`);
      }
    },
    warn(message) {
      if (!jsonMode) {
        console.warn(`${prefix.warn}${message}`);
      }
    },
    error(message) {
      if (!jsonMode) {
        console.error(`${prefix.error}${message}`);
      }
    },
    json(value) {
      console.log(JSON.stringify(value, null, 2));
    },
  };
}

export function redactSecret(value: string): string {
  if (value.length <= 8) {
    return "<redacted>";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
