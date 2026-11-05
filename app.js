const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
document.documentElement.dataset.theme = tg?.colorScheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cls = s => "st-" + String(s || "").toLowerCase().replace(/\W/g, "");
const S = { emp: {}, reports: [], cfg: { shifts: [], services: [] }, guides: [], tab: "home", W: null, open: null };

async function api(path, opt = {}) {
  opt.headers = { "Content-Type": "application/json", "X-Telegram-Init-Data": tg?.initData || "" };
  const r = await fetch(path, opt);
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(d?.detail || "Request failed");
  return d;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.className = "show"; setTimeout(() => t.className = "", 2800); }
const today = () => new Date().toLocaleDateString("en-CA");
const view = h => { $("#view").innerHTML = h; };

// ---------- main screens ----------
function render() {
  document.body.classList.toggle("wiz", !!S.W);
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === S.tab));
  if (S.W) return wizard();
  ({ home, reports, guides, profile }[S.tab])();
}
function home() {
  const done = S.reports.find(r => r.report_date === today());
  const name = (S.emp.full_name || "").split(" ")[0];
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const admin = /admin/i.test(S.emp.role || "");
  view(`<p class="mute">Flemingo IT service desk</p><h1>Hello${name ? ", " + esc(name) : ""}</h1>
  <div class="card hero"><p class="mute">Today's duty report</p><div class="big">${date}</div>
  ${done ? `<span class="chip ${cls(done.review_status)}">Submitted · ${esc(done.review_status)}</span>
  <button class="btn alt" style="margin-top:14px;color:#fff" data-a="detail" data-v="${done.id}">View report</button>`
  : `<button class="btn" data-a="start">Start today's report</button>`}</div>
  <h2>Recent reports</h2>${S.reports.slice(0, 3).map(rrow).join("") || '<p class="mute">No reports yet. Your first one will appear here.</p>'}
  ${admin ? `<h2>Admin tools</h2>${["Admin approval","Search reports","Analytics","Manage shifts","Service checklist","Guidelines","Announcements"].map(t => `<button class="row" data-a="soon">${t}<span class="mute">Soon</span></button>`).join("")}` : ""}`);
}
const rrow = r => `<button class="row" data-a="detail" data-v="${r.id}"><span><b>${esc(r.report_date)}</b><br><span class="mute">${esc(r.shift)}</span></span><span class="chip ${cls(r.review_status)}">${esc(r.review_status)}</span></button>`;
function reports() {
  view(`<h1>My reports</h1><p class="mute">${S.reports.length} submitted</p><div style="height:12px"></div>${S.reports.map(rrow).join("") || '<p class="mute">Nothing here yet. Start a report from Home.</p>'}`);
}
function detail(id) {
  const r = S.reports.find(x => String(x.id) === String(id)); if (!r) return;
  const f = (l, v) => v ? `<div class="card"><span class="mute">${l}</span><pre>${esc(v)}</pre></div>` : "";
  view(`<button class="back" data-a="tab" data-v="${S.tab}">‹ Back</button><h1>${esc(r.report_date)}</h1>
  <p><span class="chip ${cls(r.review_status)}">${esc(r.review_status)}</span> <span class="mute">${esc(r.shift)} · ${esc(r.duty_start)}–${esc(r.duty_end)} · ${esc(r.report_location)}</span></p><div style="height:12px"></div>
  ${f("Activities", r.activities)}${f("Problems", r.problems)}${f("Pending tasks", r.pending_tasks)}${f("Comments", r.comments)}`);
}
function guides() {
  view(`<h1>IT guidelines</h1><div style="height:12px"></div>${S.guides.map(g => `<div class="card"><button class="row" style="border:0;padding:0;margin:0;background:none" data-a="open" data-v="${g.id}"><span><b>${esc(g.title)}</b><br><span class="mute">${esc(g.category)}</span></span><span>${S.open == g.id ? "▾" : "▸"}</span></button>${S.open == g.id ? `<pre>${esc(g.content)}</pre>` : ""}</div>`).join("") || '<p class="mute">No guidelines are published yet.</p>'}`);
}
function profile() {
  const e = S.emp, f = (l, v) => `<div class="row"><span class="mute">${l}</span><b>${esc(v || "-")}</b></div>`;
  view(`<h1>${esc(e.full_name || "My profile")}</h1><p class="mute">${esc(e.role || "employee")}</p><div style="height:12px"></div>
  ${f("Job title", e.job_title)}${f("Work location", e.work_location)}${f("Office", e.office)}<p class="mute" style="margin-top:12px">Change these from the bot's profile menu for now.</p>`);
}

// ---------- report wizard ----------
const STAT = [["Operational", "ok"], ["Issue Found", "bad"], ["Under Maintenance", "warn"], ["Not Applicable", ""]];
function start() {
  const sh = S.cfg.shifts[0] || {};
  S.W = { step: 0, date: today(), shift: sh.name || "", start: sh.start_time || "", end: sh.end_time || "", loc: S.emp.work_location || "", checks: {}, acts: [], ad: "", as: "Completed", an: "", problems: "", pending: "", comments: "" };
  render();
}
function wizard() {
  const W = S.W, n = S.cfg.services.length, got = Object.keys(W.checks).length;
  let body = "";
  if (W.step === 0) body = `<h1>Duty details</h1><label>Date</label><input type="date" data-k="date" value="${W.date}">
  <label>Shift</label><div class="seg">${S.cfg.shifts.map(s => `<button class="${W.shift === s.name ? "on" : ""}" data-a="shift" data-v="${esc(s.name)}">${esc(s.name)}</button>`).join("")}</div>
  <label>Start</label><input type="time" data-k="start" value="${W.start}"><label>End</label><input type="time" data-k="end" value="${W.end}">
  <label>Work location</label><input data-k="loc" value="${esc(W.loc)}">`;
  if (W.step === 1) body = `<h1>Service checks</h1><p class="mute">${got} of ${n} checked</p>` + S.cfg.services.map(s => `<div class="card"><b>${esc(s)}</b><div class="seg">${STAT.map(([t, c]) => `<button class="${c} ${W.checks[s] === t ? "on" : ""}" data-a="svc" data-s="${esc(s)}" data-v="${t}">${t}</button>`).join("")}</div></div>`).join("");
  if (W.step === 2) body = `<h1>Activities and notes</h1>${W.acts.map((a, i) => `<div class="card"><span class="chip ${cls(a.status)}">${esc(a.status)}</span> ${esc(a.description)}${a.next_action ? `<p class="mute">Next: ${esc(a.next_action)}</p>` : ""}<button class="back" data-a="del" data-v="${i}">Remove</button></div>`).join("")}
  <div class="card"><label style="margin-top:0">What did you do?</label><textarea rows="2" data-k="ad">${esc(W.ad)}</textarea>
  <div class="seg">${["Completed", "In progress", "Remaining"].map(t => `<button class="${W.as === t ? "on" : ""}" data-a="as" data-v="${t}">${t}</button>`).join("")}</div>
  ${W.as !== "Completed" ? `<label>Next action</label><input data-k="an" value="${esc(W.an)}">` : ""}<button class="btn alt" style="margin-top:12px" data-a="add">Add activity</button></div>
  <label>Problems</label><textarea rows="2" data-k="problems">${esc(W.problems)}</textarea><label>Pending tasks</label><textarea rows="2" data-k="pending">${esc(W.pending)}</textarea><label>Comments</label><textarea rows="2" data-k="comments">${esc(W.comments)}</textarea>`;
  view(`<button class="back" data-a="cancel">‹ Cancel</button><div class="bar"><i style="width:${(W.step + 1) * 33.4}%"></i></div><p class="mute">Step ${W.step + 1} of 3</p>${body}
  <div class="foot">${W.step ? '<button class="btn alt" style="width:35%" data-a="prev">Back</button>' : ""}<button class="btn" id="next" data-a="next">${W.step === 2 ? "Submit report" : "Next"}</button></div>`);
}
async function next() {
  const W = S.W;
  if (W.step === 0 && !(W.shift && W.start && W.end && W.loc.trim())) return toast("Choose a shift and fill in times and location.");
  if (W.step === 1 && Object.keys(W.checks).length < S.cfg.services.length) return toast("Give every service a status.");
  if (W.step < 2) { W.step++; scrollTo(0, 0); return render(); }
  if (!W.acts.length) return toast("Add at least one activity.");
  const b = $("#next"); b.disabled = true; b.textContent = "Saving...";
  try {
    const d = await api("/api/reports/submit", { method: "POST", body: JSON.stringify({
      duty_date: W.date, shift: W.shift, duty_start: W.start, duty_end: W.end, report_location: W.loc.trim(),
      service_checks: S.cfg.services.map(s => ({ name: s, status: W.checks[s] })),
      activities: W.acts.map((a, i) => `${i + 1}. ${a.description} - ${a.status}${a.next_action ? " (Next: " + a.next_action + ")" : ""}`).join("\n"),
      activities_checklist: W.acts, problems: W.problems.trim() || null, pending_tasks: W.pending.trim() || null, comments: W.comments.trim() || null }) });
    S.W = null; S.tab = "home"; S.reports = await api("/api/reports/me"); render(); toast(`Report #${d.report_id} submitted`);
  } catch (e) { b.disabled = false; b.textContent = "Submit report"; toast(e.message); }
}

// ---------- events ----------
document.addEventListener("input", e => { const k = e.target.dataset.k; if (k && S.W) S.W[k] = e.target.value; });
document.addEventListener("click", e => {
  const el = e.target.closest("[data-a]"); if (!el) return;
  const a = el.dataset.a, v = el.dataset.v, W = S.W;
  if (a === "tab") { S.tab = v; S.W = null; S.open = null; render(); }
  else if (a === "start") start();
  else if (a === "detail") detail(v);
  else if (a === "open") { S.open = S.open == v ? null : v; guides(); }
  else if (a === "soon") toast("Admin tools are coming soon.");
  else if (a === "cancel") { S.W = null; render(); }
  else if (a === "next") next();
  else if (a === "prev") { W.step--; render(); }
  else if (a === "shift") { const s = S.cfg.shifts.find(x => x.name === v); Object.assign(W, { shift: v, start: s.start_time || W.start, end: s.end_time || W.end }); render(); }
  else if (a === "svc") { const y = scrollY; W.checks[el.dataset.s] = v; render(); scrollTo(0, y); }
  else if (a === "as") { W.as = v; render(); }
  else if (a === "del") { W.acts.splice(+v, 1); render(); }
  else if (a === "add") {
    if (!W.ad.trim()) return toast("Describe the activity first.");
    W.acts.push({ description: W.ad.trim(), status: W.as, reason: null, next_action: W.as === "Completed" ? null : (W.an.trim() || null) });
    Object.assign(W, { ad: "", an: "", as: "Completed" }); render();
  }
});

// ---------- start up ----------
(async () => {
  view('<p class="mute">Loading...</p>');
  try {
    [S.emp, S.reports, S.guides, S.cfg] = await Promise.all([api("/api/employee/me"), api("/api/reports/me"), api("/api/guidelines"), api("/api/config")]);
    render();
  } catch (e) { view(`<h1>Can't open the app</h1><p class="mute">${esc(e.message)}</p>`); }
})();
