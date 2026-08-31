import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	formatAcceptancePrompt,
	resolveAcceptanceReportMode,
	resolveEffectiveAcceptance,
	validateAcceptanceInput,
} from "../../src/runs/shared/acceptance.ts";
import {
	acceptanceReportJsonSchema,
	createStructuredOutputRuntime,
	validateStructuredOutputValue,
} from "../../src/runs/shared/structured-output.ts";

describe("acceptance report mode", () => {
	it("defaults to optional when report is omitted", () => {
		assert.equal(resolveAcceptanceReportMode(undefined), "optional");
		assert.equal(resolveAcceptanceReportMode("checked"), "optional");
		assert.equal(resolveAcceptanceReportMode(false), "optional");
		assert.equal(resolveAcceptanceReportMode({ level: "checked" }), "optional");
	});

	it("returns structured for report: on and off for report: off", () => {
		assert.equal(resolveAcceptanceReportMode({ level: "checked", report: "on" }), "structured");
		assert.equal(resolveAcceptanceReportMode({ level: "checked", report: "off" }), "off");
	});

	it("rejects invalid report values in validateAcceptanceInput", () => {
		const errors = validateAcceptanceInput({ level: "checked", report: "maybe" } as never);
		assert.ok(errors.some((error: string) => error.includes('report must be "on" or "off"')));
		const valid = validateAcceptanceInput({ level: "checked", report: "on" } as never);
		assert.ok(!valid.some((error: string) => error.includes("report")));
	});
});

describe("acceptance report required runtime", () => {
	it("creates a report-only runtime when there is no outputSchema", () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-report-mode-"));
		const runtime = createStructuredOutputRuntime(undefined, base, { captureAcceptanceReport: true, acceptanceReportRequired: true });
		assert.equal(runtime.reportOnly, true);
		assert.equal(runtime.acceptanceReportRequired, true);
		assert.ok(runtime.acceptanceReportPath);
		// Report-only: no outputSchema exists, so no schema file is materialized.
		assert.ok(!fs.existsSync(runtime.schemaPath));
	});

	it("keeps reportOnly false when an outputSchema is provided", () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-report-mode-"));
		const runtime = createStructuredOutputRuntime({ type: "object", properties: { answer: { type: "string" } } }, base, { captureAcceptanceReport: true, acceptanceReportRequired: true });
		assert.equal(runtime.reportOnly, undefined);
		assert.equal(runtime.acceptanceReportRequired, true);
		assert.ok(runtime.acceptanceReportPath);
	});

	it("does not set acceptanceReportRequired when the flag is absent", () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-report-mode-"));
		const runtime = createStructuredOutputRuntime({ type: "object" }, base);
		assert.equal(runtime.acceptanceReportRequired, undefined);
		assert.equal(runtime.reportOnly, undefined);
	});
});

describe("acceptance report json schema", () => {
	it("validates a well-formed report", async () => {
		const schema = acceptanceReportJsonSchema();
		const result = await validateStructuredOutputValue(schema, {
			criteriaSatisfied: [{ id: "tests", status: "satisfied", evidence: "all green" }],
			commandsRun: [{ command: "npm test", result: "passed", summary: "ok" }],
			changedFiles: ["src/a.ts"],
			noStagedFiles: true,
		});
		assert.equal(result.status, "valid");
	});

	it("rejects a report with an invalid criterion status", async () => {
		const schema = acceptanceReportJsonSchema();
		const result = await validateStructuredOutputValue(schema, {
			criteriaSatisfied: [{ id: "tests", status: "done", evidence: "x" }],
		});
		assert.equal(result.status, "invalid");
		assert.ok(result.status === "invalid" && result.message.includes("criteriaSatisfied"));
	});

	it("rejects a report with an invalid command result", async () => {
		const schema = acceptanceReportJsonSchema();
		const result = await validateStructuredOutputValue(schema, {
			commandsRun: [{ command: "npm test", result: "green", summary: "ok" }],
		});
		assert.equal(result.status, "invalid");
	});
});

describe("formatAcceptancePrompt report modes", () => {
	const acceptance = resolveEffectiveAcceptance({ explicit: { level: "checked", criteria: ["npm test passes"] }, agentName: "worker" });

	it("text mode keeps the fenced template when no structured delivery is configured", () => {
		const prompt = formatAcceptancePrompt(acceptance);
		assert.ok(prompt.includes("```acceptance-report"));
		assert.ok(!prompt.includes("structured_output"));
	});

	it("piggyback mode asks for acceptanceReport inside structured_output without a fence", () => {
		const prompt = formatAcceptancePrompt(acceptance, { structuredOutput: true });
		assert.ok(prompt.includes("Include an `acceptanceReport` object in your final `structured_output` tool call"));
		assert.ok(!prompt.includes("```acceptance-report"));
	});

	it("required report-only mode demands a structured_output report delivery", () => {
		// Mirrors real callers: report-only runtime => reportRequired + reportOnly,
		// and structuredOutput stays false because there is no outputSchema delivery.
		const prompt = formatAcceptancePrompt(acceptance, { reportRequired: true, reportOnly: true });
		assert.ok(prompt.includes("structured_output"));
		assert.ok(prompt.includes("Mandatory"));
		assert.ok(prompt.includes("its single `value` parameter"));
		assert.ok(!prompt.includes("Include an `acceptanceReport` object"));
		assert.ok(!prompt.includes("```acceptance-report"));
	});

	it("required piggyback mode keeps the acceptanceReport instruction", () => {
		// Real caller combination: outputSchema + report on => structuredOutput true, reportOnly false.
		const prompt = formatAcceptancePrompt(acceptance, { structuredOutput: true, reportRequired: true, reportOnly: false });
		assert.ok(prompt.includes("Include an `acceptanceReport` object"));
		assert.ok(!prompt.includes("Mandatory:"));
		assert.ok(!prompt.includes("```acceptance-report"));
	});

	it("report with notes passes the report schema (alias for manualNotes)", async () => {
		const schema = acceptanceReportJsonSchema();
		const result = await validateStructuredOutputValue(schema, { notes: "extra context" });
		assert.equal(result.status, "valid");
	});
});
