// Settings → Services: the services grouped by category on the left, the selected one's details on
// the right, as in the other apps. Installing, updating and switching versions is in
// services-installs.js. This pane polls while shown: installs move on without a status change.
import { api, h, openWindow } from "../app.js";
import { ask, BUSY, catalogDetail, catalogWorking, entry, load, pending, pg, pgWorking, phase, postgresDetail, services } from "./services-installs.js";

const ORDER = ["Core", "Database", "Cache & Queue", "Search", "Storage", "Mail", "Debugging"];
let showAll = true;
let selection = null;
let timer = null;
let root = null;


const css = `
  .svc { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; }
  .svc-list { position: sticky; top: 0; }
  .svc-list h3 { margin: 14px 2px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .svc-row { display: flex; align-items: center; gap: 10px; width: 100%; margin-bottom: 4px; padding: 8px 10px; text-align: left; border-radius: 10px; }
  .svc-row.selected { border-color: var(--accent); }
  .svc-row.off { opacity: 0.6; }
  .svc-detail { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .svc-detail h2 { margin: 0; font-size: 17px; }
  .inner { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; background: color-mix(in srgb, var(--bg) 50%, transparent); }
  .hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .versions > div { display: flex; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .versions > div:last-child { border-bottom: none; }
  .small { font-size: 12px; }
  .warn { color: var(--warn); }
  .accent { color: var(--accent); }
  pre.code { margin: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg-2); white-space: pre-wrap; word-break: break-all; }
  progress { width: 100%; accent-color: var(--accent); }
  dialog.ask { width: 460px; padding: 18px; color: var(--fg); }
  dialog.ask::backdrop { background: #0006; }
  dialog.ask h3 { margin: 0 0 8px; }
  dialog.log { width: 720px; }
  dialog.log pre { height: 380px; overflow: auto; margin: 0; white-space: pre; }
`;

const onRequest = (s) => !["web", "dns", "hosts", "mail", "dumps", "postgres"].includes(s.id);
const installable = (s) => s.id === "postgres" || onRequest(s);
const configurablePort = (s) => s.installed && s.port > 0 && s.id !== "web" && s.id !== "dns";

// The list and the details

function updateHint(s) {
  if (s.id === "postgres") {
    const m = pg?.majors?.find((x) => x.update);
    return m && (m.latest === m.installed ? `A new build of PostgreSQL ${m.latest} is available` : `PostgreSQL ${m.latest} is available`);
  }
  const e = entry(s.id);
  const l = e?.lines?.find((x) => x.update);
  return l && `${e.name} ${l.latest} is available`;
}

function workText(s) {
  if (pending[s.id]) return pending[s.id];
  if (s.id === "postgres") {
    const m = pg?.majors?.find((x) => x.busy);
    return m ? BUSY[m.busy] || "Working…" : null;
  }
  const job = entry(s.id)?.job;
  return job?.state === "running" ? phase(job) : null;
}

function listRow(ctx, s, selected) {
  const working = workText(s);
  const update = updateHint(s);
  const facts = [s.version, s.port > 0 && `Port ${s.port}`, s.installed && !s.running && "Stopped"].filter(Boolean).join(" · ");
  const side = working ? working
    : s.installed ? ""
    : !s.available ? "Not available"
    : installable(s) ? "Install…"
    : "Not installed";
  return h("button", { class: "svc-row card" + (selected ? " selected" : "") + (s.available ? "" : " off"), title: s.available ? "" : s.unavailable || "",
    onclick: () => { selection = s.id; ctx.rerender(); } },
    h("span", { class: "dot" + (s.running ? " ok" : "") }),
    h("div", { class: "grow" }, h("div", { class: "ellipsis", style: "font-weight: 600" }, s.name), h("div", { class: "small muted ellipsis" }, facts)),
    s.problem && h("span", { class: "warn", title: s.problem }, "⚠"),
    update && h("span", { class: "tag accent", title: update }, "Update"),
    side && h("span", { class: "small muted" }, side));
}

function portField(ctx, s) {
  if (!configurablePort(s)) {
    return h("div", { class: "row" }, h("strong", { class: "grow" }, "Port"), h("span", { class: "small muted" }, `${s.port} · set by \`flock-php install\``));
  }
  const input = h("input", { type: "text", inputmode: "numeric", value: s.port, style: "width: 90px" });
  const save = () => {
    const port = parseInt(input.value, 10);
    if (port !== s.port) ctx.act(() => api(`/v1/services/${encodeURIComponent(s.id)}`, { method: "PATCH", body: { port } })).then(() => load(ctx)).catch(() => {});
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && save());
  return h("div", {},
    h("div", { class: "row" }, h("strong", { class: "grow" }, "Port"), input, h("button", { onclick: save }, "Save")),
    h("div", { class: "small muted", style: "margin-top: 4px" }, "Ports 1024–65535. Update the port in your projects' .env files too."));
}

function detail(ctx, s) {
  const tld = ctx.config.tld;
  const parts = [h("div", { class: "row" }, h("span", { class: "dot" + (s.running ? " ok" : "") }), h("h2", { class: "grow" }, s.name),
    s.installed && s.stoppable && h("button", {
      // Not while PostgreSQL switches or a service installs: the daemon (re)starts them itself.
      disabled: s.id === "postgres" ? pgWorking() : catalogWorking(s.id),
      onclick: async () => {
        if (s.running && !await ask(`Stop ${s.name}?`, "Apps that use it can't connect until you start it again.", "Stop", { danger: true })) return;
        await ctx.act(() => api(`/v1/services/${encodeURIComponent(s.id)}/${s.running ? "stop" : "start"}`, { method: "POST" }));
        await load(ctx).catch(() => {});
      } }, s.running ? "Stop" : "Start"))];

  // A service Flock can't run here has nothing to configure or connect to: just say why.
  if (!s.available) {
    parts.push(h("div", { class: "inner hero" }, h("strong", {}, "Not available on Linux"),
      h("div", { class: "muted" }, s.unavailable || `Flock can't run ${s.name} on Linux.`)));
    return h("div", { class: "card svc-detail" }, ...parts);
  }
  if (s.problem && !(s.id === "dns" && !s.running)) parts.push(h("div", { class: "small warn selectable" }, `⚠ ${s.problem}`));
  if (s.id === "web") {
    parts.push(h("div", { class: "small muted" }, s.running
      ? `Caddy serves every site over HTTPS (https://app.${tld}) with certificates from Flock's local certificate authority, which \`flock-php install\` trusts.`
      : "Sites don't open while the web server is down. Its log may tell why; `flock-php restart` starts it again."));
  } else if (s.id === "dns") {
    parts.push(h("div", { class: "small muted" }, s.running
      ? `Every name under .${tld} resolves here, so any subdomain of a site works (tenant1.app.${tld}, a.b.app.${tld}) without adding it.`
      : `Wildcard subdomains don't resolve: ${s.problem || "the DNS server isn't running"}. Add the subdomains you use to their site (Sites → the site → Extra domains).`));
  } else if (s.description && !installable(s)) {
    parts.push(h("div", { class: "small muted" }, s.description));
  }
  if (s.installed && s.port > 0) parts.push(portField(ctx, s));
  if (s.id === "postgres") parts.push(...postgresDetail(ctx));
  if (onRequest(s)) parts.push(...catalogDetail(ctx, s));

  // How to connect: only once there is something to connect to.
  if (s.installed || !installable(s)) {
    if (s.env) parts.push(h("div", {}, h("strong", {}, "Environment variables"), h("pre", { class: "code mono selectable", style: "margin-top: 6px" }, s.env)));
    if (s.url) parts.push(h("div", {}, h("strong", {}, "Connection"), h("pre", { class: "code mono selectable", style: "margin-top: 6px" }, s.url)));
    if (s.log) parts.push(h("div", { class: "row" }, h("strong", { class: "grow" }, "Logs"), h("button", { onclick: () => openWindow("logs") }, "Open")));
  }
  return h("div", { class: "card svc-detail" }, ...parts);
}

export default {
  title: "Services",
  subtitle: "Databases, caches, search and the tools around your sites. Everything listens on 127.0.0.1 only.",
  icon: "server",
  color: "#f97316",
  render(ctx) {
    // Polls while the pane is shown: installs move on in the daemon without a status change.
    if (!timer) {
      load(ctx).catch(() => {});
      timer = setInterval(() => {
        if (!root?.isConnected) {
          clearInterval(timer);
          timer = null;
        } else if (!document.hidden) {
          load(ctx).catch(() => {});
        }
      }, 2000);
    }
    if (!services) return (root = h("div", { class: "empty" }, "Loading services…"));

    // With "Installed", also the selected service, so showing one from elsewhere still works.
    const shown = showAll ? services : services.filter((s) =>
      !onRequest(s) || s.installed || workText(s) || entry(s.id)?.job?.state === "failed" || s.id === selection);
    if (!shown.length) return (root = h("div", { class: "empty" }, "No services"));
    const selected = shown.find((s) => s.id === selection) || shown[0];
    const present = [...new Set(shown.map((s) => s.category))];
    const categories = [...ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !ORDER.includes(c)).sort()];
    const tab = (all, label) => h("button", { class: showAll === all ? "active" : "", onclick: () => { showAll = all; ctx.rerender(); } }, label);

    return (root = h("div", {},
      h("style", {}, css),
      h("div", { class: "svc" },
        h("div", { class: "svc-list" },
          h("div", { class: "tabs", style: "padding: 0; margin-bottom: 4px" }, tab(false, "Installed"), tab(true, "All")),
          ...categories.flatMap((c) => [h("h3", {}, c), ...shown.filter((s) => s.category === c).map((s) => listRow(ctx, s, s.id === selected.id))]),
          shown.length < services.length && h("button", { class: "link", style: "margin-top: 10px", onclick: () => { showAll = true; ctx.rerender(); } }, "More services…")),
        detail(ctx, selected))));
  },
};
