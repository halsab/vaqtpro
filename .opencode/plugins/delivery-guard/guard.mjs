import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const exec = promisify(execFile);
async function command(root, bin, args) {
  try {
    const { stdout } = await exec(bin, args, {
      cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 100000,
    });
    return { ok: true, message: stdout.trim() };
  } catch (err) {
    let deliveryError;
    try {
      const data = JSON.parse(err.stdout || "");
      if (data.status === "BLOCKED" && typeof data.stage === "string" &&
          typeof data.error?.code === "string" && typeof data.error.message === "string" &&
          typeof data.error.retryable === "boolean") deliveryError = {...data.error, stage:data.stage};
    } catch { /* ordinary CLI error */ }
    return { ok: false, message: String(err.stderr || err.message || err).slice(0, 500), deliveryError };
  }
}
export function taskIntent(text) {
  return /(?:\b(?:add|implement|fix|create|build|update|refactor|finish|continue)\b|переработ|передел|улучш|добав|реализ|исправ|созда|разработ|доработ|переимен|измени|внеси|заверш|доведи|продолжи)/i.test(text || "");
}
export function changed(a, b) {
  return a.head !== b.head || a.branch !== b.branch || a.status !== b.status || a.digest !== b.digest;
}
export async function snapshot(root) {
  const [head, branch, status, digest] = await Promise.all([
    command(root, "git", ["rev-parse", "HEAD"]),
    command(root, "git", ["branch", "--show-current"]),
    command(root, "git", ["status", "--porcelain=v1", "--untracked-files=normal"]),
    command(root, "python3", [join(root, ".flutter-harness/bin/harness.py"), "fingerprint"]),
  ]);
  if (![head, branch, status, digest].every(x => x.ok)) throw Error("Unable to read Git state");
  return { head: head.message, branch: branch.message, status: status.message, digest: digest.message };
}
export function decide(before, current, intent, prOK, prMessage, base = "app") {
  const didWork = changed(before, current);
  if (!didWork && !intent) return { active: false, passed: true, reasons: [] };
  const reasons = [];
  if ([base, "app", "main", "master", "develop", ""].includes(current.branch)) reasons.push("Create a feature branch; never commit onto the integration branch");
  // A feature may start with uncommitted edits and end clean after committing them.
  // An unchanged pre-existing dirty worktree is also not newly unfinished work.
  // Only flag a *currently dirty* worktree that differs from the initial state.
  if (current.status && (current.status !== before.status || current.digest !== before.digest)) {
    reasons.push("New or changed uncommitted work remains (preserve unrelated preexisting changes)");
  }
  if (!didWork && intent) reasons.push("No task change was recorded in this session");
  if (!prOK) reasons.push("Delivery incomplete: " + prMessage);
  return { active: true, passed: reasons.length === 0, reasons };
}
export async function inspect(root, base, before, intent) {
  const current = await snapshot(root);
  if (!changed(before, current) && !intent) return { active:false, passed:true, reasons:[], current };
  const script = join(root, ".flutter-harness", "bin", "harness.py");
  const pr = [base, "app", "main", "master", "develop", ""].includes(current.branch)
    ? {ok:false, message:"Finish local work and run canonical deliver"}
    : await command(root, "python3", [script, "completion"]);
  return { ...decide(before, current, intent, pr.ok, pr.message, base), current, deliveryError:pr.deliveryError };
}

// A repeated idle with identical source/check/delivery state is not progress.
// The first retry is allowed; a second needs a material change in evidence.
export function recovery(state, result, quality) {
  const deliveryError = quality.check === "passed" && quality.phase === "work" ? result.deliveryError : undefined;
  const reasons = [...result.reasons, quality.issue].filter(Boolean);
  if (deliveryError) reasons.push(deliveryError.code + " at " + deliveryError.stage + ": " + deliveryError.message);
  const missingCommittedManifest = quality.phase === "manifest" && result.current.status === "";
  if (missingCommittedManifest) reasons.push("Committed candidate has no valid delivery manifest; restore the original manifest, do not regenerate acceptance flags.");
  const fingerprint = JSON.stringify([result.current, quality.digest, quality.visualDigest, quality.check, quality.phase, reasons]);
  const reason = reasons.join("; ");
  if (quality.phase === "blocked" || missingCommittedManifest || (deliveryError && !deliveryError.retryable)) {
    return { stop: true, reason, fingerprint, terminal:true };
  }
  if (state.attempts >= 2 || (state.attempts > 0 && state.lastRecovery === fingerprint)) {
    return { stop: true, reason, fingerprint };
  }
  const step = quality.phase === "check"
    ? "Diagnose the earliest failed or missing required check. Inspect its actual error, make a focused fix, run the affected check then standard once. Do not ask for push approval before checks pass."
    : quality.phase === "manifest"
      ? "Prepare valid delivery manifest with CLI prepare-delivery; preserve risk flags and use explicit --e2e only for required platforms. Reuse current checks and evidence."
    : quality.phase === "visual"
      ? "Complete the missing planned runtime evidence on the chosen working platform. Reuse current standard checks. Do not dispatch a reviewer until visual-evidence passes."
    : quality.phase === "review"
      ? "Reuse the successful standard evidence for the unchanged candidate. Inspect the actual prior reviewer findings; fix confirmed defects. If a finding contradicts exact diff/evidence, one unchanged-input adjudication is allowed. Do not change source merely to obtain a new review key; do not retry an exhausted budget."
      : quality.check === "passed"
        ? "The candidate is checked and the manifest is valid. Preserve the existing delivery.json; invoke exactly python3 .flutter-harness/bin/harness.py deliver with owner approval. The CLI reconciles remote state and writes the receipt; do not run separate Git/PR probes, and do not repeat builds, tests or reviews."
        : "Resume the unfinished implementation or plan from current files. Run focused checks on missing behavior, then the required final check; do not publish incomplete work.";
  return { stop: false, reason, fingerprint, prompt:
    "[Flutter Harness recovery] " + reason + ". " + step +
    " Preserve unrelated changes and any task manifest. A failed check is work to fix, not an external blocker. " +
    "Do not escalate to Sol because of failure. If permission is denied or recovery cannot progress, state the exact blocker; preserve work. " +
    "Never bypass checks or claim DONE without a current delivery receipt." };
}
