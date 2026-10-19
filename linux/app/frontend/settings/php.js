// Settings → PHP: the PHP versions from the binaries manifest, and the FrankenPHP builds, as in the
// other apps: install, update, make default and uninstall, with download progress and the install
// log. The pane loads its own data, every 2 s while something downloads and every 30 s otherwise.
import { api, app, ago, h } from "../app.js";
import { icon } from "../icons.js";

let versions = null; // GET /v1/php/versions
let franken = null; // GET /v1/frankenphp; null when this platform has no FrankenPHP
let error = "";
let checking = false;
let logOf = null; // the key of the row whose install log is shown ("php:8.4", "frankenphp:8.4")
let log = "";
const busy = new Set();
let loadedAt = 0;
let timer = 0;
let dueAt = 0;
let root = null;

const css = `
  .versions { display: flex; flex-direction: column; gap: 6px; margin-bottom: 24px; }
  .versions > .head { display: flex; align-items: center; gap: 8px; margin: 0 1px 4px; }
  .versions > .head strong { flex: 1; }
  .version { display: flex; align-items: center; gap: 14px; padding: 10px 14px; }
  .version > .icon { color: var(--muted); }
  .version.installed > .icon { color: var(--accent); }
  .version .title { display: flex; align-items: center; gap: 8px; }
  .version .title strong { font-weight: 650; }
  .version .detail { font-size: 12px; color: var(--muted); }
  .version .detail.accent { color: var(--accent); }
  .version .detail.warn { color: var(--warn); }
  .version .detail.bad { color: var(--bad); }
  .tag.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .tag.bad { background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--bad); }
  pre.log { margin: 0; padding: 10px 14px; max-height: 300px; overflow: auto; border-top: 1px solid var(--line); font: 11px/1.5 var(--mono); white-space: pre-wrap; }
`;

const mb = (bytes) => (bytes > 0 ? ` (${Math.round(bytes / 1e6)} MB)` : "");

async function load(ctx) {
  try {
    [versions, franken] = await Promise.all([
      api("/v1/php/versions"),
      api("/v1/frankenphp").catch(() => null), // 501 where FrankenPHP isn't published
    ]);
    if (logOf) log = await api(logPath(logOf)).catch((e) => e.message);
    error = "";
  } catch (err) {
    error = err.message;
  }
  loadedAt = Date.now();
  if (root?.isConnected) ctx.rerender();
}

const logPath = (key) => {
  const [kind, minor] = key.split(":");
  return kind === "php" ? `/v1/php/versions/${minor}/log` : `/v1/frankenphp/${minor}/log`;
};

// The next load: in 2 s while something downloads (or a log is shown), else in 30 s. The window's
// own poll re-renders more often than that, so a pending load is only ever brought forward.
function schedule(ctx) {
  const running = [...versions.versions, ...(franken?.builds || [])].some((v) => v.job?.state === "running");
  const ms = running || logOf ? 2000 : 30000;
  if (timer && Date.now() + ms >= dueAt) return;
  clearTimeout(timer);
  dueAt = Date.now() + ms;
  timer = setTimeout(() => {
    timer = 0;
    if (root?.isConnected) load(ctx);
  }, ms);
}

// Runs a request for one row: its buttons are disabled until the daemon answers.
async function run(ctx, key, fn) {
  busy.add(key);
  ctx.rerender();
  await ctx.act(fn);
  busy.delete(key);
  await load(ctx);
}

function jobText(job) {
  const phase = { downloading: "Downloading…", installing: "Installing…" }[job.phase] || (job.action === "update" ? "Updating…" : "Working…");
  return job.phase === "downloading" && job.progress >= 0 && job.progress <= 1 ? `${phase} ${Math.round(job.progress * 100)}%` : phase;
}

// The line under a row's name: a running or failed job, a withdrawn build, or the state.
function detail(v, idle) {
  if (v.job?.state === "running") return h("div", { class: "detail" }, jobText(v.job));
  if (v.job?.state === "failed") return h("div", { class: "detail bad", title: v.job.error }, v.job.error || "The download failed.");
  if (v.yanked) {
    return h("div", { class: "detail warn", title: "This build was withdrawn. Flock replaces it as soon as a fixed build is published." },
      `Withdrawn: ${v.yanked}${v.update ? " — update to replace it" : ""}`);
  }
  return idle;
}

function card(installed, iconName, title, sub, actions, key) {
  const shown = logOf === key;
  return h("div", { class: "card" },
    h("div", { class: "version" + (installed ? " installed" : "") },
      icon(iconName, 20),
      h("div", { class: "grow" }, title, sub),
      h("div", { class: "row" }, busy.has(key) && h("span", { class: "muted" }, "…"), ...actions.map((b) => {
        if (busy.has(key)) b.disabled = true;
        return b;
      }))),
    shown && h("pre", { class: "log selectable" }, log.split("\n").slice(-400).join("\n") || "No log yet."));
}

function logButton(ctx, key) {
  return h("button", { class: "link", onclick: () => {
    logOf = logOf === key ? null : key;
    log = "Loading…";
    ctx.rerender();
    if (logOf) load(ctx);
  } }, logOf === key ? "Hide Log" : "Show Log");
}

function phpRow(ctx, v) {
  const m = v.minor;
  const key = "php:" + m;
  const path = `/v1/php/versions/${m}`;
  const set = (p) => run(ctx, key, async () => { versions = await p(); });
  const install = (label, primary) => h("button", { class: primary ? "primary" : "", title: `Downloads PHP ${v.latest}${mb(v.size)}`,
    onclick: () => set(() => api(`${path}/install`, { method: "POST" })) }, label);
  const installed = !!v.installed;
  const actions = [];

  if (v.job?.state === "running") {
    actions.push(logButton(ctx, key), h("button", { onclick: () => set(() => api(`${path}/cancel`, { method: "POST" })) }, "Cancel"));
  } else if (v.job?.state === "failed") {
    actions.push(logButton(ctx, key), install("Retry"), h("button", { onclick: () => set(() => api(`${path}/job`, { method: "DELETE" })) }, "Dismiss"));
  } else if (installed) {
    if (v.update) actions.push(install(v.latest === v.installed ? "Update" : `Update to ${v.latest}`, true));
    if (!v.default) {
      actions.push(h("button", { onclick: () => run(ctx, key, () => api("/v1/settings", { method: "POST", body: { default_php: m } })) }, "Make Default"));
    }
    const ini = (ctx.config.php || []).find((p) => p.version === m)?.ini;
    if (ini) actions.push(h("button", { title: ini, onclick: () => app("folder?path=" + encodeURIComponent(ini)) }, "Open php.ini"));
    actions.push(logButton(ctx, key));
    actions.push(h("button", { disabled: v.default, title: v.default ? "Make another version the default first" : "",
      onclick: () => confirm(`Uninstall PHP ${m}? Its php.ini is removed too. Sites pinned to PHP ${m} stop working until you pick another version.`) &&
        set(() => api(path, { method: "DELETE" })) }, "Uninstall…"));
  } else {
    actions.push(install("Install"));
  }

  const status = { installed: ["Up to date", ""], update: [v.latest === v.installed ? "A new build is available" : "Update available", "accent"], available: ["Not installed", ""] }[v.status] || ["", ""];
  const version = v.update && v.latest !== v.installed ? `${v.installed} → ${v.latest}` : v.installed || v.latest;
  return card(installed, "brand-php", h("div", { class: "title" },
    h("strong", {}, `PHP ${m}`), h("span", { class: "muted" }, version),
    v.default && h("span", { class: "badge" }, "Default"),
    v.prerelease && h("span", { class: "tag warn", title: `PHP ${v.latest} isn't released yet — it may not work. Offered on the beta channel.` }, "Pre-release"),
    installed && v.xdebug && h("span", { class: "tag bad" }, "Xdebug")),
  detail(v, h("div", { class: "detail " + status[1] }, status[0])), actions, key);
}

function frankenRow(ctx, b) {
  const m = b.php;
  const key = "frankenphp:" + m;
  const path = `/v1/frankenphp/${m}`;
  const set = (p) => run(ctx, key, async () => { franken = await p(); });
  const install = (label, primary) => h("button", { class: primary ? "primary" : "", title: `Downloads FrankenPHP for PHP ${b.latest}${mb(b.size)}`,
    onclick: () => set(() => api(`${path}/install`, { method: "POST" })) }, label);
  const installed = !!b.installed;
  const actions = [];

  if (b.job?.state === "running") {
    actions.push(h("button", { onclick: () => set(() => api(`${path}/cancel`, { method: "POST" })) }, "Cancel"));
  } else if (b.job?.state === "failed") {
    actions.push(logButton(ctx, key), install("Retry"), h("button", { onclick: () => set(() => api(`${path}/job`, { method: "DELETE" })) }, "Dismiss"));
  } else {
    // Installing ahead makes switching a site to FrankenPHP immediate (else PHP-CGI serves it meanwhile).
    if (!installed && b.latest) actions.push(install("Install"));
    if (b.update) actions.push(install(b.latest === b.php_version ? "Update" : `Update to PHP ${b.latest}`, true));
    if (installed) actions.push(h("button", { onclick: () => set(() => api(path, { method: "DELETE" })) }, "Remove"));
  }

  return card(installed, "server", h("div", { class: "title" },
    h("strong", {}, `PHP ${m}`),
    b.prerelease && h("span", { class: "tag warn", title: `PHP ${b.latest} isn't released yet — it may not work. Offered on the beta channel.` }, "Pre-release")),
  detail(b, h("div", { class: "detail" }, installed ? `FrankenPHP ${b.installed} (PHP ${b.php_version})` : "Not installed · downloads by itself when a site uses it")),
  actions, key);
}

export default {
  title: "PHP",
  subtitle: "Every installed version runs its own pool of PHP workers. Sites use the default unless pinned to a version.",
  icon: "brand-php",
  color: "#6366f1",
  render(ctx) {
    root = h("div", {}, h("style", {}, css));
    if (!versions) {
      root.append(h("div", { class: "empty" }, error || "Loading PHP versions…"));
    }
    // First shown, or back on this pane after a while (or a failed load): load again.
    if (Date.now() - loadedAt > 5000) load(ctx);
    if (!versions) return root;
    schedule(ctx);

    const check = h("button", { class: "link", disabled: checking, onclick: async () => {
      checking = true;
      ctx.rerender();
      await ctx.act(async () => {
        [versions, franken] = await Promise.all([api("/v1/php/check", { method: "POST" }), franken && api("/v1/frankenphp/check", { method: "POST" })]);
      });
      checking = false;
      ctx.rerender();
    } }, checking ? "Checking…" : "Check now");

    root.append(
      error && h("div", { class: "error" }, error),
      // Named after the server, like the FrankenPHP section below and a site's server picker.
      h("div", { class: "versions" },
        h("div", { class: "head" }, h("strong", {}, "PHP-CGI"),
          h("span", { class: "muted" }, versions.checked_at ? `Checked ${ago(versions.checked_at)}` : "Not checked yet"), check),
        ...versions.versions.map((v) => phpRow(ctx, v)),
        !versions.versions.length && h("div", { class: "card empty" }, "No PHP versions to show yet."),
        versions.check_error && h("div", { class: "detail", style: "color: var(--warn)" }, "⚠ " + versions.check_error)),
      franken?.available && h("div", { class: "versions" },
        h("div", { class: "head" }, h("strong", {}, "FrankenPHP")),
        ...franken.builds.map((b) => frankenRow(ctx, b)),
        !franken.builds.length && h("div", { class: "card empty" }, "No FrankenPHP builds to show yet."),
        franken.check_error && h("div", { class: "detail", style: "color: var(--warn)" }, "⚠ " + franken.check_error)));
    return root;
  },
};
