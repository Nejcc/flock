// Settings → Mail: the SMTP server that catches every email, and the .env lines that point an app
// at it.
import { api, h, openWindow } from "../app.js";

function field(label, ...content) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), h("div", { class: "grow" }, ...content));
}

export default {
  title: "Mail",
  subtitle: "Flock catches every email your apps send — nothing leaves your computer.",
  icon: "mail",
  color: "#0ea5e9",
  render(ctx) {
    const st = ctx.status;
    const status = h("span", {}, "…");
    const env = h("pre", { class: "card mono selectable", style: "margin:0; padding:10px 12px; white-space:pre-wrap" });
    // GET /v1/services carries the mail service's state and its .env snippet.
    api("/v1/services").then((services) => {
      const mail = services.find((s) => s.id === "mail");
      status.textContent = mail?.running ? "Running" : mail?.problem || "Stopped";
      env.textContent = mail?.env || "";
    }).catch((err) => { status.textContent = err.message; });

    return h("div", {},
      h("div", { class: "group" }, h("h3", {}, "SMTP server"),
        field("Host", h("span", { class: "mono" }, "127.0.0.1")),
        field("Port", h("span", { class: "mono" }, ctx.config.ports?.smtp || "—")),
        field("Status", status)),
      h("div", { class: "group" }, h("h3", {}, "Environment variables"), env,
        h("div", { class: "hint muted", style: "margin-top:6px" }, "MAIL_USERNAME picks the inbox, so every project gets its own.")),
      h("div", { class: "group" },
        field("Caught emails", h("div", { class: "row" }, h("span", { class: "grow" }, String(st.mail_count || 0)),
          h("button", { onclick: () => openWindow("mail") }, "Open Mail")))));
  },
};
