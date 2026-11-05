"use strict";
// Review pages. TOKEN is defined by an inline script in each HTML page.

async function api(method, path, body) {
  const opts = { method, headers: { "X-MeetNotes-Token": TOKEN } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.detail) || ("HTTP " + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  for (const k of kids) e.append(k);
  return e;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? String(iso).slice(0, 10) : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// ---------- index page ----------
async function initIndex() {
  const app = document.getElementById("app");
  let list;
  try { list = await api("GET", "/meetings"); }
  catch (e) { app.append(el("div", { className: "err", textContent: "Could not load meetings: " + e.message })); return; }
  if (!list.length) { app.textContent = "No meetings yet."; return; }
  const table = el("table", { className: "list" });
  table.append(el("tr", {}, ...["Title", "Type", "Date", "Status"].map((h) => el("th", { textContent: h }))));
  for (const m of list) {
    const link = el("a", { href: "/meetings/" + encodeURIComponent(m.id), textContent: m.title || m.id });
    table.append(el("tr", {}, el("td", {}, link), el("td", { textContent: m.type || "" }),
      el("td", { textContent: fmtDate(m.started_at) }), el("td", { textContent: m.status || "" })));
  }
  app.append(table);
}

// ---------- meeting page ----------
function initMeeting() {
  const id = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop());
  const $ = (x) => document.getElementById(x);
  const base = "/meetings/" + encodeURIComponent(id);
  const tas = { email: $("ta-email"), notes: $("ta-notes") };
  let data = null, poll = null, confirming = false, renaming = null;
  const timers = {}, dirty = {};

  function setSaved(text, cls) { const s = $("saved"); s.textContent = text; s.className = cls || "meta"; }

  async function save(name) {
    clearTimeout(timers[name]);
    if (!dirty[name]) return;
    dirty[name] = false;
    setSaved("Saving...");
    try { await api("PUT", `${base}/docs/${name}`, { text: tas[name].value }); setSaved("Saved ✓", "ok"); }
    catch (e) { dirty[name] = true; setSaved("Save failed: " + e.message, "err"); }
  }
  for (const name of ["email", "notes"]) {
    tas[name].addEventListener("input", () => {
      dirty[name] = true; setSaved("Saving...");
      clearTimeout(timers[name]);
      timers[name] = setTimeout(() => save(name), 1000);
    });
  }
  const flush = () => Promise.all(["email", "notes"].map(save));

  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === b));
    for (const n of ["email", "notes", "transcript"]) $("pane-" + n).hidden = n !== b.dataset.tab;
  }));

  const uncertainOnly = (name) => {
    const ts = data.turns.filter((t) => t.speaker === name);
    return ts.length > 0 && ts.every((t) => t.uncertain);
  };

  function renderSpeakers() {
    const box = $("speakers");
    box.replaceChildren();
    const sent = data.status === "sent";
    for (const name of data.speakers) {
      const warn = uncertainOnly(name);
      if (renaming === name) {
        const input = el("input", { value: name, size: Math.max(8, name.length) });
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          const nv = input.value.trim();
          renaming = null;
          if (commit && nv && nv !== name) {
            try { await flush(); await api("POST", `${base}/speakers`, { old: name, new: nv }); await load(true); }
            catch (e) { setSaved("Rename failed: " + e.message, "err"); renderSpeakers(); }
          } else renderSpeakers();
        };
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") finish(true); else if (ev.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        box.append(el("span", { className: "chip" + (warn ? " warn" : "") }, input), " ");
        input.focus(); input.select();
        continue;
      }
      const chip = el("button", { className: "chip" + (warn ? " warn" : ""), disabled: sent,
        title: "Click to rename", textContent: name + (warn ? " → rename?" : "") });
      chip.addEventListener("click", () => { renaming = name; renderSpeakers(); });
      box.append(chip, " ");
    }
  }

  function renderTranscript() {
    const pane = $("pane-transcript");
    pane.replaceChildren();
    if (!data.turns.length) { pane.textContent = "No transcript yet."; return; }
    for (const t of data.turns) {
      const row = el("div", { className: "row" + (t.uncertain ? " u" : "") },
        el("span", { className: "t", textContent: "[" + fmtDuration(t.start_ms) + "]" }),
        el("span", { className: "who", textContent: t.speaker + ":" }),
        el("span", { className: "txt", dir: "auto", textContent: t.text }));
      if (t.uncertain) row.append(el("span", { className: "unc", textContent: "(uncertain)" }));
      pane.append(row);
    }
  }

  function renderBanner() {
    const b = $("banner");
    b.replaceChildren();
    b.hidden = data.status !== "processing" && data.status !== "error";
    if (data.status === "processing") {
      b.textContent = "Processing... current step: " + (data.step || "starting");
    } else if (data.status === "error") {
      b.append(el("div", { className: "err", textContent: "Failed: " + (data.error || "unknown error") }));
      const btn = el("button", { className: "btn", textContent: "Retry" });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try { await api("POST", `${base}/retry`); await load(true); }
        catch (e) { btn.disabled = false; b.append(el("div", { className: "err", textContent: e.message })); }
      });
      b.append(btn);
    }
  }

  function render(overwrite) {
    const d = data;
    $("title").textContent = d.title || d.id;
    document.title = (d.title || d.id) + " - Meet Notes";
    $("meta").replaceChildren(`${d.type || ""} · ${fmtDate(d.started_at)} · ${fmtDuration(d.duration_ms)} · `,
      el("span", { className: "status " + d.status, textContent: d.status }));
    renderBanner();
    $("main").hidden = d.status === "processing" || (d.status === "error" && !d.turns.length);
    const sent = d.status === "sent";
    if (overwrite || !dirty.email) tas.email.value = d.email || "";
    if (overwrite || !dirty.notes) tas.notes.value = d.notes || "";
    tas.email.readOnly = tas.notes.readOnly = sent || d.status !== "ready";
    renderSpeakers();
    renderTranscript();
    const rec = $("recipients"), btn = $("send");
    rec.readOnly = sent || d.status !== "ready";
    btn.disabled = d.status !== "ready";
    if (sent) {
      setSaved("Sent at " + fmtDate(d.sent_at), "ok");
      if (d.recipients && d.recipients.length) rec.value = d.recipients.join(", ");
      btn.textContent = "Sent";
    }
  }

  async function load(overwrite) {
    try { data = await api("GET", base); }
    catch (e) { $("title").textContent = "Could not load meeting"; $("meta").textContent = e.message; return; }
    render(overwrite);
    clearTimeout(poll);
    if (data.status === "processing") poll = setTimeout(() => load(true), 3000);
  }

  // ----- send -----
  const parseRecipients = () => $("recipients").value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const resetSend = () => { confirming = false; $("send").classList.remove("confirm"); $("send").textContent = "Send email"; };
  $("recipients").addEventListener("input", () => { if (confirming) resetSend(); });
  $("send").addEventListener("click", async () => {
    const msg = $("sendmsg"), btn = $("send"), rs = parseRecipients();
    msg.textContent = ""; msg.className = "";
    if (!rs.length) { msg.textContent = "Add at least one recipient."; msg.className = "err"; resetSend(); return; }
    if (!confirming) {
      confirming = true; btn.classList.add("confirm");
      btn.textContent = `Confirm send to ${rs.length} recipient${rs.length === 1 ? "" : "s"}`;
      return;
    }
    btn.disabled = true; btn.textContent = "Sending...";
    try {
      await flush();
      await api("POST", `${base}/send`, { recipients: rs });
      resetSend(); await load(true);
    } catch (e) {
      resetSend(); btn.disabled = false;
      msg.textContent = (e.status === 502 ? "Send failed: " : "") + e.message; msg.className = "err";
    }
  });

  api("GET", "/config/recipients").then((r) => {
    if (Array.isArray(r) && !$("recipients").value) $("recipients").value = r.join(", ");
  }).catch(() => {});
  load(true);
}

if (document.getElementById("pane-email")) initMeeting();
else if (document.getElementById("app")) initIndex();
