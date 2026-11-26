import { randomUUID } from "node:crypto";
import { changed, recovery, taskIntent } from "./guard.mjs";

// A conversation may contain successive tasks. Serialize boundary transitions.
export function taskLifecycle(ctx, deps) {
  const key = id => "task/" + id;
  const queues = new Map();
  async function locked(id, fn) {
    const prior = queues.get(id) || Promise.resolve();
    const next = prior.catch(()=>{}).then(fn);
    queues.set(id,next);
    try { return await next; }
    finally { if (queues.get(id)===next) queues.delete(id); }
  }
  const get = id => ctx.storage.get(key(id));
  const set = (id, state) => ctx.storage.set(key(id),state);

  async function close(id,state,receipt=null) {
    // Persist completion before best-effort archival.
    const parked=receipt?.status==="DRAFT_SAVED";
    const closed={...state,active:false,completedAt:Date.now(),
      outcome:parked?"DRAFT_SAVED":receipt?"PASS":"NOOP",
      lastCompletedBranch:(!parked && receipt?.branch) || state.lastCompletedBranch,
      lastParkedBranch:parked?receipt.branch:state.lastParkedBranch};
    await set(id,closed);
    try {
      await deps.saveSessions(id,closed);
      await deps.record(id,parked?"task-parked":receipt?"task-complete":"task-noop",
        {attempts:state.attempts,...(receipt?{branch:receipt.branch,pr:receipt.pr}:{})});
      if (receipt) await deps.archive(closed);
    } catch { /* diagnostic storage cannot undo verified delivery */ }
    await deps.quality.clear(id,state);
    await deps.resources.clear(id,state);
  }

  async function finish(id,state) {
    if (!state?.active) return false;
    if (state.deliveryAttempt) {
      const receipt=await deps.completion();
      const attempt=state.deliveryAttempt;
      if (receipt?.status==="PASS" && receipt.branch===attempt.branch &&
          receipt.digest===attempt.digest && receipt.checked_at===attempt.checked_at &&
          Number.isInteger(receipt.delivered_at) &&
          receipt.delivered_at>=Math.floor(attempt.at/1000) &&
          receipt.branch!==state.lastCompletedBranch &&
          (state.baseline.branch===receipt.branch || changed(state.baseline,{head:receipt.head,branch:receipt.branch,status:"",digest:receipt.digest}))) {
        await close(id,state,receipt);
        return true;
      }
    }
    if (state.draftAttempt && deps.draftCompletion) {
      const draft=await deps.draftCompletion();
      const attempt=state.draftAttempt;
      if (draft?.status==="DRAFT_SAVED" && draft.branch===attempt.branch &&
          draft.head===attempt.head && draft.digest===attempt.digest &&
          Number.isInteger(draft.saved_at) && draft.saved_at>=attempt.at) {
        await close(id,state,draft);
        return true;
      }
    }
    return false;
  }

  // A task which never began and never changed the checkout has no delivery
  // candidate to protect. Retire it as NOT_STARTED, never as a successful no-op.
  // Keep the generation and all budgets for any actually begun/changed task.
  async function unstarted(id,state,current,begin) {
    return !state.begun && !state.deliveryAttempt && !begin &&
      !changed(state.baseline,current) && !(await deps.resources.status(id)) &&
      (!deps.resources.sessions || (await deps.resources.sessions(id,state)).length===1);
  }

  async function retireUnstarted(id,state,reason) {
    const retired={...state,active:false,outcome:"NOT_STARTED",completedAt:Date.now()};
    await set(id,retired);
    await deps.record(id,"task-not-started",{reason,attempts:state.attempts});
    await deps.saveSessions(id,retired);
    await deps.quality.clear(id,state);
    await deps.resources.clear(id,state);
  }

  async function prompt(event) {
    const id=event.sessionID;
    return locked(id,async()=>{
      await deps.assertRevision();
      const previous=await get(id);
      if (previous?.active && !(await finish(id,previous))) {
        // Explicit owner retry after a failed start. Never reset a begun task.
        if (!previous.attempts || !(await unstarted(id,previous,await deps.snapshot(),await deps.lastBegin(previous)))) return;
        await retireUnstarted(id,previous,"Owner retried an unchanged task that never began");
      }
      const prior=await get(id);
      const state={id:randomUUID(),active:true,intent:taskIntent(event.prompt?.text),
        request:event.prompt?.text || "",baseline:await deps.snapshot(),startedAt:Date.now(),
        attempts:0,lastCompletedBranch:prior?.lastCompletedBranch,lastParkedBranch:prior?.lastParkedBranch};
      await set(id,state);
      await deps.record(id,"task-start");
      await deps.saveSessions(id,state);
    });
  }

  // Only invoked after the existing quality gate admits canonical delivery.
  async function authorize(event,task) {
    const id=event.sessionID;
    return locked(id,async()=>{
      const state=await get(id);
      if (!state?.active || state.id!==task.id) throw Error("Harness task changed before delivery");
      if (typeof event.id!=="string" || !event.id) throw Error("Missing canonical delivery call identity");
      const attempt=await deps.deliveryIdentity(state);
      await set(id,{...state,deliveryAttempt:{...attempt,call:event.id,at:Date.now()}});
    });
  }

  async function authorizeDraft(event,task) {
    const id=event.sessionID;
    return locked(id,async()=>{
      const state=await get(id);
      if (!state?.active || state.id!==task.id || !event.id) throw Error("No current task for draft");
      const snap=await deps.snapshot();
      if (snap.status) throw Error("Checkpoint coherent work before saving a draft");
      await set(id,{...state,draftAttempt:{branch:snap.branch,head:snap.head,digest:snap.digest,call:event.id,at:Date.now()}});
    });
  }

  async function delivered(event) {
    if (event.tool!=="shell") return;
    const id=event.sessionID;
    return locked(id,async()=>{
      const state=await get(id);
      if (!state?.active || (state.deliveryAttempt?.call!==event.id && state.draftAttempt?.call!==event.id) ||
          event.status!=="completed" || event.result?.metadata?.exit!==0) return;
      await finish(id,state);
    });
  }

  async function idle(event) {
    const id=event.sessionID;
    return locked(id,async()=>{
      let state=await get(id);
      if (!state?.active || event.background?.some(work=>work.sessionID===id)) return;
      if (await finish(id,state)) return;
      const result=await deps.inspect(state);
      const begin=await deps.lastBegin(state);
      if (begin?.stage==="begin" && !state.begun) {
        state={...state,begun:true};
        await set(id,state);
      }
      if (begin?.stage==="begin-blocked" && /different Harness revision|Dirty checkout|Unsafe feature branch/.test(begin.reason || "")) {
        await deps.saveSessions(id,state);
        await deps.record(id,"task-incomplete",{phase:"prerequisite",reason:begin.reason});
        return; // An unfinished task keeps its budget.
      }
      // Do not demand checks/review/delivery from a task that has not begun.
      if (state.intent && await unstarted(id,state,result.current,begin)) {
        if (state.attempts) {
          await retireUnstarted(id,state,"Build did not start the task after one explicit start reminder");
          return;
        }
        await set(id,{...state,attempts:1});
        await deps.record(id,"task-recovery",{attempts:0,phase:"begin",reason:"No task work recorded"});
        return "[Flutter Harness start reminder] You are the selected root Build implementation agent, not Reviewer or Plan. Implement the owner's agreed task. First run canonical begin on a new feature branch; do not run check, review or deliver before starting. If an actual tool or permission prevents that, report the specific error. Do not ask the owner to switch to Build.";
      }
      // Read-only conversation is not an unfinished development task.
      if (!result.active && !begin && !state.deliveryAttempt && !state.attempts) {
        if (!(await deps.resources.status(id))) await close(id,state);
        return;
      }
      const evidence=await deps.quality.status(id);
      if (evidence.phase==="waiting") return;
      if (result.active && result.passed && !evidence.issue)
        throw Error("Harness: no current authorized delivery receipt for this task; use canonical deliver.");
      const next=recovery(state,result,evidence);
      await deps.saveSessions(id,state);
      await deps.record(id,next.stop?"task-incomplete":"task-recovery",
        {attempts:state.attempts,phase:evidence.phase,check:evidence.check,
          deliveryError:result.deliveryError?.code,failedStage:result.deliveryError?.stage});
      if (next.stop) {
        if (state.finalReminder) return;
        const hasWork=state.begun && (result.current.digest!==state.baseline.digest || result.current.head!==state.baseline.head || !!result.current.status);
        await set(id,{...state,finalReminder:true});
        const preserve=hasWork && (!result.deliveryError || (result.deliveryError.code==="DELIVERY_INVARIANT" && result.deliveryError.stage==="delivery-started"))
          ? "Stop verification now. Checkpoint coherent work if dirty and offer canonical save-draft with owner approval; report DRAFT_SAVED only after the actual verified receipt, never DONE."
          : "Stop verification now. Preserve work and report INCOMPLETE, the exact blocker and the next owner action. Do not retry or bypass an identity/permission error.";
        return "[Flutter Harness final recovery] "+next.reason+". "+preserve;
      }
      await set(id,{...state,attempts:state.attempts+1,lastRecovery:next.fingerprint});
      return next.prompt;
    }).then(async next=>{if(next)await ctx.session.synthetic({sessionID:id,text:next});});
  }
  return {prompt,authorize,authorizeDraft,delivered,idle};
}
