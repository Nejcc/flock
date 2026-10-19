// Settings → AI: registers Flock's MCP server with AI clients. It's added once and works in every
// project: the server finds the project the agent works in.
import { api, h } from "../app.js";

// GET /v1/mcp, loaded when the pane is first shown and after each change; the status poll doesn't
// carry it.
let mcp = null;
let working = null;
let loading = false;

function field(label, ...content) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), h("div", { class: "grow" }, ...content));
}

async function load(ctx) {
  if (loading) return;
  loading = true;
  try {
    mcp = await api("/v1/mcp");
  } finally {
    loading = false;
  }
  ctx.rerender();
}

function row(ctx, c) {
  let description = { registered: "Flock is added", available: "Installed" }[c.state] || "Not installed";
  if (c.problem) description += " — " + c.problem;
  const add = c.state === "available";
  const button = (c.state === "registered" || add) && h("button", { disabled: working != null, onclick: () => ctx.act(async () => {
    working = c.id;
    ctx.rerender();
    try {
      mcp = await api(`/v1/mcp/clients/${encodeURIComponent(c.id)}`, { method: add ? "POST" : "DELETE" });
    } finally {
      working = null;
    }
  }) }, working === c.id ? "…" : add ? "Add" : "Remove");
  return field(c.name, h("div", { class: "row" }, h("span", { class: "grow muted", title: c.config || "" }, description), button));
}

export default {
  title: "AI",
  subtitle: "Let AI agents like Claude Code and Cursor work with Flock: your sites' URLs and PHP versions, logs, dumps and mail, and installing versions and services.",
  icon: "brain",
  color: "#8b5cf6",
  render(ctx) {
    if (!mcp) load(ctx).catch((err) => ctx.act(() => { throw err; }));
    return h("div", {},
      h("div", { class: "group" }, h("h3", {}, "AI clients"),
        ...(mcp ? mcp.clients.map((c) => row(ctx, c)) : [h("div", { class: "muted" }, "Loading…")]),
        h("div", { class: "hint muted", style: "margin-top:6px" }, "Added once, Flock works in every project. Restart the client, or reload its MCP servers, after adding Flock.")),
      h("div", { class: "group" }, h("h3", {}, "Other clients"),
        h("pre", { class: "card mono selectable", style: "margin:0; padding:10px 12px; white-space:pre-wrap" }, mcp?.snippet || ""),
        h("div", { class: "hint muted", style: "margin-top:6px" }, "Add this to the client's MCP settings.")));
  },
};
