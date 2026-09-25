import { ensureSignedIn } from "./firebase-init.js";
import {
  fetchGame, claimAdmin, listenGame, listenGroups, listenMembers, listenRound,
  listenLeaderboard, updateGameSettings, setPayoffTable, addGroup, removePlayer,
  advanceRoundManually, forceResolveRound, fetchAllRounds, tableFromFirestore,
} from "./game-engine.js";
import { DEFAULT_PAYOFF_TABLE, MIN_CHOICE, MAX_CHOICE } from "./payoff-table.js";
import { toast, fmtSigned, fmt1, downloadCsv, escapeHtml } from "./util.js";
import { requireInstructorGate } from "./instructor-gate.js";

const params = new URLSearchParams(location.search);
const gameId = params.get("game");
if (!gameId) location.href = "admin.html";

const claimGateEl = document.getElementById("claim-gate");
const dashboardEl = document.getElementById("dashboard");

let game = null;
const groupsMeta = {}; // groupId -> { group, members, round, unsubMembers, unsubRound, watchedRound }
let leaderboard = [];

requireInstructorGate().then(init);

async function init() {
  const uid = await ensureSignedIn();
  const g = await fetchGame(gameId);
  if (!g) {
    claimGateEl.innerHTML = `<div class="panel"><h2>Game not found</h2><p>Double check the code, or <a href="admin.html">create a new game</a>.</p></div>`;
    return;
  }
  if (g.adminUid === uid) return showDashboard();

  const savedPasscode = localStorage.getItem(`mc_pc_${gameId}`);
  if (savedPasscode) {
    try {
      await claimAdmin(gameId, savedPasscode);
      return showDashboard();
    } catch { /* fall through to manual prompt */ }
  }
  renderClaimGate();
}

function renderClaimGate() {
  claimGateEl.innerHTML = `
    <div class="panel" style="max-width:420px;">
      <h2>Enter the admin passcode</h2>
      <p>This game is already open elsewhere, or you're on a new device.</p>
      <form id="claim-form">
        <div class="field">
          <label for="gate-pc">Admin passcode</label>
          <input type="text" id="gate-pc" required />
        </div>
        <button class="btn btn--primary" type="submit">Open dashboard</button>
      </form>
    </div>`;
  document.getElementById("claim-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pc = document.getElementById("gate-pc").value.trim();
    try {
      await claimAdmin(gameId, pc);
      localStorage.setItem(`mc_pc_${gameId}`, pc);
      showDashboard();
    } catch {
      toast("Incorrect passcode.", "error");
    }
  });
}

function showDashboard() {
  claimGateEl.innerHTML = "";
  dashboardEl.style.display = "block";

  listenGame(gameId, (g) => { game = g; renderHeader(); });
  listenGroups(gameId, (groups) => { reconcileGroups(groups); renderBoard(); });
  listenLeaderboard(gameId, (players) => { leaderboard = players; renderLeaderboard(); });

  document.getElementById("add-group-btn").addEventListener("click", async () => {
    await addGroup(gameId, game?.groupSize || 8);
  });
  document.getElementById("export-btn").addEventListener("click", exportCsv);
  wirePayoffEditor();
  wireBoardActions();
}

// ---------- header ----------

function renderHeader() {
  if (!game) return;
  const statusLabel = { setup: "Not started", active: "Active", paused: "Paused", completed: "Ended" }[game.status] || game.status;
  const dotClass = game.status === "active" ? "dot--live" : game.status === "completed" ? "dot--done" : "dot--wait";

  document.getElementById("dash-header").innerHTML = `
    <div class="panel">
      <div class="panel__header">
        <div>
          <h1 style="margin-bottom:4px;">${escapeHtml(game.name)}</h1>
          <span class="badge"><span class="dot ${dotClass}"></span> ${statusLabel}</span>
        </div>
        <div style="text-align:right;">
          <div class="hint">Game code</div>
          <div class="code-display">${gameId}</div>
        </div>
      </div>
      <div class="btn-row" style="flex-wrap:wrap;">
        ${game.status === "setup" ? `<button class="btn btn--primary" id="btn-start">Start game</button>` : ""}
        ${game.status === "active" ? `<button class="btn" id="btn-pause">Pause</button>` : ""}
        ${game.status === "paused" ? `<button class="btn btn--primary" id="btn-resume">Resume</button>` : ""}
        ${game.status === "active" || game.status === "paused" ? `<button class="btn btn--danger" id="btn-end">End game</button>` : ""}
        <label style="display:flex; align-items:center; gap:8px; margin:0; width:auto;">
          <input type="checkbox" id="btn-auto" ${game.autoResolve ? "checked" : ""} style="width:auto;" />
          Auto-resolve rounds
        </label>
      </div>
      <p class="hint" style="margin-top:14px;">Share the code above, or send students to <span class="num">/join.html?code=${gameId}</span></p>
    </div>`;

  document.getElementById("btn-start")?.addEventListener("click", () => updateGameSettings(gameId, { status: "active" }));
  document.getElementById("btn-pause")?.addEventListener("click", () => updateGameSettings(gameId, { status: "paused" }));
  document.getElementById("btn-resume")?.addEventListener("click", () => updateGameSettings(gameId, { status: "active" }));
  document.getElementById("btn-end")?.addEventListener("click", () => {
    if (confirm("End the game for everyone? This can't be undone.")) {
      updateGameSettings(gameId, { status: "completed" });
    }
  });
  document.getElementById("btn-auto")?.addEventListener("change", (e) => {
    updateGameSettings(gameId, { autoResolve: e.target.checked });
  });
}

// ---------- groups board ----------

function reconcileGroups(groups) {
  for (const g of groups) {
    if (!groupsMeta[g.id]) {
      groupsMeta[g.id] = { group: g, members: [], round: null, unsubMembers: null, unsubRound: null, watchedRound: null };
      groupsMeta[g.id].unsubMembers = listenMembers(gameId, g.id, (members) => {
        groupsMeta[g.id].members = members;
        renderBoard();
      });
    }
    const meta = groupsMeta[g.id];
    meta.group = g;
    if (meta.watchedRound !== g.currentRound) {
      if (meta.unsubRound) meta.unsubRound();
      meta.watchedRound = g.currentRound;
      meta.unsubRound = listenRound(gameId, g.id, g.currentRound, (r) => {
        meta.round = r;
        renderBoard();
      });
    }
  }
}

function renderBoard() {
  const metas = Object.values(groupsMeta).sort((a, b) => a.group.index - b.group.index);
  document.getElementById("group-board").innerHTML = metas.map(groupCardHtml).join("");
}

function groupCardHtml({ group, members, round }) {
  const finished = group.status === "finished";
  const submittedCount = round ? Object.keys(round.choices || {}).length : 0;
  const roundOpen = round && round.status === "open";
  const roundResolved = round && round.status === "resolved";

  const dotClass = finished ? "dot--done" : roundOpen ? "dot--wait" : "dot--live";
  const statusText = finished ? "Finished" : roundOpen ? `${submittedCount}/${group.capacity} submitted` : roundResolved ? "Round resolved" : "Waiting to begin";

  const memberRows = members
    .sort((a, b) => (a.joinedAt?.seconds || 0) - (b.joinedAt?.seconds || 0))
    .map((m) => {
      const didSubmit = roundOpen && round.choices && round.choices[m.id] !== undefined;
      return `
        <li class="${didSubmit ? "submitted" : ""}">
          <span>${escapeHtml(m.name)} ${didSubmit ? "✓" : ""}</span>
          <button class="btn btn--ghost btn--small" data-action="remove" data-group="${group.id}" data-uid="${m.id}" title="Remove">✕</button>
        </li>`;
    })
    .join("") || `<li class="hint">No one has joined yet</li>`;

  const canForceResolve = roundOpen && submittedCount > 0;
  const canAdvance = round && round.status === "resolved" && !finished;

  return `
    <div class="group-card">
      <div class="group-card__title">
        <h3>${escapeHtml(group.label)}</h3>
        <span class="badge"><span class="dot ${dotClass}"></span> ${statusText}</span>
      </div>
      <div class="hint">${members.length}/${group.capacity} seated · Round ${Math.min(group.currentRound, game?.totalRounds || group.currentRound)}/${game?.totalRounds ?? "—"}</div>
      ${roundResolved ? `<div class="hint">Median this round: ${fmt1(round.median)} (col ${round.medianColumn})</div>` : ""}
      <ul class="member-list">${memberRows}</ul>
      <div class="btn-row">
        ${canForceResolve ? `<button class="btn btn--small" data-action="force" data-group="${group.id}">Force resolve</button>` : ""}
        ${!game?.autoResolve && canAdvance ? `<button class="btn btn--small btn--primary" data-action="advance" data-group="${group.id}">Advance round</button>` : ""}
      </div>
    </div>`;
}

function wireBoardActions() {
  document.getElementById("group-board").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const groupId = btn.dataset.group;
    const meta = groupsMeta[groupId];
    try {
      if (btn.dataset.action === "remove") {
        if (confirm("Remove this player? They'll need to rejoin with the game code.")) {
          await removePlayer(gameId, groupId, btn.dataset.uid);
        }
      } else if (btn.dataset.action === "force") {
        if (confirm("Resolve this round now? Anyone who hasn't submitted yet gets no payoff for it.")) {
          await forceResolveRound(gameId, groupId, meta.group.currentRound);
        }
      } else if (btn.dataset.action === "advance") {
        await advanceRoundManually(gameId, groupId);
      }
    } catch (err) {
      toast(err.message || "That action failed.", "error");
    }
  });
}

// ---------- payoff editor ----------

let editorBuilt = false;

function wirePayoffEditor() {
  const wrap = document.getElementById("payoff-editor-wrap");
  document.getElementById("toggle-payoff-edit").addEventListener("click", () => {
    if (!editorBuilt) {
      const table = tableFromFirestore(game?.payoffTable) || DEFAULT_PAYOFF_TABLE;
      wrap.innerHTML = buildEditorHtml(table) + `<button class="btn btn--primary" id="save-payoff" style="margin-top:12px;">Save payoff table</button>`;
      editorBuilt = true;
      document.getElementById("save-payoff").addEventListener("click", async () => {
        await setPayoffTable(gameId, readEditorTable());
        toast("Payoff table saved.");
      });
    }
    wrap.style.display = wrap.style.display === "none" ? "block" : "none";
  });
}

function buildEditorHtml(table) {
  let head = `<tr><th>Choice \\ Median</th>` + Array.from({ length: 14 }, (_, i) => `<th>${i + 1}</th>`).join("") + `</tr>`;
  let rows = "";
  for (let c = MIN_CHOICE; c <= MAX_CHOICE; c++) {
    rows += `<tr><th>${c}</th>`;
    for (let m = MIN_CHOICE; m <= MAX_CHOICE; m++) {
      rows += `<td><input type="number" step="0.1" id="pte-${c}-${m}" value="${table[c - 1][m - 1]}" /></td>`;
    }
    rows += `</tr>`;
  }
  return `<div class="table-scroll"><table class="grid-table">${head}${rows}</table></div>`;
}

function readEditorTable() {
  const table = [];
  for (let c = MIN_CHOICE; c <= MAX_CHOICE; c++) {
    const row = [];
    for (let m = MIN_CHOICE; m <= MAX_CHOICE; m++) {
      row.push(parseFloat(document.getElementById(`pte-${c}-${m}`).value));
    }
    table.push(row);
  }
  return table;
}

// ---------- leaderboard ----------

function renderLeaderboard() {
  const rows = leaderboard.map((p, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(groupsMeta[p.groupId]?.group.label || p.groupId)}</td>
      <td class="num ${p.totalScore > 0 ? "positive" : p.totalScore < 0 ? "negative" : ""}">${fmtSigned(p.totalScore)}</td>
    </tr>`).join("");

  document.getElementById("leaderboard-wrap").innerHTML = leaderboard.length
    ? `<table class="leaderboard"><thead><tr><th>#</th><th>Name</th><th>Group</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="hint">No players yet.</p>`;
}

// ---------- export ----------

async function exportCsv() {
  const rows = [["Name", "Group", "Round", "Choice", "Median", "Payoff", "Running total"]];
  for (const meta of Object.values(groupsMeta)) {
    const rounds = await fetchAllRounds(gameId, meta.group.id, game.totalRounds);
    const totals = {};
    for (const r of rounds) {
      for (const m of meta.members) {
        const choice = r.choices?.[m.id];
        if (choice === undefined) continue;
        const payoff = r.payoffs?.[m.id] ?? 0;
        totals[m.id] = (totals[m.id] || 0) + payoff;
        rows.push([m.name, meta.group.label, r.round, choice, r.medianColumn ?? "", payoff, totals[m.id]]);
      }
    }
  }
  downloadCsv(`${game?.name || gameId}-results.csv`, rows);
}

