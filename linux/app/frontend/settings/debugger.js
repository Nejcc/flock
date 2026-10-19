// Settings → Debugger: Xdebug, loaded only for the requests that ask for it, and PhpStorm's
// breakpoints as a trigger.
import { api, h } from "../app.js";
import { icon } from "../icons.js";

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
  title: "Debugger",
  subtitle: "Step through requests and commands with Xdebug.",
  icon: "bug",
  color: "#22c55e",
  render(ctx) {
    const st = ctx.status;
    const debugging = st.xdebug && st.xdebug_breakpoints ? (st.sites || []).filter((s) => s.debugging) : [];

    return h("div", {},
      h("div", { class: "group" },
        field("Xdebug requests", h("label", { class: "row" }, checkbox(st.xdebug, (on) => settings(ctx, { xdebug: on })), "Detect Xdebug requests"),
          h("div", { class: "hint" }, "Xdebug loads only for requests that ask for it, so everything else stays fast.")),
        field("PhpStorm", h("label", { class: "row" },
          checkbox(st.xdebug_breakpoints, (on) => settings(ctx, { xdebug_breakpoints: on }), !st.xdebug), "Detect PhpStorm breakpoints"),
          h("div", { class: "hint" }, "While a project has breakpoints in PhpStorm, every request to its site is debugged."))),
      debugging.length > 0 && h("div", { class: "group" }, h("h3", {}, "Debugging now"),
        ...debugging.map((s) => field(h("span", { class: "row" }, icon("bug", 14), s.domain), "Breakpoints in PhpStorm"))),
      h("div", { class: "group" }, h("h3", {}, "Connect your IDE"),
        field("Client port", h("span", { class: "mono" }, "9003")),
        field("Mode", h("span", { class: "mono" }, "debug, develop")),
        field("Start a session", h("span", { class: "hint" }, "Set a breakpoint in PhpStorm and listen for debug connections, use the Xdebug browser extension, or add ?XDEBUG_TRIGGER=1 to the URL. On the command line, run `flock-php debug artisan …`."))),
      h("div", { class: "group" }, h("h3", {}, "Availability"),
        ...(ctx.config.php || []).map((p) => field(`PHP ${p.version}`, p.xdebug_available
          ? h("span", { style: "color: var(--ok)" }, "Available")
          : h("span", { class: "muted" }, "Not in this build"))),
        !(ctx.config.php || []).length && h("div", { class: "hint muted" }, "No PHP version installed yet.")));
  },
};
