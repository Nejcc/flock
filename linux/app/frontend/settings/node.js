// Settings → Node: the Node.js majors from the package manifest, like the PHP pane: install, update,
// make default, update npm and uninstall. An install runs within its request, so the row shows what
// it waits for until the daemon answers. Exact versions a project pins (.nvmrc) are offered by
// `node` in the terminal instead.
import { api, ago, h } from "../app.js";
import { icon } from "../icons.js";

let versions = null; // GET /v1/node/versions
let error = "";
let checking = false;
const busy = new Map(); // major → what its row shows while a request runs
let installingDefault = null;
let loadedAt = 0;
let root = null;

const css = `
  .versions { display: flex; flex-direction: column; gap: 6px; }
  .versions > .head { display: flex; align-items: center; gap: 8px; margin: 0 1px 4px; }
  .versions > .head strong { flex: 1; }
  .version { display: flex; align-items: center; gap: 14px; padding: 10px 14px; }
  .version > .icon { color: var(--muted); }
  .version.installed > .icon { color: var(--accent); }
  .version .title { display: flex; align-items: center; gap: 8px; }
  .version .title strong { font-weight: 650; }
  .version .detail { font-size: 12px; color: var(--muted); }
  .version .detail .accent { color: var(--accent); }
  .footnote { margin: 10px 4px; color: var(--muted); font-size: 12px; }
`;

async function load(ctx, path = "/v1/node/versions", method = "GET") {
  try {
    versions = await api(path, { method });
    error = "";
  } catch (err) {
    error = err.message;
  }
  loadedAt = Date.now();
  if (root?.isConnected) ctx.rerender();
}

async function run(ctx, major, step, fn) {
  busy.set(major, step);
  ctx.rerender();
  await ctx.act(async () => { versions = (await fn()) || versions; });
  busy.delete(major);
  ctx.rerender();
}

function row(ctx, v, defaultInstalling) {
  const m = v.major;
  const installed = !!v.installed;
  const step = busy.get(m) ?? (m === defaultInstalling && !installed ? `Downloading Node.js ${v.latest}…` : null);
  const path = `/v1/node/versions/${m}`;
  const install = (label, primary, title) => h("button", { class: primary ? "primary" : "", title,
    onclick: () => run(ctx, m, `Downloading Node.js ${v.latest}…`, () => api(`${path}/install`, { method: "POST" })) }, label);

  const actions = [];
  if (!installed) {
    actions.push(install("Install", false, `Downloads Node.js ${v.latest}`));
  } else {
    if (v.update) actions.push(install(`Update to ${v.latest}`, true, `Downloads Node.js ${v.latest}, then removes ${v.installed}. Global packages stay.`));
    if (v.npm_latest) {
      actions.push(h("button", { title: `Installs npm ${v.npm_latest}, the newest npm that supports Node.js ${v.installed}, for Node ${m}`,
        onclick: () => run(ctx, m, `Updating npm to ${v.npm_latest}…`, () => api(`${path}/npm`, { method: "POST" })) }, "Update npm"));
    }
    if (!v.default) {
      actions.push(h("button", { onclick: () => run(ctx, m, "Making it the default…", async () => {
        await api("/v1/settings", { method: "POST", body: { default_node: m } });
        return api("/v1/node/versions");
      }) }, "Make Default"));
    }
    actions.push(h("button", { disabled: v.default, title: v.default ? "Make another version the default first" : "",
      onclick: () => confirm(`Uninstall Node ${m}? Its global npm packages are removed too. Projects and sites that use Node ${m} fall back to the default version until you install it again.`) &&
        run(ctx, m, "Uninstalling…", () => api(path, { method: "DELETE" })) }, "Uninstall…"));
  }
  if (step) actions.forEach((b) => { b.disabled = true; });

  const status = v.update ? h("span", { class: "accent" }, "Update available") : installed ? "Up to date" : "Not installed";
  return h("div", { class: "card" }, h("div", { class: "version" + (installed ? " installed" : "") },
    icon("brand-nodejs", 20),
    h("div", { class: "grow" },
      h("div", { class: "title" }, h("strong", {}, `Node ${m}`),
        h("span", { class: "muted" }, v.update ? `${v.installed} → ${v.latest}` : v.installed || v.latest),
        v.default && h("span", { class: "badge" }, "Default")),
      h("div", { class: "detail" }, step || [status,
        v.npm && ` · npm ${v.npm}`,
        v.npm_latest && h("span", { class: "accent" }, ` (npm ${v.npm_latest} available)`)])),
    h("div", { class: "row" }, ...actions)));
}

export default {
  title: "Node",
  subtitle: "node, npm and npx follow the project's .nvmrc / .node-version, then the site's version, then the default.",
  icon: "brand-nodejs",
  color: "#16a34a",
  render(ctx) {
    // The first run installs the default Node.js; only the status shows that. Once it's done
    // (or failed), the versions show the result.
    const node = ctx.status.defaults?.node;
    const defaultInstalling = node?.state === "installing" && node.version ? node.version : null;
    const changed = installingDefault !== defaultInstalling;
    installingDefault = defaultInstalling;

    root = h("div", {}, h("style", {}, css));
    // First shown, back on this pane after a while, or the default's install ended: load again.
    if (changed || Date.now() - loadedAt > 30000) load(ctx);
    if (!versions) {
      root.append(h("div", { class: "empty" }, error || "Loading Node.js versions…"));
      return root;
    }

    const check = h("button", { class: "link", disabled: checking, onclick: async () => {
      checking = true;
      ctx.rerender();
      await load(ctx, "/v1/node/check", "POST");
      checking = false;
      ctx.rerender();
    } }, checking ? "Checking…" : "Check now");

    root.append(
      error && h("div", { class: "error" }, error),
      h("div", { class: "versions" },
        h("div", { class: "head" }, h("strong", {}, "Versions"),
          h("span", { class: "muted" }, versions.checked_at ? `Checked ${ago(versions.checked_at)}` : "Not checked yet"), check),
        ...versions.versions.map((v) => row(ctx, v, defaultInstalling)),
        !versions.versions.length && h("div", { class: "card empty" }, "No Node.js versions to show yet."),
        versions.check_error && h("div", { style: "color: var(--warn); font-size: 12px" }, `⚠ Couldn't check for updates: ${versions.check_error}`)),
      h("p", { class: "footnote" }, "Official Node.js builds, the newest release of each major. A project that pins a version in .nvmrc gets that major offered when you run node, npm or npx there. ",
        "Global packages (npm install -g) belong to a Node line and survive its updates; those of the default version are on your PATH."));
    return root;
  },
};
