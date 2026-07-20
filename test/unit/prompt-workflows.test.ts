import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverPromptWorkflows, registerPromptWorkflowCommands } from "../../src/slash/prompt-workflows.ts";
import type { SubagentParamsLike } from "../../src/runs/foreground/subagent-executor.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function writePrompt(dir: string, name: string, content: string): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${name}.md`), content, "utf-8");
}

function makeCtx(cwd: string) {
	return {
		cwd,
		hasUI: true,
		ui: {
			notifications: [] as Array<{ message: string; level: string }>,
			notify(message: string, level: string) {
				this.notifications.push({ message, level });
			},
		},
	} as never;
}

describe("prompt workflows", () => {
	let tempDir = "";
	let agentDir = "";
	let cwd = "";

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-workflows-"));
		agentDir = path.join(tempDir, "agent");
		cwd = path.join(tempDir, "repo");
		fs.mkdirSync(cwd, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers project workflows over user workflows", () => {
		writePrompt(path.join(agentDir, "prompts"), "native-test", `---
description: User version
subagent: reviewer
---
User body
`);
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-test", `---
description: Project version
subagent: worker
model: openai/gpt-5-mini
---
Project body $1
`);

		const workflow = discoverPromptWorkflows(cwd).find((entry) => entry.name === "native-test");

		assert.equal(workflow?.description, "Project version");
		assert.equal(workflow?.agent, "worker");
		assert.equal(workflow?.model, "openai/gpt-5-mini");
	});

	it("keeps bundled review-loop guidance user-capped and outcome-based", () => {
		const skill = fs.readFileSync(path.join(projectRoot, "skills", "pi-subagents", "SKILL.md"), "utf-8");
		const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf-8");

		for (const text of [skill, readme]) {
			assert.doesNotMatch(text, /until clean or capped/i);
			assert.match(text, /explicit user-supplied cap is reached/i);
		}
		assert.doesNotMatch(skill, /unless the parent or user explicitly sets/i);
		assert.match(skill, /Do not invent a numeric retrieval or source-count budget unless the user explicitly sets one/i);
	});

	it("keeps Skill and README model routing user-authorized", () => {
		const skill = fs.readFileSync(path.join(projectRoot, "skills", "pi-subagents", "SKILL.md"), "utf-8");
		const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf-8");

		for (const text of [skill, readme]) {
			assert.match(text, /configured primary.*fallback.*pre-authorized route/i);
			assert.match(text, /omit.*per-run model.*unless the user explicitly requests.*exact model/i);
			assert.match(text, /thinking suffix.*model override permission/i);
			assert.match(text, /tool failure.*do not.*different model/i);
			assert.match(text, /headless.*reject/i);
		}
		assert.match(readme, /modelOverridePermission.*ask.*deny.*allow/i);
		assert.doesNotMatch(readme, /Per-run model overrides.*still win/i);
	});

	it("runs a named workflow through native subagent execution", async () => {
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-run", `---
description: Run native prompt
subagent: reviewer
model: anthropic/claude-sonnet-4
skill: deslop,typescript-code
---
Review $1 with $ARGUMENTS
`);
		const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> }>();
		const sent: unknown[] = [];
		const runs: SubagentParamsLike[] = [];
		registerPromptWorkflowCommands({
			pi: {
				registerCommand: (name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) => commands.set(name, command),
				sendMessage: (message: unknown) => sent.push(message),
			} as never,
			run: async (params) => { runs.push(params); },
		});

		await commands.get("prompt-workflow")!.handler('native-run target --fork --worktree', makeCtx(cwd));

		assert.equal(sent.length, 0);
		assert.equal(runs.length, 1);
		assert.equal(runs[0]?.agent, "reviewer");
		assert.equal(runs[0]?.model, "anthropic/claude-sonnet-4");
		assert.deepEqual(runs[0]?.skill, ["deslop", "typescript-code"]);
		assert.equal(runs[0]?.context, "fork");
		assert.equal(runs[0]?.worktree, true);
		assert.equal(runs[0]?.task, "Review target with target");
	});

	it("runs prompt templates as a native chain", async () => {
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-analyze", `---
description: Analyze
subagent: scout
---
Analyze $@
`);
		writePrompt(path.join(cwd, ".pi", "prompts"), "native-fix", `---
description: Fix
subagent: worker
---
Fix from {previous}: $@
`);
		const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> }>();
		const runs: SubagentParamsLike[] = [];
		registerPromptWorkflowCommands({
			pi: {
				registerCommand: (name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) => commands.set(name, command),
				sendMessage: () => {},
			} as never,
			run: async (params) => { runs.push(params); },
		});

		await commands.get("chain-prompts")!.handler("native-analyze -> native-fix -- bug report", makeCtx(cwd));

		assert.equal(runs.length, 1);
		assert.equal(runs[0]?.chain?.length, 2);
		assert.equal(runs[0]?.chain?.[0]?.agent, "scout");
		assert.equal(runs[0]?.chain?.[0]?.task, "Analyze bug report");
		assert.equal(runs[0]?.chain?.[1]?.agent, "worker");
		assert.equal(runs[0]?.chain?.[1]?.task, "Fix from {previous}: bug report");
	});
});
