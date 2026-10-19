// Settings → Dumps: capturing dump() and dd() output and the events of the PHP agent (queries,
// logs, views, jobs, requests), and which editor a dump's file opens in.
import { api, h, openWindow } from "../app.js";

// The kinds the daemon captures (internal/capture.Kinds), in its order.
const kinds = [["query", "Queries"], ["log", "Logs"], ["view", "Views"], ["job", "Jobs"], ["request", "Requests"]];
// The editors a dump's file and line open in; the Dumps window reads the same key.
const editors = [["phpstorm", "PhpStorm"], ["vscode", "VS Code"], ["cursor", "Cursor"], ["zed", "Zed"], ["none", "Don't link"]];
export const editorKey = "dumps.editor";

function field(label, ...content) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), h("div", { class: "grow" }, ...content));
}

function checkbox(checked, onchange, disabled) {
  const box = h("input", { type: "checkbox", checked, disabled });
  box.addEventListener("change", () => onchange(box.checked));
  return box;
}

const settings = (ctx, body) => ctx.act(() => api("/v1/settings", { method: "POST", body }));

export default {
  title: "Dumps",
  subtitle: "Send dump() and dd() output, queries, logs, views and jobs to Flock instead of the page or terminal — no changes to your projects.",
  icon: "code",
  color: "#f59e0b",
  render(ctx) {
    const st = ctx.status;
    const capturing = st.dumps;
    const off = st.capture_off || [];
    const unsupported = st.capture_unsupported || [];

    let editor = "phpstorm";
    try { editor = localStorage.getItem(editorKey) || editor; } catch {}
    const select = h("select", {}, ...editors.map(([id, name]) => h("option", { value: id, selected: id === editor }, name)));
    select.addEventListener("change", () => { try { localStorage.setItem(editorKey, select.value); } catch {} });

    return h("div", {},
      h("div", { class: "group" },
        field("Capture", h("label", { class: "row" }, checkbox(capturing, (on) => settings(ctx, { dumps: on })), "Capture dumps and events"),
          h("div", { class: "hint" }, "Turn it off to see dumps in the page again.")),
        field("Captured", h("div", { class: "row" },
          h("span", { class: "grow" }, `${st.dump_count || 0} dumps, ${st.event_count || 0} events`),
          h("button", { onclick: () => openWindow("dumps") }, "Open Dumps")))),
      h("div", { class: "group" }, h("h3", {}, "While capturing"),
        ...kinds.map(([kind, name]) => field(name, h("label", { class: "row" },
          checkbox(!off.includes(kind), (on) => settings(ctx, { capture_off: on ? off.filter((k) => k !== kind) : [...off, kind] }), !capturing),
          `Capture ${name.toLowerCase()}`))),
        field("dump() in the page", h("label", { class: "row" },
          checkbox(st.dumps_in_page, (on) => settings(ctx, { dumps_in_page: on }), !capturing), "Show dump() output in the page too")),
        h("div", { class: "hint muted", style: "margin-top:6px" }, "dd() always shows in the page too, as it ends the request." +
          (unsupported.length ? ` PHP ${unsupported.join(", ")} only ${unsupported.length === 1 ? "captures" : "capture"} dumps: ${unsupported.length === 1 ? "its build has" : "their builds have"} no agent extension yet.` : ""))),
      h("div", { class: "group" }, h("h3", {}, "Sources"),
        field("Open files in", select, h("div", { class: "hint" }, "Used when clicking a dump's file and line."))));
  },
};
