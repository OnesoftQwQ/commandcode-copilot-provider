import assert from "node:assert/strict";
import {
    formatCustomPresetInput,
    parseCustomPresetInput,
} from "../out/modelPreset.js";

assert.deepEqual(parseCustomPresetInput("0"), { value: { temperature: 0 } });
assert.deepEqual(parseCustomPresetInput("2"), { value: { temperature: 2 } });
assert.deepEqual(parseCustomPresetInput(".7"), { value: { temperature: 0.7 } });
assert.deepEqual(parseCustomPresetInput("0.7,0.95"), {
    value: { temperature: 0.7, topP: 0.95 },
});
assert.deepEqual(parseCustomPresetInput(" 1e-1 , 1 "), {
    value: { temperature: 0.1, topP: 1 },
});

assert.equal(parseCustomPresetInput("").error, "Please enter at least temperature value");
assert.equal(parseCustomPresetInput("0.7,0.9,0.8").error, "Please enter at most two numbers separated by a comma");
assert.equal(parseCustomPresetInput("0.7abc").error, "Temperature must be between 0.0 and 2.0");
assert.equal(parseCustomPresetInput("Infinity").error, "Temperature must be between 0.0 and 2.0");
assert.equal(parseCustomPresetInput("2.1").error, "Temperature must be between 0.0 and 2.0");
assert.equal(parseCustomPresetInput("0.7,").error, "top_p must be between 0.0 and 1.0");
assert.equal(parseCustomPresetInput("0.7,1.1").error, "top_p must be between 0.0 and 1.0");

assert.equal(formatCustomPresetInput(null, null), "");
assert.equal(formatCustomPresetInput(0.7, null), "0.7");
assert.equal(formatCustomPresetInput(0.7, 0.95), "0.7,0.95");

console.log("model preset UI helpers: ok");
