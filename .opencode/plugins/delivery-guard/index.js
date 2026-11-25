import { Plugin } from "@opencode/plugin";
import { readFile, mkdir, writeFile, appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { snapshot, inspect, taskIntent, recovery } from "./guard.mjs";
import { registerQualityGate } from "./quality.mjs";
import { registerResourceGuard } from "./resources.mjs";
import { buildOnly } from "./scope.mjs";

// Runs at normal OpenCode V2 completion, not on interrupted/failed executions.
// Maximum two continuations, no privileged Git/GitHub write actions.
export default Plugin.define({
  id: "flutter-harness-delivery",
  async setup(raw) {
    const ctx = buildOnly(raw);
    const location = raw.location.directory;
    if (!location) throw Error("Harness requires an explicit OpenCode working directory");
    const root = (await exec("git",["rev-parse","--show-toplevel"],{cwd:location,timeout:15000})).stdout.trim();
    const config = JSON.parse(await readFile(join(root, ".flutter-harness/config.json"), "utf8"));
    if (config.schema !== 2 || typeof config.integration_branch !== "string" || !config.integration_branch) throw Error("Harness schema 2 configuration required");
    const base = config.integration_branch;
    async function assertRevision() {
      await exec("python3",[join(root,".flutter-harness/bin/harness.py"),"revision","--expect",config.revision],{cwd:root,timeout:15000});
    }
    const key = (id) => "task/" + id;
    const directory = join(root, ".flutter-harness/work");
    async function record(id, stage, detail = {}) {
      await mkdir(directory, {recursive:true});
      await appendFile(join(directory,"lifecycle.jsonl"), JSON.stringify({at:Date.now(),session:id,stage,revision:config.revision,...detail}) + "\n");
    }
    async function saveSessions(id) {
      await mkdir(directory, {recursive:true});
      const target = join(directory,"sessions.json");
      const tmp = target + ".tmp-" + id;
      await writeFile(tmp, JSON.stringify({sessions:await resources.sessions(id)}));
      await rename(tmp,target);
    }
    let quality;
    const resources = await registerResourceGuard(ctx, key, id=>quality.inputs(id), (event,input)=>quality.prepareReview(event,input),record);
    quality = await registerQualityGate(ctx, root, "origin/" + base, key, undefined, resources.status, true, resources.reviewAvailability, undefined, async()=>{
      try {
        const {stdout}=await exec("python3",[join(root,".flutter-harness/bin/harness.py"),"status"],{cwd:root,timeout:15000});
        return JSON.parse(stdout).checked===true;
      } catch { return false; }
    });
    await ctx.session.hook("context", async (event) => {
      const instructions = await readFile(join(root, ".opencode/plugins/delivery-guard/build.md"), "utf8");
      event.system.push({type:"text", text:instructions});
    });
    await ctx.session.hook("prompt", async (event) => {
      await assertRevision();
      const previous = await ctx.storage.get(key(event.sessionID));
      if (previous?.active) return;
      await quality.clear(event.sessionID);
      await resources.clear(event.sessionID);
      await ctx.storage.set(key(event.sessionID), {
        active: true,
        intent: taskIntent(event.prompt?.text),
        request: event.prompt?.text || "",
        baseline: await snapshot(root),
        startedAt:Date.now(),
        attempts: 0,
      });
      await record(event.sessionID, "task-start");
      await saveSessions(event.sessionID);
    });
    await ctx.session.hook("experimental.idle", async (event) => {
      const id = event.sessionID;
      const state = await ctx.storage.get(key(id));
      if (!state?.active) return;
      if (event.background?.some(work => work.sessionID === id)) return;
      await assertRevision();
      const result = await inspect(root, base, state.baseline, state.intent);
      const events=(await readFile(join(directory,"lifecycle.jsonl"),"utf8")).split("\n").flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});
      const begin=events.filter(e=>e.at>=state.startedAt && ["begin","begin-blocked"].includes(e.stage)).at(-1);
      if (begin?.stage==="begin-blocked" && /different Harness revision|Dirty checkout|Unsafe feature branch/.test(begin.reason || "")) {
        await saveSessions(id);
        await record(id,"task-incomplete",{phase:"prerequisite",reason:begin.reason});
        await ctx.storage.remove(key(id));
        await quality.clear(id);
        await resources.clear(id);
        return;
      }
      const evidence = result.active ? await quality.status(id) : { issue: "", phase: "work" };
      if (!result.active || (result.passed && !evidence.issue)) {
        if (result.active) {
          await saveSessions(id);
          await record(id, "task-complete", {attempts:state.attempts});
        }
        await ctx.storage.remove(key(id));
        await quality.clear(id);
        await resources.clear(id);
        return;
      }
      if (evidence.phase === "waiting") return;
      const next = recovery(state, result, evidence);
      await saveSessions(id);
      await record(id, next.stop ? "task-incomplete" : "task-recovery", {attempts:state.attempts, phase:evidence.phase, check:evidence.check});
      if (next.stop) {
        throw Error("Flutter Harness INCOMPLETE: " + next.reason + ". Recovery budget exhausted or no observable progress.");
      }
      await ctx.storage.set(key(id), { ...state, attempts: state.attempts + 1, lastRecovery: next.fingerprint });
      await ctx.session.synthetic({ sessionID: id, text: next.prompt });
    });
  },
});
