// Settings → General: the daemon, opening at login, the update channel, the network and the
// project folders whose subfolders are served as sites.
import { api, app, ago, h, pickFolder } from "../app.js";

function field(label, ...content) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), h("div", { class: "grow" }, ...content));
}

function checkbox(checked, onchange) {
  const box = h("input", { type: "checkbox", checked });
  box.addEventListener("change", () => onchange(box.checked));
  return box;
}

export default {
  title: "General",
  icon: "settings",
  color: "#64748b",
  render(ctx) {
    const st = ctx.status;
    const cfg = ctx.config;
    const dns = st.dns || {};

    // Read when the pane is built; it only changes from here.
    const login = checkbox(false, (on) => ctx.act(() => app("autostart?on=" + (on ? 1 : 0))));
    fetch("/app/autostart").then((r) => { login.checked = r.ok; });

    const restart = h("button", { onclick: async () => {
      restart.disabled = true;
      restart.textContent = "Restarting…";
      await ctx.act(() => app("restart"));
    } }, "Restart Flock");

    const parked = cfg.parked || [];
    return h("div", {},
      h("div", { class: "group" }, h("h3", {}, "Flock"),
        field("Daemon", h("div", { class: "row" },
          h("span", { class: "grow" }, `Running · ${/^\d/.test(st.version) ? "v" : ""}${st.version} · pid ${st.pid} · started ${ago(st.started_at)}`), restart)),
        field("Open at login", h("label", { class: "row" }, login, "Start the Flock app in the tray when you log in")),
        field("Updates", h("label", { class: "row" },
          checkbox(st.channel === "beta", (on) => ctx.act(() => api("/v1/settings", { method: "POST", body: { channel: on ? "beta" : "stable" } }))),
          "Get beta versions"),
          h("div", { class: "hint" }, "On Linux, update with your package manager or install.sh; the channel also picks betas there."))),

      h("div", { class: "group" }, h("h3", {}, "Network"),
        field("Domains", h("span", { class: "mono" }, `*.${cfg.tld}`),
          h("div", { class: "hint" }, dns.wildcard ? `Every name under .${cfg.tld} resolves to Flock (DNS on ${dns.addr}).` : dns.wildcard_problem || "")),
        field("Ports", h("span", { class: "mono" }, `http :${st.http_port} · https :${st.https_port} · smtp ${st.mail || "—"}`))),

      h("div", { class: "group" }, h("h3", {}, "Project folders"),
        h("div", { class: "hint muted", style: "margin-bottom:6px" }, `Every folder inside a project folder is served as <folder>.${cfg.tld}.`),
        ...parked.map((path) => h("div", { class: "field" },
          h("span", { class: "grow mono selectable ellipsis" }, path),
          h("button", { onclick: () => app("folder?path=" + encodeURIComponent(path)) }, "Show"),
          h("button", { onclick: () => ctx.act(() => api("/v1/parked", { method: "DELETE", body: { path } })) }, "Remove"))),
        h("div", { style: "margin-top:8px" }, h("button", { onclick: async () => {
          const path = await pickFolder("Add a project folder");
          if (path) ctx.act(() => api("/v1/parked", { method: "POST", body: { path } }));
        } }, "Add Project Folder…"))),

      h("div", { class: "group" }, h("h3", {}, "Data"),
        field("Folder", h("div", { class: "row" }, h("span", { class: "grow mono selectable ellipsis" }, cfg.root),
          h("button", { onclick: () => app("folder?path=" + encodeURIComponent(cfg.root)) }, "Show")))));
  },
};
