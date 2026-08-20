"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCustomPresetInput = parseCustomPresetInput;
exports.formatCustomPresetInput = formatCustomPresetInput;
const DECIMAL_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function parseFiniteDecimal(value) {
    const trimmed = value.trim();
    if (!DECIMAL_NUMBER.test(trimmed)) {
        return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseCustomPresetInput(input) {
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
function formatCustomPresetInput(temperature, topP) {
    if (temperature === null) {
        return "";
    }
    return topP === null ? String(temperature) : `${temperature},${topP}`;
}
//# sourceMappingURL=modelPreset.js.map