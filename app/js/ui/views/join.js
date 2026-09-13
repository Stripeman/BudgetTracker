// Joining a workspace from an invitation link: preview what the role allows, then accept.
// The invitation only works for the Google account it was sent to.
import { el, mount } from "../dom.js";
import { button } from "../components.js";

export function createView(ctx) {
  const box = el("div", { role: "status", text: "Checking the invitation…" });
  const element = el("section", { class: "landing" }, [el("h1", { text: "Workspace invitation" }), box]);
  const body = { workspaceId: ctx.params.ws, token: ctx.params.token };
  (async () => {
    try {
      const pv = await ctx.api.previewInvitation(body);
      const accept = button(`Join ${pv.workspace.name}`, async () => {
        accept.disabled = true;
        try {
          const out = await ctx.api.acceptInvitation(body);
          const me = await ctx.api.me();
          void me;
          await ctx.store.actions.init();
          await ctx.store.actions.selectWorkspace(out.workspaceId);
          ctx.navigate("dashboard");
        } catch (err) { accept.disabled = false; mount(box, el("p", { class: "error-text", role: "alert", text: err.message })); }
      }, { variant: "primary" });
      mount(box,
        el("p", { text: `You are invited to “${pv.workspace.name}” as ${pv.role}.` }),
        el("p", { class: "notice", text: pv.summary }),
        el("p", { class: "muted small", text: `This invitation expires on ${pv.expiresAt.slice(0, 10)}.` }),
        accept);
    } catch (err) {
      mount(box, el("p", { class: "error-text", role: "alert", text: "This invitation is not valid for your account. It may have expired, been revoked, or been sent to a different Google account." }));
    }
  })();
  return { element, update() {} };
}
