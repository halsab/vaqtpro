// Resolve the selected agent from the live session, never from prompt wording
// or stale task state. No Harness hooks run for standalone non-Build agents.
export function buildOnly(ctx) {
  function scoped(domain, relevant = () => true) {
    return {
      hook: (name, handler) => domain.hook(name, async event => {
        if (!relevant(event)) return;
        if (event.agent != null && event.agent !== "build") return;
        const session = await ctx.session.get({sessionID: event.sessionID});
        if (session?.agent !== "build" || session.parentID) return;
        return handler(event);
      }),
    };
  }
  return {
    storage: ctx.storage,
    session: {
      ...scoped(ctx.session),
      get: args => ctx.session.get(args),
      context: args => ctx.session.context(args),
      synthetic: args => ctx.session.synthetic(args),
    },
    tool: scoped(ctx.tool, event => ["shell", "subagent"].includes(event.tool)),
    permission: scoped(ctx.permission, event => event.action === "shell"),
  };
}
