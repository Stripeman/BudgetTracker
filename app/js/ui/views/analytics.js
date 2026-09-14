// Site usage (BT-012-01, Terry 2026-09-14: "i would like to add a usage statistics on the site for
// the site admin ... these stats should include what users, how many users, frequency of use, last
// log ins etc. should use nice graphics"). Site-admin only, both server-side (`GET /api/analytics`
// is 401/403 for anyone else and the SWA route itself is siteadmin-only) and here: the page shows
// nothing and fetches nothing unless the signed-in person is a site administrator.
//
// HARD BOUNDARY: this view shows USAGE/AGGREGATE data only — total and active user counts, sign-in
// and new-user activity per day, and workspace counts by kind and status. Never an account name,
// balance, transaction, merchant, category or workspace name/contents. The person list shows only
// what `/api/analytics` returns (a provider subject and two timestamps) — no name or email, because
// nothing else today shows a site administrator another person's name or email either.
//
// No charting library (the CSP allows only the existing script allowlist): small inline SVG bar and
// line charts, hand-drawn with `svgEl`. Every figure is also given as plain text, the same rule the
// rest of the app uses for its decorative meters (Planning) — here as a visually hidden table beside
// each chart, so the numbers reach anyone the drawing does not.
import { el, mount, svgEl } from "../dom.js";
import { pageHead } from "../components.js";
import { messageFor } from "../../core/errors.js";

const stamp = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "—");
// The subject is an opaque `provider:id` string (never an email or name); shown only to a site
// administrator, on this one aggregate page, exactly as it already appears to the person themself
// on My settings and in BT_SITE_ADMINS configuration.
const short = (subject) => String(subject || "");

function statCard(label, value) {
  return el("div", { class: "card" }, [el("div", { class: "field__label", text: label }), el("div", { class: "card__value", text: String(value) })]);
}

// A minimal inline SVG bar chart. Decorative (aria-hidden): the figures are also given as real text
// by `figureTable`, right beside it.
export function barChart(points, { width = 480, height = 120 } = {}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const n = Math.max(1, points.length);
  const barWidth = width / n;
  const svg = svgEl("svg", { class: "chart chart--bars", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  points.forEach((p, i) => {
    const h = Math.round((p.count / max) * (height - 4));
    svg.appendChild(svgEl("rect", { class: "chart__bar", x: i * barWidth + 1, y: height - h, width: Math.max(1, barWidth - 2), height: Math.max(0, h) }));
  });
  return svg;
}

// A minimal inline SVG line chart (used for the cumulative growth line).
export function lineChart(points, { width = 480, height = 120 } = {}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => [Math.round(i * stepX), Math.round(height - (p.count / max) * (height - 4) - 2)]);
  const svg = svgEl("svg", { class: "chart chart--line", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  svg.appendChild(svgEl("polyline", { class: "chart__line", points: coords.map(([x, y]) => `${x},${y}`).join(" ") }));
  for (const [x, y] of coords) svg.appendChild(svgEl("circle", { class: "chart__point", cx: x, cy: y, r: 2 }));
  return svg;
}

// The same figures as real text, for anyone the drawing does not reach (screen readers, printing,
// copying numbers) — visually hidden, beside the chart it describes.
function figureTable(points, caption) {
  return el("table", { class: "sr-only" }, [
    el("caption", { text: caption }),
    el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "Date" }), el("th", { scope: "col", text: "Count" })])]),
    el("tbody", {}, points.map((p) => el("tr", {}, [el("th", { scope: "row", text: p.date }), el("td", { text: String(p.count) })]))),
  ]);
}

function chartCard(id, title, points, chart, caption) {
  return el("section", { class: "card", "aria-labelledby": id }, [
    el("h2", { class: "card__title", id, text: title }),
    chart(points),
    figureTable(points, caption),
  ]);
}

export function createView(ctx) {
  const { api } = ctx;
  const notAdmin = el("p", { class: "muted", text: "Site usage is only shown to site administrators." });
  const status = el("p", { class: "field__help", role: "status" });
  const totalsBox = el("div", { class: "grid grid--cards" });
  const chartsBox = el("div", { class: "grid grid--two" });
  const workspacesBox = el("div");
  const usersBox = el("div");
  const content = el("div", { class: "stack", hidden: true }, [
    el("p", { class: "field__help", text: "Usage and activity only. Site administration never sees financial records: no account, balance, transaction, budget, merchant, category or workspace content." }),
    status,
    totalsBox,
    chartsBox,
    el("section", { class: "card", "aria-labelledby": "usage-workspaces" }, [el("h2", { class: "card__title", id: "usage-workspaces", text: "Workspaces" }), workspacesBox]),
    el("section", { class: "card card--full", "aria-labelledby": "usage-people" }, [el("h2", { class: "card__title", id: "usage-people", text: "People" }), usersBox]),
  ]);
  const element = el("section", {}, [pageHead("Site usage"), notAdmin, content]);

  const WS_KIND_LABEL = { personal: "Personal", household: "Household", group: "Shared-expense group", trip: "Trip" };
  const WS_STATUS_LABEL = { active: "active", archived: "archived" };

  function renderData(data) {
    mount(totalsBox,
      statCard("Total users", data.totals.users),
      statCard("Active this week", data.totals.activeThisWeek),
      statCard("Workspaces", data.totals.workspaces));
    // Users over time: a cumulative line built from the daily new-user counts the server returns.
    let running = 0;
    const cumulative = data.newUsersPerDay.map((p) => ({ date: p.date, count: (running += p.count) }));
    mount(chartsBox,
      chartCard("usage-growth", `Users, last ${data.newUsersPerDay.length} days`, cumulative, lineChart, "New users added, running total"),
      chartCard("usage-signins", `Sign-ins per day, last ${data.signInsPerDay.length} days`, data.signInsPerDay, barChart, "Sign-ins per day"));
    const wsEntries = Object.entries(data.workspacesByKindStatus || {});
    mount(workspacesBox, wsEntries.length
      ? el("ul", { class: "stack" }, wsEntries.map(([key, count]) => {
        const [kind, wsStatus] = key.split(":");
        return el("li", { class: "row" }, [el("span", { text: `${WS_KIND_LABEL[kind] || kind}, ${WS_STATUS_LABEL[wsStatus] || wsStatus}` }), el("span", { class: "app__spacer" }), el("span", { class: "num", text: String(count) })]);
      }))
      : el("p", { class: "muted small", text: "No workspaces yet." }));
    mount(usersBox, data.users.length
      ? el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "People" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "Person" }), el("th", { text: "First seen" }), el("th", { text: "Last active" })])]),
        el("tbody", {}, data.users.map((u) => el("tr", {}, [
          el("td", { "data-label": "Person", text: short(u.subject) }),
          el("td", { "data-label": "First seen", text: stamp(u.createdAt) }),
          el("td", { "data-label": "Last active", text: stamp(u.lastActiveAt) }),
        ]))),
      ])])
      : el("p", { class: "muted small", text: "No activity recorded yet." }));
    status.textContent = data.usersTruncated ? `Showing the ${data.users.length} most recently active people.` : "";
  }

  let loaded = false;
  async function load() {
    status.textContent = "Loading…";
    try {
      const data = await api.analytics();
      renderData(data);
    } catch (err) {
      status.textContent = "";
      mount(usersBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
    }
  }

  function update(state) {
    const isAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    notAdmin.hidden = isAdmin;
    content.hidden = !isAdmin;
    if (isAdmin && !loaded) { loaded = true; void load(); }
  }

  return { element, update };
}
