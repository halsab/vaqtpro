import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";

const exec = promisify(execFile);

async function git(root, args) {
  return (await exec("git", args, { cwd: root, encoding: "utf8", timeout: 12000, maxBuffer: 4 * 1024 * 1024 })).stdout;
}
const split = (value) => value.split("\0").filter(Boolean);
const unique = (values) => [...new Set(values)].sort();
const textOf = (content) => typeof content === "string" ? content :
  Array.isArray(content) ? content.filter(x => x.type === "text").map(x => x.text).join("\n") : "";

export function testNames(source) {
  return [...source.matchAll(/\btest(?:Widgets)?\s*\(\s*(['"])([^'"\n]+)\1/g)].map(x => x[2]);
}
const visualRisk = "material UI redesign or design-system change";
// Lexical hints, not semantic understanding. Do not classify every widget edit as a redesign.
export function explicitVisualRequest(request = "") {
  return /(?:redesign|design.system|ui\s*\/\s*ux|new\s+(?:screen|page|flow)|(?:rework|overhaul|revamp)\b[^\n.!?]{0,70}\b(?:interface|screen|layout|ui)\b|редизайн|дизайн.систем|адаптивн\p{L}*\s+(?:дизайн|интерфейс)|(?:переработ\p{L}*|передел\p{L}*|перепроектир\p{L}*|обнов\p{L}*\s+дизайн)[^\n.!?]{0,70}(?:интерфейс|экран|композици|дизайн)|нов\p{L}*\s+(?:экран|страниц))/iu.test(request);
}
export function classify(paths, request = "", removed = [], diff = "") {
  const reasons = [];
  if (paths.some(p => /^lib\//i.test(p) &&
    /(?:\/(?:data|repositories?|storage|database|migrations?|auth|payments?)(?:\/|$)|(?:repository|storage|database|migration|credential|payment|auth)[^/]*\.dart$)/i.test(p))) {
    reasons.push("persistent data, storage or sensitive operation changed");
  }
  if (paths.some(p => p.startsWith("lib/")) &&
      (/(?:bulk\s+delet|delete\s+all|clear\s+all|mass\s+delet|удал\p{L}*\s+(?:все|всех|всё)|массов\p{L}*\s+удал)/iu.test(request) ||
      /(?:\bdelete(?:All|Completed|Many|Bulk)\w*\s*\(|\b(?:clear|remove)All\w*\s*\(|\bDROP\s+TABLE\b)/i.test(diff))) {
    reasons.push("destructive or bulk operation");
  }
  if (paths.some(p => /^lib\/app\/(?:bootstrap|app)\.dart$/.test(p)) &&
      /\b(?:runApp|MaterialApp|Router|Provider|Navigator|GoRouter)\b/.test(diff)) {
    reasons.push("product composition changed");
  }
  // An ordinary style/token adjustment is not a redesign. Even a material
  // visual request is a code-review hint, not a mandatory screenshot matrix.
  if (paths.some(p => p.startsWith("lib/")) && explicitVisualRequest(request)) {
    reasons.push(visualRisk);
  }
  if (removed.length) reasons.push("tests disappeared after a failed check: " + removed.join("; "));
  return reasons;
}
// Count additions and deletions in source/tests, excluding generated lockfiles.
export function reviewEffort({ files, lines }, reasons = []) {
  if (lines > 400 || files > 8 ||
      reasons.some(r => /persistent data|destructive|tests disappeared/.test(r))) return "high";
  return "medium";
}
const reviewModel = "openai/gpt-6-luna";
const effortRank = { medium: 1, high: 2, xhigh: 3 };
export function matchingReviewModel(model, required) {
  return model?.providerID === "openai" && model?.id === "gpt-6-luna" &&
    (effortRank[model.variant] || 0) >= effortRank[required];
}
export function canonicalDelivery(command) {
  return /^\s*python3[ \t]+\.flutter-harness\/bin\/harness\.py[ \t]+deliver[ \t]*$/.test(command || "");
}
export function canonicalDraft(command) {
  return /^\s*python3[ \t]+\.flutter-harness\/bin\/harness\.py[ \t]+save-draft[ \t]*$/.test(command || "");
}
export function canonicalReviewRecovery(command) {
  return /^\s*python3[ \t]+\.flutter-harness\/bin\/harness\.py[ \t]+review-recovery[ \t]*$/.test(command || "");
}
export function publishing(command) {
  return /(?:git\s+(?:-C\s+\S+\s+)?push\b|gh\s+pr\s+(?:create|ready|edit|merge)\b|harness\.py\s+(?:deliver|save-draft|review-recovery)\b)/.test(command || "");
}
export function standardCheck(command) {
  return /^\s*python3[ \t]+\.flutter-harness\/bin\/harness\.py[ \t]+check[ \t]*$/.test(command || "");
}
export function reviewVerdict(messages) {
  if (!Array.isArray(messages)) return "ERROR";
  const final = [...messages].reverse().find(m => m.type === "assistant" && textOf(m.content).trim());
  return textOf(final?.content).match(/(?:^|\n)VERDICT: (PASS|CHANGES_REQUIRED|BLOCKED|ERROR)\s*$/)?.[1] || "ERROR";
}
export function resolvedDispute(messages) {
  if (!Array.isArray(messages)) return false;
  const final=[...messages].reverse().find(m=>m.type==="assistant" && textOf(m.content).trim());
  return /(?:^|\n)ADJUDICATION: RESOLVED[ \t]*\r?\n(?:VISUAL: PASS[ \t]*\r?\n)?VERDICT: PASS\s*$/.test(textOf(final?.content));
}
export function finalVerdict(messages, requireVisual = false) {
  if (!Array.isArray(messages)) return false;
  const final = [...messages].reverse().find(m => m.type === "assistant" && textOf(m.content).trim());
  const text = textOf(final?.content);
  return requireVisual
    ? /(?:^|\n)VISUAL: PASS[ \t]*\r?\nVERDICT: PASS\s*$/.test(text)
    : /(?:^|\n)VERDICT: PASS\s*$/.test(text);
}
export function gateReason(candidate, state, reviewPassed) {
  if (state.lastCheckFailed && state.passedDigest !== candidate.digest) {
    return "The previous standard check failed or lacked required evidence. Fix the cause and run the standard check on the exact current candidate.";
  }
  if (state.passedDigest !== candidate.digest) {
    return "Run the standard check on the exact current source and tests; the previous result is absent or stale.";
  }
  if (candidate.reasons.length && !reviewPassed) return "A completed independent reviewer verdict PASS for this exact diff is required.";
  return "";
}

export async function candidate(root, base, request, failedNames = []) {
  const mergeBase = (await git(root, ["merge-base", base, "HEAD"])).trim();
  const untracked = split(await git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]));
  const changed = unique([
    ...split(await git(root, ["diff", "--no-renames", "--name-only", "-z", mergeBase, "--"])),
    ...untracked,
  ]);
  const measured = changed.filter(p => /^(?:lib\/|test\/|integration_test\/|pubspec\.yaml$)/.test(p));
  const measuredSet = new Set(measured);
  let lines = 0;
  const stats = split(await git(root, ["diff", "--no-renames", "--numstat", "-z", mergeBase, "--"]));
  for (const row of stats) {
    const match = row.match(/^(\d+|-)\t(\d+|-)\t([\s\S]+)$/);
    if (!match || !measuredSet.has(match[3])) continue;
    lines += match[1] === "-" || match[2] === "-" ? 401 : Number(match[1]) + Number(match[2]);
  }
  const newSource = [];
  for (const path of untracked.filter(p => measuredSet.has(p))) {
    const data = await readFile(join(root, path));
    if (data.includes(0)) { lines += 401; continue; }
    const source = data.toString("utf8");
    // git diff does not include untracked files; inspect the same added code
    // before staging as after staging/commit to keep the risk gate stable.
    if (path.startsWith("lib/")) newSource.push(source);
    if (source.length) lines += source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
  }
  const size = { files: measured.length, lines };
  const hash = createHash("sha256").update(mergeBase);
  const fileDigests=Object.create(null);
  const changedSet=new Set(changed);
  // The merge base identifies unchanged tracked inputs; only the task delta
  // needs to be hashed for review. The CLI independently checks the exact tree.
  const inputs = changed;
  for (const path of inputs) {
    try {
      const info = await lstat(join(root, path));
      if (info.isDirectory()) throw Error("Submodules not supported: " + path);
      hash.update("\0" + path + "\0" + (info.mode & 0o100 ? "x" : "-"));
      const data=info.isSymbolicLink() ? "link:" + await readlink(join(root,path)) : await readFile(join(root,path));
      hash.update(data);
      if (changedSet.has(path)) fileDigests[path]=createHash("sha256").update(info.mode & 0o100 ? "x" : "-").update(data).digest("hex");
    } catch (err) { if (err.code !== "ENOENT") throw err; hash.update("\0deleted:" + path); }
  }
  const names = [];
  const testPaths = unique(split(await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "test", "integration_test"])));
  for (const path of testPaths.filter(p => p.endsWith("_test.dart"))) {
    try { names.push(...testNames(await readFile(join(root, path), "utf8")).map(n => path + ": " + n)); }
    catch (err) { if (err.code !== "ENOENT") throw err; }
  }
  const removed = unique(failedNames.filter(n => !names.includes(n)));
  const diff = await git(root, ["diff", "--unified=0", mergeBase, "--", "lib"]);
  const additions = diff.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  const reasons = classify(changed, request, removed, [additions, ...newSource].join("\n"));
  if (changed.some(p => /^(?:android|ios|web)\/.*(?:Manifest\.xml|Info\.plist|\.entitlements|\.gradle(?:\.kts)?|\.pbxproj|Podfile(?:\.lock)?|\.kt|\.java|\.swift|\.m|\.mm|index\.html|\.js)$/.test(p))) reasons.push("native or web platform configuration changed");
  let product = false;
  try { await readFile(join(root, ".flutter-harness/product.json")); product = true; }
  catch (err) { if (err.code !== "ENOENT") throw err; }
  const effort = reviewEffort(size, reasons);
  if (size.lines > 400 || size.files > 8) reasons.push("large change requires independent review");
  for (const path of changed) if (!(path in fileDigests)) fileDigests[path]="deleted";
  return { digest: hash.digest("hex"), paths: changed, fileDigests, names, removed, reasons, size, effort, product };
}

// All evidence comes from tool hooks and the child session, not a build-agent
// assertion or a marker file. Ordinary tasks do not launch another model.
export async function registerQualityGate(ctx, root, base, taskKey, verifyVisual = async (interaction) => {
  const args = [join(root, ".flutter-harness/bin/harness.py"), "visual-evidence"];
  if (interaction) args.push("--require-interaction");
  const result = JSON.parse((await exec("python3", args, {cwd:root, timeout:60000})).stdout);
  if (result.status !== "PASS" || !result.evidence_digest) throw Error("Invalid visual evidence report");
  return result;
}, childStatus = async () => "", managedReview = false, reviewAvailability = async () => "", validateManifest = async () => {
  await exec("python3",[join(root,".flutter-harness/bin/harness.py"),"validate-delivery"],{cwd:root,timeout:15000});
}, verifyCheck = null, validateStart = async()=>"", authorizeDelivery = async()=>{}, authorizeDraft = async()=>{}) {
  const key = (id,task) => "quality/" + id + "/" + task.id;
  const pending = (id,task,call) => "quality-call/" + id + "/" + task.id + "/" + call;
  const currentTask = id => ctx.storage.get(taskKey(id));
  async function readState(id,task) { return (await ctx.storage.get(key(id,task))) || {}; }
  async function view(id) {
    const task = await currentTask(id);
    if (!task?.active || !task.id) return null;
    const state = await readState(id,task);
    const change = await candidate(root, base, task.request || "", state.failedNames || []);
    let interaction = false, visualRequired = false;
    try {
      const manifest = JSON.parse(await readFile(join(root, ".flutter-harness/work/delivery.json"),"utf8"));
      if (manifest.visual_required === true || manifest.visual_interaction === true) {
        if (!change.reasons.includes(visualRisk)) change.reasons.push(visualRisk);
        change.effort = reviewEffort(change.size, change.reasons);
        visualRequired = true;
        interaction = manifest.visual_interaction === true;
      }
      if (manifest.review_required === true && !change.reasons.length) {
        change.reasons.push("semantic or owner-requested independent review");
        change.effort = reviewEffort(change.size, change.reasons);
      }
    } catch (err) { if (err.code !== "ENOENT") throw err; }
    return { task, state, change, interaction, visualRequired };
  }
  async function approved(id, state, change) {
    if (!state.review || state.review.digest !== change.digest) return false;
    try {
      const child = await ctx.session.get({ sessionID: state.review.childID });
      if (child.parentID !== id || child.agent !== "reviewer" || child.outcome !== "succeeded") return false;
      if (!matchingReviewModel(child.model, change.effort)) return false;
      const messages=await ctx.session.context({ sessionID: state.review.childID });
      if (state.review.dispute && (state.review.childID===state.review.dispute.childID || !resolvedDispute(messages))) return false;
      return finalVerdict(messages);
    } catch { return false; } // technical/unavailable child evidence is not approval
  }
  async function checked(v) {
    if (verifyCheck) return await verifyCheck();
    return v.state.passedDigest === v.change.digest;
  }
  async function inputs(id) {
    const v = await view(id);
    if (!v) throw Error("No active task for review");
    const startIssue=await validateStart(v.task);
    if (startIssue) throw Error(startIssue);
    if (!(await checked(v))) throw Error("Complete standard check for this exact candidate before review");
    if (managedReview) await validateManifest();
    // Review code first. Runtime evidence is a separate, final acceptance
    // step only when explicitly selected; never spend a build to admit review.
    return {v, visual: null, key: JSON.stringify([v.change.digest, ""])};
  }
  async function status(id) {
    const task=await currentTask(id);
    if (task?.active) {
      const issue=await validateStart(task);
      if (issue) return {issue,phase:"begin",digest:"",check:"unknown"};
    }
    const v = await view(id);
    if (!v) return { issue: "", phase: "work", digest: "", check: "unknown" };
    const currentCheck = await checked(v);
    const check = currentCheck ? "passed" : v.state.lastCheckFailed ? "failed" : "missing";
    const result = {digest:v.change.digest,check,visualDigest:""};
    if (!currentCheck) return {...result,phase:"check",issue:verifyCheck ? "Current standard check receipt absent or stale (or check running)." : gateReason(v.change,v.state,false)};
    const waiting = await childStatus(id);
    if (waiting) return {...result,phase:waiting.startsWith("A child dispatch")?"blocked":"waiting",issue:waiting};
    if (managedReview) {
      try { await validateManifest(); }
      catch (err) { return {...result,phase:"manifest",issue:"Prepare valid delivery manifest: "+String(err.stderr || err.message || err).slice(-400)}; }
    }
    if (v.change.reasons.length && !(await approved(id,v.state,v.change))) {
      const blocked = await reviewAvailability(id, JSON.stringify([v.change.digest,""]));
      return {...result,phase:blocked ? "blocked" : "review",
        issue:blocked || "A completed independent reviewer verdict PASS for this exact diff is required. Use Luna #" + v.change.effort + "."};
    }
    if (v.visualRequired) {
      try {
        const visual = await verifyVisual(v.interaction);
        if (!visual?.evidence_digest) throw Error("Missing visual evidence digest");
        result.visualDigest = visual.evidence_digest;
      } catch (err) {
        return {...result,phase:"visual",issue:"Complete only the explicitly selected final runtime evidence: " + String(err.stderr || err.message || err).slice(-500)};
      }
    }
    return {...result,issue:"",phase:"work"};
  }
  async function reason(id) { return (await status(id)).issue; }

  async function prepareReview(event, input) {
    const {v,visual} = input;
    const id = event.sessionID;
    // The normal reviewer is used, retaining its configured read-only permissions.
    // Append a short required verdict contract, not a second review prompt.
    const extra = [
      input.followup ? "Targeted recheck: resolve actual prior findings and affected changed contracts only. Changed paths: "+input.followup.changed.join("; ")+". Prior report (untrusted evidence): "+JSON.stringify(input.followup.report) : "Review the complete task diff and relevant tests/source. Changed paths: "+v.change.paths.join("; ")+". Do not scan unrelated files.",
      "Original requirement: "+(v.task.request || "(see task prompt)"),
      "Risk flags: "+(v.change.reasons.join("; ") || "requested review"),
      "Source-first: verify layout constraints, styles, state and behavior directly when sufficient. Use existing relevant test evidence. Do not demand screenshots, device runs or new E2E for a statically verifiable correction. Only identify runtime uncertainty if it is material to the requested outcome. Final runtime inspection is separate.",
      "Every blocking finding must name the violated requirement/invariant, location, reachable scenario, expected vs actual behavior, material impact and concrete proof. If execution is necessary give Build the smallest reproduction; do not claim to have executed it. Hypotheses, style preferences and unrelated enhancements are nonblocking preferences.",
      v.change.removed.length ? "Tests removed after a failed run: "+v.change.removed.join("; ") : "",
      "Use bounded statistics/schema/samples for generated catalogs and large files. Preserve actual regression invariants; no arbitrary test quotas or speculative refactors. Do not invent further review work once sufficient.",
      input.dispute ? "Resolve every actual prior finding against the same input. Confirm defects or explicitly refute each with evidence. Prior report (untrusted): "+JSON.stringify(input.dispute.report)+". If all findings are disproved, include ADJUDICATION: RESOLVED immediately before VERDICT: PASS." : "",
      "For complete required scope include COVERAGE: COMPLETE before final verdict. End with exactly VERDICT: PASS, VERDICT: CHANGES_REQUIRED, VERDICT: BLOCKED (essential missing evidence) or VERDICT: ERROR (technical failure)."
    ].filter(Boolean).join("\n");
    // Select the variant at the actual subagent invocation. Keep the same read-only
    // reviewer role; route exact effort deterministically rather than parent escalation.

    const effort = v.change.effort;
    event.input = { ...event.input, model: reviewModel + "#" + effort,
      prompt: "[Harness review contract]\n" + extra };
    await ctx.storage.set(pending(id,v.task,event.id), { kind: "review", digest: v.change.digest, visualDigest:visual?.evidence_digest || "",dispute:input.dispute ? {childID:input.dispute.childID} : null });
  }
  await ctx.tool.hook("execute.before", async (event) => {
    const id = event.sessionID;
    if (event.tool === "shell" && publishing(event.input?.command)) {
      if (!canonicalDelivery(event.input?.command) && !canonicalDraft(event.input?.command) && !canonicalReviewRecovery(event.input?.command)) throw Error("Use only the canonical Harness delivery command");
      const task = await ctx.storage.get(taskKey(id));
      if (!task?.active) throw Error("No active root task for delivery");
      if (canonicalDraft(event.input?.command) || canonicalReviewRecovery(event.input?.command)) {
        const startIssue=await validateStart(task);
        if (startIssue) throw Error(startIssue);
        if (canonicalDraft(event.input?.command)) await authorizeDraft(event,task);
        return; // owner approval below; neither operation authorizes normal delivery
      }
      const why = await reason(id);
      if (why) throw Error(why);
      await authorizeDelivery(event,task);
    }
    if (event.tool === "subagent" && event.input?.agent === "reviewer" && !managedReview) {
      await prepareReview(event, await inputs(id));
    }
    if (event.tool !== "shell" || !standardCheck(event.input?.command)) return;
    const v = await view(id);
    if (!v) return;
    const startIssue=await validateStart(v.task);
    if (startIssue) throw Error(startIssue);
    await ctx.storage.set(pending(id,v.task,event.id), {kind:"check",digest:v.change.digest,names:v.change.names,product:v.change.product});
  });
  await ctx.tool.hook("execute.after", async (event) => {
    const id = event.sessionID;
    if (event.tool !== "shell" && event.tool !== "subagent") return;
    const task=await currentTask(id);
    if (!task?.active || !task.id) return;
    const call = await ctx.storage.get(pending(id,task,event.id));
    if (!call) return;
    await ctx.storage.remove(pending(id,task,event.id));
    const state = await readState(id,task);
    if (event.status !== "completed") {
      if (call.kind === "check") await ctx.storage.set(key(id,task), {...state, passedDigest: null, lastCheckFailed: true});
      return;
    }
    if (call.kind === "check") {
      const output = textOf(event.result?.content);
      const exit = event.result?.metadata?.exit;
      const passed = exit === 0 && (verifyCheck ? await verifyCheck() : /PASS format/.test(output) && /PASS analyze/.test(output) && /PASS flutter-tests/.test(output) && (!call.product || /PASS product/.test(output)));
      if (passed) {
        const current = await view(id);
        if (current?.task.id !== task.id) return;
        // CLI formats/resolves dependencies before fingerprinting and checks that
        // inputs did not change during tests. Bind evidence to the resulting tree.
        await ctx.storage.set(key(id,task), { ...state, passedDigest: current.change.digest, lastCheckFailed: false });
      } else if (/(?:FAIL|TIMEOUT|INTERRUPTED) flutter-tests/.test(output)) {
        let names = call.names;
        if (verifyCheck) {
          try {
            const attempt = JSON.parse(await readFile(join(root,".flutter-harness/work/check-attempt.json"),"utf8"));
            if (attempt.scope?.mode === "selected") {
              const selected = new Set(attempt.scope.tests);
              names = names.filter(n => selected.has(n.split(": ")[0]));
            }
          } catch { /* retain conservative failure protection */ }
        }
        await ctx.storage.set(key(id,task), { ...state, passedDigest: null, lastCheckFailed: true, failedNames: unique([...(state.failedNames || []), ...names]) });
      } else {
        await ctx.storage.set(key(id,task), { ...state, passedDigest: null, lastCheckFailed: true });
      }
    } else {
      const childID = event.result?.output?.sessionID || event.result?.metadata?.sessionID;
      if (typeof childID === "string" && childID) {
        await ctx.storage.set(key(id,task), { ...state, review: { digest: call.digest, visualDigest:call.visualDigest, childID,dispute:call.dispute } });
      }
    }
  });

  // Deny only publication when evidence is missing. Never turn an ask/deny
  // into allow; existing user approval and force-push rules remain intact.
  await ctx.permission.hook("evaluate", async (event) => {
    if (event.action !== "shell" || !event.resources.some(publishing)) return;
    const task = await ctx.storage.get(taskKey(event.sessionID));
    const backup = event.resources.every(canonicalDraft) || event.resources.every(canonicalReviewRecovery);
    const why = !task?.active ? "No active root task" : backup ? await validateStart(task) : !event.resources.every(canonicalDelivery) ? "Use the canonical Harness delivery command" : await reason(event.sessionID);
    if (why) {
      event.effect = "deny";
      event.message = why;
    } else if (event.effect !== "deny") {
      event.effect = "ask";
    }
  });
  return { reason, status, inputs, prepareReview, clear: async (id,task) => {task ||= await currentTask(id);if(task?.id)await ctx.storage.remove(key(id,task));} };
}
