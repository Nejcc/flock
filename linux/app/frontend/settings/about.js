// Settings → About: versions, the data folder, the docs, reporting an issue, and the license.
import { app, h, openURL } from "../app.js";

function field(label, ...content) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), h("div", { class: "grow" }, ...content));
}

// A blank GitHub issue with the versions filled in, so reports say what they run on.
function issueURL(ctx) {
  const body = `\n\n---\nDaemon: ${ctx.status?.version || "not running"}\nOS: Linux (${navigator.userAgent})\n`;
  return "https://github.com/flock-php/flock/issues/new?body=" + encodeURIComponent(body);
}

export default {
  title: "About",
  subtitle: "A native local development environment for Laravel.",
  icon: "info-circle",
  color: "#64748b",
  render(ctx) {
    const root = ctx.config.root;
    const open = (label, url) => h("button", { onclick: () => openURL(url) }, label);
    return h("div", {},
      h("div", { class: "row", style: "gap:20px; margin: 8px 0 20px" },
        h("img", { src: "icon.png", width: 72, height: 72, alt: "" }),
        h("div", {}, h("div", { style: "font-size:24px; font-weight:650" }, "Flock"),
          h("div", { class: "muted" }, "A native local development environment for Laravel."))),
      h("div", { class: "group" },
        field("Version", h("span", { class: "mono selectable" }, ctx.status.version)),
        field("Data folder", h("div", { class: "row" }, h("span", { class: "grow mono selectable ellipsis" }, root),
          h("button", { onclick: () => app("folder?path=" + encodeURIComponent(root)) }, "Show"))),
        field("Documentation", open("Open", "https://flockphp.com/docs")),
        field("Found a bug?", h("div", { class: "row" }, h("span", { class: "grow hint" }, "Opens a new GitHub issue with your versions filled in."),
          open("Report an issue", issueURL(ctx)))),
        field("License", h("div", { class: "row" }, h("span", { class: "grow hint" }, "Copyright © Guava s.r.o. Licensed under the AGPL-3.0."),
          open("View", "https://github.com/flock-php/flock/blob/main/LICENSE")))),
      h("div", { class: "group" }, h("h3", {}, "Uninstall"),
        field("Uninstall Flock", h("span", { class: "hint" }, "Run ", h("code", { class: "mono" }, "flock-php uninstall"),
          " in a terminal, then remove the app with your package manager. Your sites, databases and settings are kept; add ",
          h("code", { class: "mono" }, "--purge"), " to delete them too."))));
  },
};
