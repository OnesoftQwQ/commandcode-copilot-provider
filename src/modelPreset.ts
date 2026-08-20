export type CustomPresetInputError =
    | "Please enter at least temperature value"
    | "Please enter at most two numbers separated by a comma"
    | "Temperature must be between 0.0 and 2.0"
    | "top_p must be between 0.0 and 1.0";

export type CustomPresetInputResult =
    | { value: { temperature: number; topP?: number }; error?: never }
    | { value?: never; error: CustomPresetInputError };

const DECIMAL_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function parseFiniteDecimal(value: string): number | undefined {
    const trimmed = value.trim();
    if (!DECIMAL_NUMBER.test(trimmed)) {
        return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseCustomPresetInput(input: string): CustomPresetInputResult {
    const trimmed = input.trim();
    if (!trimmed) {
        return { error: "Please enter at least temperature value" };
    }

    const parts = trimmed.split(",");
    if (parts.length > 2) {
        return { error: "Please enter at most two numbers separated by a comma" };
    }

    const temperature = parseFiniteDecimal(parts[0]);
    if (temperature === undefined || temperature < 0 || temperature > 2) {
        return { error: "Temperature must be between 0.0 and 2.0" };
    }

    if (parts.length === 1) {
        return { value: { temperature } };
    }

    const topP = parseFiniteDecimal(parts[1]);
    if (topP === undefined || topP < 0 || topP > 1) {
        return { error: "top_p must be between 0.0 and 1.0" };
    }
    return { value: { temperature, topP } };
}

export function formatCustomPresetInput(temperature: number | null, topP: number | null): string {
    if (temperature === null) {
        return "";
    }
    return topP === null ? String(temperature) : `${temperature},${topP}`;
}
