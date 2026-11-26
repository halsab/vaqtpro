import { reviewVerdict, canonicalReviewRecovery } from "./quality.mjs";

// Bound actual child dispatches, not model tokens. Use OpenCode session
// outcome as execution evidence; a worker's text is not completion.
export async function registerResourceGuard(ctx, taskKey, reviewInputs, prepareReview, record = async()=>{}) {
  const key = (id,task) => "resources/" + id + "/" + task.id;
  const currentTask = id => ctx.storage.get(taskKey(id));
  const queues = new Map();
  async function locked(id, fn) {
    const prior = queues.get(id) || Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    queues.set(id, next);
    try { return await next; }
    finally { if (queues.get(id) === next) queues.delete(id); }
  }
  async function read(id,task) {
    task ||= await currentTask(id);
    return (task?.id && await ctx.storage.get(key(id,task))) || { children: [], pending: [] };
  }
  async function running(id, state) {
    const active = [];
    for (const c of state.children || []) {
      const session = await ctx.session.get({ sessionID:c.id });
      if (session.parentID !== id) throw Error("Unexpected child session ownership");
      if (!["succeeded","failed","canceled","cancelled","aborted"].includes(session.outcome)) active.push(c);
    }
    return active;
  }
  async function status(id) {
    return locked(id, async()=>{
      const state = await read(id);
      if ((state.pending || []).length) return "A child dispatch has not returned its actual session ID/outcome.";
      if ((await running(id,state)).length) return "Wait for actual child session completion before delivery.";
      return "";
    });
  }
  async function budget(id, state, key) {
    const attempts = state.reviews || [];
    if ((state.pending || []).some(x=>x.role==="reviewer") ||
        (await running(id,state)).some(x=>x.role==="reviewer")) return "Wait for the actual reviewer outcome.";
    const outcomes = [];
    for (const attempt of attempts) {
      if (!attempt.childID) { outcomes.push("ERROR"); continue; }
      const child = await ctx.session.get({sessionID:attempt.childID});
      if (child.parentID !== id) throw Error("Unexpected reviewer ownership");
      outcomes.push(child.outcome === "succeeded" ?
        reviewVerdict(await ctx.session.context({sessionID:attempt.childID})) : "ERROR");
    }
    const last = attempts.at(-1);
    const lastOutcome = outcomes.at(-1);
    if (attempts.some(x=>x.key===key) && !(last?.key===key && lastOutcome==="ERROR")) {
      if (last?.key===key && lastOutcome==="CHANGES_REQUIRED" && attempts.length===1 && !last.dispute) return "";
      return "Harness: reviewer input unchanged; confirmed or unresolved findings must be fixed; no further unchanged-input review.";
    }
    // Three substantive passes (initial plus two repairs), one technical
    // recovery and one dispute remain finite. Never rerun identical evidence.
    if (state.recoveryGranted?.key===key && !state.recoveryUsed) return "";
    if (attempts.length >= 5) return "Harness: reviewer absolute attempt budget exhausted.";
    if (outcomes.filter((x,i)=>!attempts[i].dispute && (x==="PASS" || x==="CHANGES_REQUIRED")).length >= 3)
      return "Harness: substantive reviewer attempt budget exhausted.";
    if (outcomes.filter(x=>x==="BLOCKED" || x==="ERROR").length >= 2)
      return "Harness: technical reviewer recovery budget exhausted.";
    return "";
  }
  async function reviewAvailability(id, key) {
    return locked(id, async()=>budget(id,await read(id),key));
  }
  const recoveryCalls=new Map();
  await ctx.tool.hook("execute.before", async event => {
    if (event.tool==="shell" && canonicalReviewRecovery(event.input?.command)) {
      const id=event.sessionID;
      await locked(id,async()=>{
        const task=await currentTask(id);
        if (!task?.active || !task.id) throw Error("No active task for recovery");
        const state=await read(id,task);
        if (state.recoveryGranted || state.recoveryUsed) throw Error("Owner recovery already granted or used");
        const input=await reviewInputs(id);
        const why=await budget(id,state,input.key);
        if (!why.includes("budget exhausted")) throw Error("Review recovery only applies to exhausted budgets for changed or recoverable inputs");
        recoveryCalls.set(id,{call:event.id,task:task.id,key:input.key});
      });
      return;
    }
    if (event.tool !== "subagent") return;
    const role = event.input?.agent;
    const id = event.sessionID;
    const session = await ctx.session.get({ sessionID:id });
    if (session.parentID) throw Error("Harness: only the task parent may delegate.");

    const explicitSol = typeof event.input?.model === "string" && /^openai\/gpt-6\.2-sol(?:#|$)/.test(event.input.model);
    if (explicitSol && role !== "advisor") throw Error("Harness: Sol is reserved for the focused advisor.");
    await locked(id, async () => {
      const task = await currentTask(id);
      if (!task?.active || !task.id) throw Error("No active root task for delegation");
      const state = await read(id,task);
      const active = await running(id,state);
      const pending = state.pending || [];
      if (!["reviewer","architect","advisor"].includes(role)) throw Error("Harness: one implementation agent; only read-only consultations allowed.");
      if (active.length || pending.length) throw Error("Harness: wait for the current read-only consultation to finish.");
      if (role === "advisor") {
        if ((state.advisor || 0) >= 1) throw Error("Harness: advisor attempt budget exhausted.");
        state.advisor = (state.advisor || 0) + 1;
      }
      if (typeof event.id !== "string" || !event.id) throw Error("Missing child dispatch identifier");
      if (role === "reviewer") {
        // Admission before spending a dispatch. Inputs include actual check
        // state, current source and required visual evidence.
        const input = await reviewInputs(id);
        const why = await budget(id,state,input.key);
        if (why) throw Error(why);
        const prior=(state.reviews || []).at(-1);
        if (prior?.key===input.key && prior.childID && !prior.dispute) {
          const messages=await ctx.session.context({sessionID:prior.childID});
          if (reviewVerdict(messages)==="CHANGES_REQUIRED") {
            const final=[...messages].reverse().find(m=>m.type==="assistant" && (typeof m.content==="string" ? m.content.trim() : m.content?.some(x=>x.type==="text" && x.text.trim())));
            const report=typeof final?.content==="string" ? final.content : final?.content?.filter(x=>x.type==="text").map(x=>x.text).join("\n");
            if (!report || report.length>16000) throw Error("Prior review report missing or oversized; preserve findings for owner");
            input.dispute={childID:prior.childID,report};
          }
        }
        if (prior?.childID && prior.key!==input.key && prior.files && input.v?.change?.fileDigests) {
          const child=await ctx.session.get({sessionID:prior.childID});
          if (child.parentID!==id) throw Error("Unexpected reviewer ownership");
          const messages=await ctx.session.context({sessionID:prior.childID});
          const verdict=reviewVerdict(messages);
          const final=[...messages].reverse().find(m=>m.type==="assistant" && (typeof m.content==="string" ? m.content.trim() : m.content?.some(x=>x.type==="text" && x.text.trim())));
          const report=typeof final?.content==="string" ? final.content : final?.content?.filter(x=>x.type==="text").map(x=>x.text).join("\n");
          if (child.outcome==="succeeded" && ["CHANGES_REQUIRED","PASS"].includes(verdict) && report && report.length<=16000 && /(?:^|\n)COVERAGE: COMPLETE\s*$/m.test(report)) {
            const next=input.v.change.fileDigests;
            const changed=[...new Set([...Object.keys(prior.files),...Object.keys(next)])].filter(p=>prior.files[p]!==next[p]);
            input.followup={report,changed,visualChanged:prior.visualDigest!==input.visual?.evidence_digest};
          }
        }
        await prepareReview(event,input);
        if (state.recoveryGranted?.key===input.key) state.recoveryUsed=true;
        state.reviews = [...(state.reviews || []),{call:event.id,key:input.key,dispute:!!input.dispute,files:input.v?.change?.fileDigests,visualDigest:input.visual?.evidence_digest}];
        await record(id,"review-dispatched",{call:event.id,model:event.input.model});
      }
      if (role === "advisor") event.input = {...event.input, model:"openai/gpt-6.2-sol#medium"};
      state.pending = [...pending,{call:event.id,role}];
      await ctx.storage.set(key(id,task),state);
    });
  });
  await ctx.tool.hook("execute.after", async event => {
    if (event.tool==="shell" && recoveryCalls.get(event.sessionID)?.call===event.id) {
      const id=event.sessionID;
      await locked(id,async()=>{
        const pending=recoveryCalls.get(id);
        if (pending?.call!==event.id) return;
        recoveryCalls.delete(id);
        if (event.status!=="completed" || event.result?.metadata?.exit!==0) return;
        const task=await currentTask(id);
        if (!task?.active || task.id!==pending.task) return;
        const state=await read(id,task);
        const input=await reviewInputs(id);
        if (input.key!==pending.key || state.recoveryGranted || state.recoveryUsed || !(await budget(id,state,input.key)).includes("budget exhausted")) return;
        state.recoveryGranted={key:input.key};
        await ctx.storage.set(key(id,task),state);
        await record(id,"review-owner-recovery-granted");
      });
      return;
    }
    if (event.tool !== "subagent") return;
    const id = event.sessionID;
    await locked(id, async()=>{
      const task=await currentTask(id);
      if (!task?.active || !task.id) return;
      const state = await read(id,task);
      const pending = (state.pending || []).find(x=>x.call===event.id);
      if (!pending) return;
      const childID = event.result?.output?.sessionID || event.result?.metadata?.sessionID;
      // A completed dispatch without a session ID cannot prove completion.
      if (event.status === "completed" && !childID) return;
      state.pending = state.pending.filter(x=>x.call!==event.id);
      if (pending.role === "reviewer") state.reviews = (state.reviews || []).map(x=>x.call===event.id?{...x,childID}:x);
      if (typeof childID === "string" && childID && !(state.children || []).some(x=>x.id===childID)) {
        state.children = [...(state.children || []),{id:childID,role:pending.role}];
      }
      await ctx.storage.set(key(id,task),state);
      if (pending.role==="reviewer") await record(id,"review-returned",{call:event.id,child:childID || null,status:event.status});
    });
  });
  return {
    status, reviewAvailability,
    sessions: async (id,task) => [id,...(await read(id,task)).children.map(x=>x.id)],
    clear: (id,task) => locked(id, async()=>{task ||= await currentTask(id);if(task?.id)await ctx.storage.remove(key(id,task));})
  };
}
