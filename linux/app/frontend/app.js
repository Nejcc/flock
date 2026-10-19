// Shared by the pages: the daemon's API (/api/…), the app's own actions (/app/…) and a small DOM
// builder that sets text, never HTML, so mail subjects and log lines can't inject markup.

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return (res.headers.get("Content-Type") || "").includes("json") ? res.json() : res.text();
}

export async function app(path) {
  const res = await fetch("/app/" + path, { method: "POST" });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export const openURL = (url) => app("open?url=" + encodeURIComponent(url));
export const openWindow = (name) => app("window/" + name);

// h("div", {class: "row", onclick: f}, "text", child, …)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false || c === "") continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function ago(date) {
  const s = (Date.now() - new Date(date)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(date).toLocaleDateString();
}

export function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Runs fn now and every ms while the window is shown, like the apps' 2-second status poll.
export function poll(fn, ms = 2000) {
  fn();
  setInterval(() => document.hidden || fn(), ms);
  document.addEventListener("visibilitychange", () => document.hidden || fn());
}

// A folder the user picks in the system's dialog, or "" when they cancel.
export async function pickFolder(title) {
  const res = await fetch("/app/pick-folder?title=" + encodeURIComponent(title), { method: "POST" });
  return (await res.text()).trim();
}
