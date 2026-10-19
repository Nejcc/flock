// Settings → Services, the installs: PostgreSQL's majors and the catalog services' lines (MySQL,
// Redis, Meilisearch, ...) side by side, as in the other apps. Installs run in the daemon (catalog
// jobs, or PostgreSQL's busy majors); load() picks up their progress, also of the CLI's installs.
import { api, ago, h, size } from "../app.js";

export let services = null;
export let pg = null; // GET /v1/postgres/versions, null until loaded or where it isn't offered
export let catalog = null; // GET /v1/catalog, likewise
export const pending = {}; // id → what the row says while this window's request runs
const picked = {}; // id → { line, port } chosen before installing, kept across re-renders
let checking = false;
let loaded = "";

export const entry = (id) => catalog?.services?.find((e) => e.id === id);
export const pgWorking = () => !!pending.postgres || !!pg?.majors?.some((m) => m.busy);
export const catalogWorking = (id) => !!pending[id] || entry(id)?.job?.state === "running";
export const BUSY = { installing: "Installing…", updating: "Updating…", switching: "Switching…", uninstalling: "Uninstalling…" };
const PHASE = { downloading: "Downloading…", installing: "Installing…" };
export const phase = (job) => PHASE[job.phase] || (job.action === "update" ? "Updating…" : "Working…");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function load(ctx) {
  const [s, p, c] = await Promise.all([
    api("/v1/services"),
    api("/v1/postgres/versions").catch(() => null),
    api("/v1/catalog").catch(() => null),
  ]);
  services = s;
  pg = p;
  catalog = c;
  const key = JSON.stringify([s, p, c]);
  if (key !== loaded) {
    loaded = key;
    ctx.rerender();
  }
}

// Runs a request with the row showing step meanwhile, then reloads. ctx.act shows a failure.
async function work(ctx, id, step, fn) {
  pending[id] = step;
  ctx.rerender();
  await ctx.act(fn);
  delete pending[id];
  await load(ctx).catch(() => {});
  ctx.rerender();
}

// A modal question; resolves to { checked } on OK, null on Cancel or Escape.
export function ask(title, text, ok, { danger, check } = {}) {
  return new Promise((resolve) => {
    const box = check && h("input", { type: "checkbox" });
    const warning = check && h("div", { class: "small warn", hidden: true }, check.warning);
    box?.addEventListener("change", () => { warning.hidden = !box.checked; });
    const d = h("dialog", { class: "card ask" },
      h("h3", {}, title), h("p", { class: "muted" }, text),
      check && h("label", { class: "row" }, box, check.label), warning,
      h("div", { class: "row", style: "justify-content: flex-end; margin-top: 14px" },
        h("button", { onclick: () => d.close("") }, "Cancel"),
        h("button", { class: "primary", style: danger ? "background: var(--bad); border-color: var(--bad)" : "", onclick: () => d.close("ok") }, ok)));
    d.addEventListener("close", () => { d.remove(); resolve(d.returnValue === "ok" ? { checked: !!box?.checked } : null); });
    document.body.append(d);
    d.showModal();
  });
}

// The tail of a catalog install's log, followed while the install runs.
function showLog(e) {
  const pre = h("pre", { class: "code mono selectable" }, "Loading…");
  const tick = async () => {
    let text;
    try {
      text = (await api(`/v1/catalog/${encodeURIComponent(e.id)}/log`)).trimEnd() || "No log yet.";
    } catch (err) {
      text = err.message;
    }
    if (pre.textContent !== text) {
      pre.textContent = text;
      pre.scrollTop = pre.scrollHeight;
    }
  };
  const follow = setInterval(() => catalogWorking(e.id) && tick(), 2000);
  const d = h("dialog", { class: "card ask log" }, h("h3", {}, `${e.name} install log`), pre,
    h("div", { class: "row", style: "justify-content: flex-end; margin-top: 14px" }, h("button", { onclick: () => d.close() }, "Done")));
  d.addEventListener("close", () => { clearInterval(follow); d.remove(); });
  document.body.append(d);
  d.showModal();
  tick();
}

function checkFooter(ctx, checkedAt, checkError, path) {
  return h("div", { class: "small muted" },
    h("div", { class: "row" }, h("span", { class: "grow" }, checkedAt ? `Last checked ${ago(checkedAt)}` : "Not checked yet"),
      checking ? h("span", {}, "Checking…") : h("button", { class: "link", onclick: async () => {
        checking = true;
        ctx.rerender();
        await ctx.act(() => api(path, { method: "POST" }));
        checking = false;
        await load(ctx).catch(() => {});
        ctx.rerender();
      } }, "Check for Updates")),
    checkError && h("div", { class: "warn" }, `⚠ Couldn't check: ${checkError}`));
}

// Installing what isn't installed yet, the same for PostgreSQL and the catalog services: the
// version (when there is a choice) and the port, then Install.
function installCard(id, name, description, options, preferred, port, portNote, estimate, install) {
  const p = (picked[id] ||= {});
  const select = h("select", { disabled: options.length < 2 },
    ...options.map((o) => h("option", { value: o.id, selected: o.id === (p.line ?? preferred) }, o.label)));
  const portInput = h("input", { type: "text", inputmode: "numeric", value: p.port ?? port, style: "width: 90px" });
  const button = h("button", { class: "primary" });
  const label = () => {
    const latest = options.find((o) => o.id === select.value)?.latest;
    button.textContent = latest ? `Install ${name} ${latest}` : `Install ${name}`;
  };
  label();
  select.addEventListener("change", () => { p.line = select.value; label(); });
  portInput.addEventListener("input", () => { p.port = portInput.value; });
  button.addEventListener("click", () => {
    const n = parseInt(portInput.value, 10);
    install(select.value || null, n >= 1024 && n <= 65535 ? n : null);
  });
  return h("div", { class: "inner hero" },
    h("strong", {}, `Install ${name}`), h("div", { class: "muted" }, description),
    h("div", { class: "row", style: "margin-top: 6px" }, h("label", { class: "muted" }, "Version"), select, h("label", { class: "muted" }, "Port"), portInput),
    portNote && h("div", { class: "small muted" }, portNote),
    button,
    estimate && h("div", { class: "small muted" }, cap(estimate)));
}

// PostgreSQL

export function postgresDetail(ctx) {
  if (!pg) return [h("div", { class: "muted" }, "Loading PostgreSQL versions…")];
  const majors = pg.majors || [];
  const installed = majors.some((m) => m.installed);
  const out = [];
  if (!installed && pgWorking()) {
    const m = majors.find((x) => x.busy) || {};
    out.push(h("div", { class: "inner" },
      h("strong", {}, `${m.busy === "uninstalling" ? "Uninstalling" : "Installing"} PostgreSQL ${m.latest || m.major || ""}…`),
      h("progress", {}),
      h("div", { class: "small muted" }, "Downloading the server and creating its database cluster. This takes a minute or two; you can close this window meanwhile.")));
  } else if (!installed) {
    if (!majors.length) {
      out.push(h("div", { class: "inner muted" }, "Flock offers no PostgreSQL versions for this computer."));
    } else {
      const kept = majors.filter((m) => m.has_data).map((m) => m.major);
      out.push(installCard("postgres", "PostgreSQL",
        "The database for your apps. You can add other versions later; one runs at a time, and each keeps its own databases.",
        majors.map((m) => ({ id: m.major, latest: m.latest, label: (m.latest ? `${m.major} (${m.latest})` : m.major) + (m.has_data ? " — your databases" : "") })),
        majors[0].major, pg.port, null, "",
        (major, port) => work(ctx, "postgres", "Installing…", async () => {
          // The port belongs to PostgreSQL, not to a version, so it is set first.
          if (port && port !== pg.port) await api("/v1/services/postgres", { method: "PATCH", body: { port } });
          await api(`/v1/postgres/versions/${major}/install`, { method: "POST" });
        })));
      if (kept.length) out.push(h("div", { class: "small muted" }, `Databases of PostgreSQL ${kept.join(", ")} are still here — installing that version again picks them up.`));
    }
  } else {
    out.push(activeCard(), h("div", {}, h("strong", {}, "Versions"),
      h("div", { class: "inner versions", style: "padding: 0 14px" }, ...majors.map((m) => majorRow(ctx, m))),
      h("div", { class: "small muted", style: "margin-top: 6px" }, "Installed versions stay side by side. One runs at a time; each keeps its own databases, and updates within a version keep them.")));
  }
  out.push(checkFooter(ctx, pg.checked_at, pg.check_error, "/v1/postgres/check"),
    h("div", { class: "small muted" }, "psql, pg_dump and the other command-line tools come with PostgreSQL. In a terminal, Flock uses those of the newest installed version, which work with every version above and with remote servers."));
  return out;
}

function activeCard() {
  const active = pg.majors.find((m) => m.major === pg.active && pg.active);
  if (!active) return h("div", { class: "inner muted" }, "No version is active. Switch to an installed version below to start PostgreSQL.");
  const state = pg.running ? "Running" : pg.enabled ? "Not running" : "Stopped";
  return h("div", { class: "inner" },
    h("div", { class: "small muted" }, "Active version"),
    h("div", { style: "font-size: 16px; font-weight: 650" }, `PostgreSQL ${active.installed}`),
    h("div", { class: "row small muted" }, h("span", { class: "dot" + (pg.running ? " ok" : "") }),
      `${state} · Port ${pg.port}` + (active.has_data ? ` · ${size(active.data_size)} of data` : "")),
    active.busy && h("div", { class: "small muted" }, BUSY[active.busy] || "Working…"),
    !active.busy && active.update && h("div", { class: "small accent" },
      `${active.latest === active.installed ? `A new build of ${active.latest}` : active.latest} is available — update it below; your databases stay.`),
    active.yanked && h("div", { class: "small warn", title: "Flock replaces it as soon as a fixed build is published." }, `⚠ This build was withdrawn: ${active.yanked}`));
}

function majorRow(ctx, m) {
  const facts = [m.installed || "Not installed"];
  if (m.update) facts.push(m.latest === m.installed ? "new build available" : `${m.latest} available`);
  if (m.yanked) facts.push(`withdrawn: ${m.yanked}`);
  if (m.prerelease) facts.push(`${m.latest} is a pre-release`);
  if (m.has_data) facts.push(m.installed ? `${size(m.data_size)} of data` : `databases kept (${size(m.data_size)})`);

  const busy = m.busy ? BUSY[m.busy] || "Working…" : null;
  const run = (step, fn) => work(ctx, "postgres", step, fn);
  const path = `/v1/postgres/versions/${m.major}`;
  let actions;
  if (busy) {
    actions = [h("span", { class: "small muted" }, busy)];
  } else if (!m.installed) {
    actions = [h("button", { title: (m.latest ? `Downloads PostgreSQL ${m.latest}.` : "Downloads the newest release.")
      + (pg.active ? ` PostgreSQL ${pg.active} stays active until you switch.` : "") + (m.has_data ? " Its databases are still here and come back." : ""),
    onclick: () => run("Downloading and installing…", () => api(`${path}/install`, { method: "POST" })) }, "Install")];
  } else {
    actions = [
      m.update && h("button", { title: `Installs ${m.latest} in place of ${m.installed}. Your databases stay.`,
        onclick: () => run("Updating…", () => api(`${path}/update`, { method: "POST" })) }, `Update to ${m.latest}`),
      !m.active && h("button", { onclick: async () => {
        if (pg.active && !await ask(`Switch to PostgreSQL ${m.major}?`,
          `PostgreSQL ${pg.active} stops; its databases stay but aren't available until you switch back. ${m.major} uses its own databases.`
          + (m.has_data ? "" : " It starts with a new, empty database cluster."), "Switch")) return;
        run("Switching…", () => api(`${path}/activate`, { method: "POST" }));
      } }, "Switch…"),
      h("button", { onclick: async () => {
        const next = pg.majors.find((x) => x.installed && x.major !== m.major);
        const text = (!m.active ? ""
          : next ? `PostgreSQL ${m.major} stops and PostgreSQL ${next.major} becomes the active version. `
          : `PostgreSQL ${m.major} stops; no PostgreSQL runs until you install a version again. `)
          + (m.has_data ? `Its databases stay unless you delete them below; installing ${m.major} again picks them up.` : "It holds no databases.");
        const answer = await ask(`Uninstall PostgreSQL ${m.major}?`, text, "Uninstall", { danger: true,
          check: m.has_data && { label: `Also delete its databases (${size(m.data_size)})`, warning: "Deleted databases can't be recovered." } });
        if (answer) run("Uninstalling…", () => api(path + (answer.checked ? "?delete_data=1" : ""), { method: "DELETE" }));
      } }, "Uninstall…"),
    ];
  }
  // One PostgreSQL operation at a time.
  if (pgWorking()) for (const a of actions) if (a && a.tagName === "BUTTON") a.disabled = true;
  return h("div", {},
    h("div", { class: "grow" },
      h("div", { class: "row" }, h(m.installed ? "strong" : "span", {}, `PostgreSQL ${m.major}`), m.active && h("span", { class: "tag" }, "Active")),
      h("div", { class: "small " + (m.update ? "accent" : "muted") }, facts.join(" · "))),
    ...actions);
}

// Catalog services

export function catalogDetail(ctx, s) {
  if (!catalog) return [h("div", { class: "muted" }, "Loading…")];
  const e = entry(s.id);
  if (!e) return [h("div", { class: "muted" }, `This Flock daemon doesn't offer ${s.name}. Update Flock, then try again.`)];
  const out = [];
  if (e.job) out.push(jobCard(ctx, e, e.job));
  const lines = e.lines || [];
  if (!lines.some((l) => l.installed)) {
    if (e.job?.state !== "running" && !pending[e.id]) {
      out.push(installCard(e.id, e.name, e.description || "Runs on 127.0.0.1 for your sites.",
        lines.map((l) => ({ id: l.id, latest: l.latest, label: l.latest ? `${l.label || l.id} (${l.latest})` : l.label || l.id })),
        (lines.find((l) => l.active) || lines[0])?.id, e.port,
        e.port !== e.default_port ? `Port ${e.default_port} is taken, so Flock suggests ${e.port}.` : null, e.estimate,
        (line, port) => work(ctx, e.id, "Starting…", () => api(`/v1/catalog/${e.id}/install`, { method: "POST", body: { line: line || "", port: port || 0 } }))));
    }
  } else {
    out.push(h("div", {}, h("strong", {}, "Versions"),
      h("div", { class: "inner versions", style: "padding: 0 14px" }, ...lines.map((l) => lineRow(ctx, e, l))),
      h("div", { class: "small muted", style: "margin-top: 6px" }, lines.length > 1
        ? "Installed versions stay side by side. One runs at a time; each keeps its own data, and updates within a version keep it."
        : "Updates keep your data.")));
  }
  out.push(checkFooter(ctx, catalog.checked_at, catalog.check_error, "/v1/catalog/check"));
  return out;
}

function jobCard(ctx, e, job) {
  const target = job.version ? `${e.name} ${job.version}` : e.name;
  const id = encodeURIComponent(e.id);
  const busy = !!pending[e.id];
  if (job.state === "running") {
    const known = job.progress >= 0 && job.progress <= 1;
    return h("div", { class: "inner" },
      h("div", { class: "row" }, h("strong", { class: "grow" }, `${job.action === "update" ? "Updating" : "Installing"} ${target}`),
        known && h("span", { class: "small muted" }, `${Math.round(job.progress * 100)} %`)),
      known ? h("progress", { max: 1, value: job.progress }) : h("progress", {}),
      h("div", { class: "row small muted" }, h("span", { class: "grow" }, phase(job) + (job.started_at && !job.started_at.startsWith("0001") ? ` · started ${ago(job.started_at)}` : "")),
        h("button", { class: "link", onclick: () => showLog(e) }, "Show Log"),
        h("button", { disabled: busy, onclick: () => work(ctx, e.id, "Cancelling…", () => api(`/v1/catalog/${id}/cancel`, { method: "POST" })) }, "Cancel")));
  }
  return h("div", { class: "inner" },
    h("strong", { style: "color: var(--bad)" }, `⚠ ${job.action === "update" ? `Updating ${e.name}` : `Installing ${target}`} failed`),
    h("div", { class: "small selectable", style: "color: var(--bad); margin: 4px 0 8px" }, job.error || "Flock reported no details; the log may tell more."),
    h("div", { class: "row" },
      h("button", { class: "primary", disabled: busy, onclick: () => work(ctx, e.id, "Starting…", () => api(`/v1/catalog/${id}/install`, { method: "POST", body: { line: job.line || "" } })) }, "Try Again"),
      h("button", { disabled: busy, onclick: () => work(ctx, e.id, "", () => api(`/v1/catalog/${id}/job`, { method: "DELETE" })) }, "Dismiss"),
      h("button", { class: "link", onclick: () => showLog(e) }, "Show Log")));
}

function lineRow(ctx, e, l) {
  const id = encodeURIComponent(e.id);
  const label = l.label || l.id;
  const install = (step) => work(ctx, e.id, step, () => api(`/v1/catalog/${id}/install`, { method: "POST", body: { line: l.id } }));
  const facts = [l.installed ? l.version : l.latest ? `Not installed · ${l.latest} available` : "Not installed"];
  if (l.update) facts.push(l.latest === l.version ? "new build available" : `${l.latest} available`);
  else if (l.installed) facts.push("up to date");
  if (l.has_data) facts.push(l.installed ? "has data" : "data kept");

  const actions = !l.installed
    ? [h("button", { title: (l.latest ? `Downloads ${e.name} ${l.latest}.` : "Downloads the newest release.")
      + (e.installed ? ` ${e.name} ${e.line} keeps running until you switch.` : "") + (l.has_data ? " Its data is still here and comes back." : ""),
    onclick: () => install("Starting…") }, "Install")]
    : [
      l.update && h("button", { title: `Installs ${l.latest} in place of ${l.version}. Your data stays.`, onclick: () => install("Starting…") }, `Update to ${l.latest}`),
      !l.update && h("button", { onclick: () => install("Starting…") }, "Reinstall"),
      !l.active && h("button", { onclick: async () => {
        const own = l.has_data ? `${e.name} ${label} uses its own data.` : `${e.name} ${label} starts with empty data.`;
        if (e.installed && !await ask(`Switch to ${e.name} ${label}?`, `${e.name} ${e.line} stops; its data stays but isn't used until you switch back. ${own}`, "Switch")) return;
        work(ctx, e.id, "Switching…", () => api(`/v1/catalog/${id}/activate`, { method: "POST", body: { line: l.id } }));
      } }, "Switch…"),
      h("button", { onclick: async () => {
        const next = e.lines.find((x) => x.installed && x.id !== l.id);
        const text = (!l.active ? ""
          : next ? `${e.name} ${label} stops and ${e.name} ${next.label || next.id} becomes the active version. `
          : `${e.name} ${label} stops; your sites can't use ${e.name} until you install a version again. `)
          + (l.has_data ? `Its data stays unless you delete it below; installing ${label} again picks it up.` : "It holds no data.");
        const answer = await ask(`Uninstall ${e.name} ${label}?`, text, "Uninstall", { danger: true,
          check: l.has_data && { label: "Also delete its data", warning: "Deleted data can't be recovered." } });
        if (!answer) return;
        const q = new URLSearchParams({ line: l.id });
        if (answer.checked) q.set("delete_data", "1");
        work(ctx, e.id, "Uninstalling…", () => api(`/v1/catalog/${id}?${q}`, { method: "DELETE" }));
      } }, "Uninstall…"),
    ];
  if (catalogWorking(e.id)) for (const a of actions) if (a) a.disabled = true;
  return h("div", {},
    h("div", { class: "grow" },
      h("div", { class: "row" }, h(l.installed ? "strong" : "span", {}, `${e.name} ${label}`), l.active && h("span", { class: "tag" }, "Active")),
      h("div", { class: "small " + (l.update ? "accent" : "muted") }, facts.join(" · ")),
      l.yanked && h("div", { class: "small warn", title: "This build was withdrawn. Flock replaces it as soon as a fixed build is published." },
        `⚠ Withdrawn: ${l.yanked}` + (l.update ? " — update to replace it" : ""))),
    ...actions);
}
