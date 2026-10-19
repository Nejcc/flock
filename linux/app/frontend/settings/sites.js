// Settings → Sites: the sites in a list and the selected one's details, like the other apps. Each
// version picker offers the project's pin (or the default) first, then the installed versions,
// which isolate the site on this machine.
import { api, app, h, openURL, pickFolder } from "../app.js";

let selection = null;

const site = (name) => `/v1/sites/${encodeURIComponent(name)}`;

function field(label, ...content) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), h("div", { class: "grow" }, ...content));
}

function versionPicker(ctx, s, tool, installed, fallback) {
  const source = s[`${tool}_source`];
  const current = s[tool] || "";
  const pinned = s[`${tool}_pinned`];
  const file = s[`${tool}_file`];
  const name = tool === "php" ? "PHP" : "Node.js";

  const follow = pinned && file ? `Project: ${pinned} (${file})` : `Default${fallback ? ` (${fallback})` : ""}`;
  const versions = [...installed];
  if (source === "isolated" && current && !versions.includes(current)) versions.push(current);

  const select = h("select", {},
    h("option", { value: "" }, follow),
    ...versions.map((v) => h("option", { value: v, selected: source === "isolated" && v === current }, `${name} ${v}`)));
  select.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { [tool]: select.value } })));

  const hint = {
    isolated: `${name} ${current} is set for this site on this machine (isolated).`,
    project: `${name} ${current} is pinned in ${file}, for everyone working on the project.`,
  }[source] || (current ? `${name} ${current}, the default.` : `No ${name} version is installed yet.`);

  const actions = [];
  if (current && source !== "project") {
    actions.push(h("button", { onclick: () => ctx.act(() => api(`${site(s.name)}/pin`, { method: "POST", body: { tool, version: current } })) },
      `Pin ${current} in the project`));
  }
  if (pinned && file) {
    actions.push(h("button", { onclick: () => ctx.act(() => api(`${site(s.name)}/pin/${tool}`, { method: "DELETE" })) }, `Remove the pin from ${file}`));
  }
  return field(name, h("div", { class: "row" }, select, ...actions), h("div", { class: "hint" }, hint));
}

function details(ctx, s) {
  const cfg = ctx.config;
  const domains = s.domains || [];

  const newDomain = h("input", { type: "text", placeholder: "tenant1 or app-2.test" });
  const addDomain = () => newDomain.value.trim() &&
    ctx.act(() => api(`${site(s.name)}/domains`, { method: "POST", body: { domain: newDomain.value.trim() } }));
  newDomain.addEventListener("keydown", (e) => e.key === "Enter" && addDomain());

  const secured = h("input", { type: "checkbox", checked: s.secured });
  secured.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { secured: secured.checked } })));

  const server = h("select", {},
    h("option", { value: "fastcgi", selected: s.server !== "frankenphp" }, "PHP-FPM"),
    h("option", { value: "frankenphp", selected: s.server === "frankenphp" }, "FrankenPHP"));
  server.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { server: server.value } })));
  const worker = h("select", { disabled: s.server !== "frankenphp" || (!s.octane_available && s.worker !== "octane") },
    h("option", { value: "", selected: s.worker !== "octane" }, "Classic"),
    h("option", { value: "octane", selected: s.worker === "octane" }, "Laravel Octane (worker mode)"));
  worker.addEventListener("change", () => ctx.act(() => api(site(s.name), { method: "PATCH", body: { worker: worker.value } })));
  const fp = s.frankenphp;

  return h("div", { class: "grow", style: "overflow:auto; padding: 4px 20px 20px" },
    h("div", { class: "row", style: "margin: 8px 0" },
      h("div", { class: "grow" }, h("h3", { style: "margin:0" }, s.domain), h("div", { class: "muted mono selectable ellipsis" }, s.path)),
      h("button", { onclick: () => openURL(s.url || `http://${s.domain}`) }, "Open"),
      h("button", { onclick: () => app("folder?path=" + encodeURIComponent(s.path)) }, "Show Folder"),
      !s.parked && h("button", { onclick: () => confirm(`Stop serving ${s.domain}? The folder stays as it is.`) &&
        ctx.act(async () => { await api(site(s.name), { method: "DELETE" }); selection = null; }) }, "Remove")),
    s.problem && h("div", { class: "error", style: "margin: 0 0 8px" }, s.problem),
    s.parked && h("div", { class: "hint muted" }, "Served because its folder is in a project folder (General). Changing a setting here adds it as a site of its own."),

    h("div", { class: "group" }, h("h3", {}, "Address"),
      field("HTTPS", h("label", { class: "row" }, secured, "Serve over HTTPS with Flock's local certificate")),
      field("Extra domains",
        domains.length ? h("div", { class: "chips" }, ...domains.map((d) => h("span", { class: "chip", title: d.problem || d.url || "" },
          (d.problem ? "⚠ " : "") + d.host,
          h("button", { title: "Remove", onclick: () => ctx.act(() => api(`${site(s.name)}/domains/${encodeURIComponent(d.entry)}`, { method: "DELETE" })) }, "×")))) : "",
        h("div", { class: "row", style: "margin-top:6px" }, newDomain, h("button", { onclick: addDomain }, "Add")),
        h("div", { class: "hint" }, `A subdomain (tenant1 → tenant1.${s.domain}) or a name of its own (app-2.${cfg.tld}).`))),

    h("div", { class: "group" }, h("h3", {}, "Versions"),
      versionPicker(ctx, s, "php", (cfg.php || []).map((p) => p.version), cfg.default_php),
      versionPicker(ctx, s, "node", cfg.node || [], cfg.default_node)),

    h("div", { class: "group" }, h("h3", {}, "Server"),
      field("PHP runs on", h("div", { class: "row" }, server, worker),
        s.server === "frankenphp" && !s.octane_available && h("div", { class: "hint" }, "Octane's worker mode needs laravel/octane in the project.")),
      fp && field("FrankenPHP",
        h("div", { class: "row" },
          h("span", { class: "grow" }, fp.problem || [fp.state, fp.version, fp.php_version && `PHP ${fp.php_version}`].filter(Boolean).join(" · ") +
            (fp.progress > 0 && fp.progress < 1 ? ` (${Math.round(fp.progress * 100)}%)` : "")),
          h("button", { onclick: () => ctx.act(() => api(`${site(s.name)}/restart`, { method: "POST" })) }, "Restart")))));
}

export default {
  title: "Sites",
  subtitle: "Sites you added one by one, plus every folder inside your project folders.",
  flush: true,
  render(ctx) {
    const sites = [...(ctx.status.sites || [])].sort((a, b) => a.domain.localeCompare(b.domain));
    const add = h("button", { class: "primary", onclick: async () => {
      const path = await pickFolder("Add a site");
      if (path) ctx.act(() => api("/v1/sites", { method: "POST", body: { path } }));
    } }, "Add Site…");

    if (!sites.length) {
      return h("div", { class: "empty grow" }, h("p", {}, "No sites yet. Add one here, or add a project folder in General."), add);
    }
    if (!sites.some((s) => s.name === selection)) selection = sites[0].name;
    const selected = sites.find((s) => s.name === selection);

    return h("div", { class: "row grow", style: "align-items: stretch; min-height: 0" },
      h("div", { style: "width: 260px; border-right: 1px solid var(--line); display: flex; flex-direction: column" },
        h("div", { class: "toolbar" }, add),
        h("div", { class: "scroll list" }, ...sites.map((s) =>
          h("div", { class: s.name === selection ? "selected" : "", onclick: () => { selection = s.name; ctx.rerender(); } },
            h("div", { class: "row" }, h("span", { class: "dot " + (s.problem ? "warn" : "ok") }), h("span", { class: "grow ellipsis" }, (s.secured ? "🔒 " : "") + s.domain)),
            h("div", { class: "muted mono", style: "margin-left: 16px" }, [s.php && `PHP ${s.php}`, s.server === "frankenphp" && "FrankenPHP", s.parked && "parked"].filter(Boolean).join(" · ")))))),
      details(ctx, selected));
  },
};
