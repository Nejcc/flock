// Settings → Sites: every site in a table, as on flockphp.com: its address, the PHP and Node.js
// pickers, HTTPS, and actions. Each picker offers the project's pin (or the default) first, then
// the installed versions, which isolate the site on this machine. The pin button opens the row's
// details: pinning into the project, extra domains, the server, and removing the site.
import { api, app, h, openURL } from "../app.js";
import { icon } from "../icons.js";

let expanded = null;

const site = (name) => `/v1/sites/${encodeURIComponent(name)}`;
const css = `
  table.sites { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
  table.sites td.name > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.sites th { text-align: left; font-weight: 500; color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--line); }
  table.sites td { padding: 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.sites tr:last-child td { border-bottom: none; }
  table.sites td.name strong { font-weight: 650; }
  table.sites select { width: 100%; }
  table.sites .addr { display: flex; align-items: center; gap: 4px; }
  table.sites .addr .icon { color: var(--ok); }
  table.sites .actions { white-space: nowrap; text-align: right; }
  table.sites tr.details td { background: color-mix(in srgb, var(--bg) 50%, transparent); padding: 4px 12px 14px; }
  .detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 10px 14px; align-items: center; }
  .detail-grid > .k { color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 2px 1px 9px; border: 1px solid var(--line-strong); border-radius: 12px; }
  .footnote { margin: 10px 4px; color: var(--muted); font-size: 12px; }
  .footnote code { font-family: var(--mono); color: var(--fg); }
`;

function picker(ctx, s, tool, installed, fallback) {
  const source = s[`${tool}_source`];
  const current = s[tool] || "";
  const pinned = s[`${tool}_pinned`];
  const file = s[`${tool}_file`];
  const name = tool === "php" ? "PHP" : "Node";

  const follow = pinned && file ? `Project (${name} ${pinned})` : `Default${fallback ? ` (${name} ${fallback})` : ""}`;
  const versions = [...installed];
  if (source === "isolated" && current && !versions.includes(current)) versions.push(current);
  const select = h("select", { title: pinned && file ? `Pinned in ${file}` : "" },
    h("option", { value: "" }, follow),
    ...versions.map((v) => h("option", { value: v, selected: source === "isolated" && v === current }, `${name} ${v}`)));
  select.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { [tool]: select.value } })));
  return select;
}

function pinActions(ctx, s, tool) {
  const name = tool === "php" ? "PHP" : "Node.js";
  const current = s[tool];
  const file = s[`${tool}_file`];
  return h("div", { class: "row" },
    current && s[`${tool}_source`] !== "project" &&
      h("button", { onclick: () => ctx.act(() => api(`${site(s.name)}/pin`, { method: "POST", body: { tool, version: current } })) }, `Pin ${name} ${current}`),
    s[`${tool}_pinned`] && file &&
      h("button", { onclick: () => ctx.act(() => api(`${site(s.name)}/pin/${tool}`, { method: "DELETE" })) }, `Unpin from ${file}`),
    !current && !s[`${tool}_pinned`] && h("span", { class: "muted" }, `No ${name} version yet`));
}

function details(ctx, s) {
  const tld = ctx.config.tld;
  const input = h("input", { type: "text", placeholder: `tenant1 or app-2.${tld}` });
  const add = () => input.value.trim() &&
    ctx.act(() => api(`${site(s.name)}/domains`, { method: "POST", body: { domain: input.value.trim() } }));
  input.addEventListener("keydown", (e) => e.key === "Enter" && add());

  const server = h("select", {},
    h("option", { value: "fastcgi", selected: s.server !== "frankenphp" }, "PHP-FPM"),
    h("option", { value: "frankenphp", selected: s.server === "frankenphp" }, "FrankenPHP"));
  server.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { server: server.value } })));
  const worker = h("select", { disabled: s.server !== "frankenphp" || (!s.octane_available && s.worker !== "octane") },
    h("option", { value: "", selected: s.worker !== "octane" }, "Classic"),
    h("option", { value: "octane", selected: s.worker === "octane" }, "Laravel Octane"));
  worker.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { worker: worker.value } })));
  const fp = s.frankenphp;

  return h("tr", { class: "details" }, h("td", { colspan: 5 }, h("div", { class: "detail-grid" },
    h("span", { class: "k" }, "Pin in the project"), h("div", { class: "row" }, pinActions(ctx, s, "php"), pinActions(ctx, s, "node")),
    h("span", { class: "k" }, "Extra domains"), h("div", {},
      (s.domains || []).length > 0 && h("div", { class: "chips", style: "margin-bottom:6px" }, ...s.domains.map((d) =>
        h("span", { class: "chip", title: d.problem || "" }, (d.problem ? "⚠ " : "") + d.host + (d.alias ? " (alias)" : ""),
          h("button", { class: "ghost", title: "Remove", onclick: () => ctx.act(() => api(`${site(s.name)}/domains/${encodeURIComponent(d.entry)}`, { method: "DELETE" })) }, "×")))),
      h("div", { class: "row" }, input, h("button", { onclick: add }, "Add"))),
    h("span", { class: "k" }, "Server"), h("div", { class: "row" }, server, worker,
      fp && h("span", { class: "muted" }, fp.problem || [fp.state, fp.version].filter(Boolean).join(" · ")),
      fp && h("button", { onclick: () => ctx.act(() => api(`${site(s.name)}/restart`, { method: "POST" })) }, "Restart")),
    !s.parked && h("span", { class: "k" }, ""),
    !s.parked && h("div", {}, h("button", { onclick: () => confirm(`Stop serving ${s.domain}? The folder stays as it is.`) &&
      ctx.act(() => api(site(s.name), { method: "DELETE" })) }, "Remove Site")))));
}

function row(ctx, s, cfg) {
  const secured = h("input", { type: "checkbox", checked: s.secured, title: "HTTPS with Flock's local certificate" });
  secured.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { secured: secured.checked } })));
  const url = s.url || `http://${s.domain}`;
  const home = (p) => p.replace(/^\/home\/[^/]+/, "~");

  return h("tr", {},
    h("td", { class: "name" },
      h("div", { class: "row" }, h("strong", {}, s.name), s.parked && h("span", { class: "tag" }, "Project folder")),
      h("div", { class: "addr" }, s.secured && icon("lock", 13), h("button", { class: "link", onclick: () => openURL(url) }, url.replace(/\/$/, ""))),
      h("div", { class: "mono muted ellipsis", title: s.path }, home(s.path)),
      ...(s.domains || []).map((d) => h("div", {}, h("button", { class: "link", onclick: () => d.url && openURL(d.url) }, d.host + (d.alias ? " (alias)" : "")))),
      s.problem && h("div", { style: "color: var(--warn); margin-top: 2px" }, s.problem)),
    h("td", {}, picker(ctx, s, "php", (cfg.php || []).map((p) => p.version), cfg.default_php)),
    h("td", {}, picker(ctx, s, "node", cfg.node || [], cfg.default_node)),
    h("td", {}, secured),
    h("td", { class: "actions" },
      h("button", { class: "ghost", title: "Open in the browser", onclick: () => openURL(url) }, icon("compass", 17)),
      h("button", { class: "ghost", title: "Show the folder", onclick: () => app("folder?path=" + encodeURIComponent(s.path)) }, icon("folder", 17)),
      h("button", { class: "ghost", title: "Pins, domains and server", style: expanded === s.name ? "color: var(--accent)" : "",
        onclick: () => { expanded = expanded === s.name ? null : s.name; ctx.rerender(); } }, icon("pin", 17))));
}

export default {
  title: "Sites",
  subtitle: "Sites you added one by one, plus every folder inside your project folders.",
  icon: "world",
  color: "#3b82f6",
  actions: (ctx) => h("button", { onclick: async () => {
    const res = await fetch("/app/pick-folder?title=Add%20a%20site", { method: "POST" });
    const path = (await res.text()).trim();
    if (path) ctx.act(() => api("/v1/sites", { method: "POST", body: { path } }));
  } }, "Add Site…"),
  render(ctx) {
    const cfg = ctx.config;
    const sites = [...(ctx.status.sites || [])].sort((a, b) => a.name.localeCompare(b.name));
    if (!sites.length) {
      return h("div", { class: "empty" }, "No sites yet. Add one here, or add a project folder in General.");
    }
    return h("div", {},
      h("style", {}, css),
      h("div", { class: "card" }, h("table", { class: "sites" },
        h("colgroup", {}, h("col", {}), h("col", { style: "width:22%" }), h("col", { style: "width:22%" }), h("col", { style: "width:72px" }), h("col", { style: "width:112px" })),
        h("thead", {}, h("tr", {}, h("th", {}, "Site"), h("th", {}, "PHP"), h("th", {}, "Node"), h("th", {}, "HTTPS"), h("th", {}))),
        h("tbody", {}, ...sites.flatMap((s) => [row(ctx, s, cfg), expanded === s.name && details(ctx, s)])))),
      h("p", { class: "footnote" }, "A version picked here applies on this machine only. To set it for everyone working on a project, pin it: PHP goes into ",
        h("code", {}, ".flockrc"), ", Node.js into ", h("code", {}, ".nvmrc"), "."));
  },
};
