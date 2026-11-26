import { Plugin } from "@opencode/plugin";
import { readFile, mkdir, writeFile, appendFile, rename, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { snapshot, inspect } from "./guard.mjs";
import { taskLifecycle } from "./lifecycle.mjs";
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
      await appendFile(join(directory,"lifecycle.jsonl"), JSON.stringify({at:Date.now(),session:id,task:(await ctx.storage.get(key(id)))?.id,stage,revision:config.revision,...detail}) + "\n");
    }
    async function saveSessions(id,task) {
      await mkdir(directory, {recursive:true});
      const target = join(directory,"sessions.json");
      const tmp = target + ".tmp-" + id;
      await writeFile(tmp, JSON.stringify({sessions:await resources.sessions(id,task),task:task?.id,started_at:task?.startedAt}));
      await rename(tmp,target);
    }
    let quality, lifecycle;
    async function readReceipt(name) {
      return JSON.parse(await readFile(join(directory,name),"utf8"));
    }
    async function validateStart(task) {
      if (!task.lastCompletedBranch) return "";
      try {
        const begun=await readReceipt("task.json");
        const branch=(await exec("git",["branch","--show-current"],{cwd:root,timeout:15000})).stdout.trim();
        if (begun.branch!==branch || branch===task.lastCompletedBranch ||
            begun.revision!==config.revision || !Number.isInteger(begun.started_at) || begun.started_at<task.startedAt)
          throw Error("stale task");
        return "";
      } catch { return "Start this new task with canonical begin on a fresh feature branch; do not reuse the delivered branch."; }
    }
    async function deliveryIdentity(task) {
      const why=await validateStart(task);
      if (why) throw Error(why);
      const begun=await readReceipt("task.json");
      const check=await readReceipt("check.json");
      const branch=(await exec("git",["branch","--show-current"],{cwd:root,timeout:15000})).stdout.trim();
      if (!branch || begun.branch!==branch || begun.revision!==config.revision || check.status!=="PASS" ||
          typeof check.digest!=="string" || !Number.isInteger(check.checked_at)) throw Error("Missing current task/check identity");
      return {branch,digest:check.digest,checked_at:check.checked_at};
    }
    async function completion() {
      try {
        await readReceipt("delivery-result.json");
        const {stdout}=await exec("python3",[join(root,".flutter-harness/bin/harness.py"),"completion"],{cwd:root,timeout:15000});
        return JSON.parse(stdout);
      } catch { return null; }
    }
    async function archive(task) {
      const target=join(directory,"history",task.id);
      await mkdir(target,{recursive:true});
      for (const name of ["task.json","check.json","check-attempt.json","delivery.json","delivery-state.json","delivery-result.json","sessions.json","visual-plan.json","visual-preflight.json","runtime.json","runtime-selection.json","baseline.json","e2e-ios.json","e2e-android.json","e2e-web.json"]) {
        try { await copyFile(join(directory,name),join(target,name)); }
        catch (err) { if (err.code!=="ENOENT") throw err; }
      }
    }
    const resources = await registerResourceGuard(ctx, key, id=>quality.inputs(id), (event,input)=>quality.prepareReview(event,input),record);
    quality = await registerQualityGate(ctx, root, "origin/" + base, key, undefined, resources.status, true, resources.reviewAvailability, undefined, async()=>{
      try {
        const {stdout}=await exec("python3",[join(root,".flutter-harness/bin/harness.py"),"status"],{cwd:root,timeout:15000});
        return JSON.parse(stdout).checked===true;
      } catch { return false; }
    }, validateStart, (event,task)=>lifecycle.authorize(event,task));
    lifecycle=taskLifecycle(ctx,{assertRevision,snapshot:()=>snapshot(root),
      inspect:state=>inspect(root,base,state.baseline,state.intent),completion,deliveryIdentity,
      quality,resources,record,saveSessions,archive,
      lastBegin:async state=>{
        const events=(await readFile(join(directory,"lifecycle.jsonl"),"utf8")).split("\n").flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});
        return events.filter(e=>e.at>=state.startedAt && ["begin","begin-blocked"].includes(e.stage)).at(-1);
      }});
    await ctx.session.hook("context", async (event) => {
      const instructions = await readFile(join(root, ".opencode/plugins/delivery-guard/build.md"), "utf8");
      event.system.push({type:"text", text:instructions});
    });
    await ctx.session.hook("prompt", lifecycle.prompt);
    await ctx.tool.hook("execute.after", lifecycle.delivered);
    await ctx.session.hook("experimental.idle", lifecycle.idle);
  },
});
