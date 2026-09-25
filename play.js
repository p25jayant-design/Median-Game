import { ensureSignedIn } from "./firebase-init.js";
import {
  listenGame, listenGroup, listenRound, listenPlayer,
  submitChoice, tryResolveRound, fetchAllRounds, tableFromFirestore,
} from "./game-engine.js";
import { toast, fmtSigned, fmt1, qs, escapeHtml } from "./util.js";
import { MIN_CHOICE, MAX_CHOICE } from "./payoff-table.js";

const app = document.getElementById("app");

const session = JSON.parse(localStorage.getItem("mc_session") || "null");
const params = new URLSearchParams(location.search);

if (!session || (params.get("game") && params.get("game") !== session.gameId)) {
  location.href = "join.html" + (params.get("game") ? qs({ code: params.get("game") }) : "");
  throw new Error("no session");
}

let game = null;
let group = null;
let round = null;
let player = null;
let displayRound = null;
let selectedChoice = null;
let showTable = false;
let submitting = false;
let countdownHandle = null;
let countdownLeft = 0;
let unsubRound = null;
let resolveAttempted = false;
let allRounds = null; // filled in once the group finishes

render();

ensureSignedIn().then(() => {
  listenGame(session.gameId, (g) => {
    game = g;
    maybeStartCountdown(); // in case the round resolved before the game doc arrived
    render();
  });
  listenPlayer(session.gameId, session.uid, (p) => { player = p; render(); });
  listenGroup(session.gameId, session.groupId, (g) => {
    const prevRound = group?.currentRound;
    group = g;
    if (!g) return render();
    if (displayRound === null) {
      displayRound = g.currentRound;
      subscribeRound(displayRound);
    } else if (!game?.autoResolve && g.currentRound !== prevRound && g.currentRound > displayRound) {
      // instructor manually advanced us
      clearCountdown();
      displayRound = g.currentRound;
      subscribeRound(displayRound);
    }
    render();
  });
});

function subscribeRound(n) {
  if (unsubRound) unsubRound();
  round = null;
  resolveAttempted = false;
  selectedChoice = null;
  unsubRound = listenRound(session.gameId, session.groupId, n, (r) => {
    round = r;
    maybeTryResolve();
    maybeStartCountdown();
    render();
  });
}

function maybeTryResolve() {
  if (!round || !group || resolveAttempted) return;
  if (round.status === "open" && Object.keys(round.choices || {}).length >= group.capacity) {
    resolveAttempted = true;
    tryResolveRound(session.gameId, session.groupId, displayRound).finally(() => {
      resolveAttempted = false;
    });
  }
}

function maybeStartCountdown() {
  if (!round || round.status !== "resolved") return;
  if (!game?.autoResolve) return;
  if (countdownHandle) return; // already running
  const isLast = displayRound >= (game?.totalRounds || 20);
  if (isLast) return;
  countdownLeft = 4;
  countdownHandle = setInterval(() => {
    countdownLeft -= 1;
    if (countdownLeft <= 0) {
      clearCountdown();
      displayRound += 1;
      subscribeRound(displayRound);
    }
    render();
  }, 1000);
}

function clearCountdown() {
  if (countdownHandle) clearInterval(countdownHandle);
  countdownHandle = null;
  countdownLeft = 0;
}

async function handleSubmit() {
  if (selectedChoice === null || submitting) return;
  submitting = true;
  render();
  try {
    await submitChoice(session.gameId, session.groupId, displayRound, session.uid, selectedChoice);
  } catch (err) {
    toast(err.message || "Couldn't submit your choice.", "error");
  } finally {
    submitting = false;
    render();
  }
}

app.addEventListener("click", async (e) => {
  const chip = e.target.closest(".chip");
  if (chip) {
    selectedChoice = Number(chip.dataset.value);
    render();
    return;
  }
  if (e.target.id === "submit-btn") return handleSubmit();
  if (e.target.id === "toggle-table") {
    showTable = !showTable;
    render();
    return;
  }
  if (e.target.id === "view-breakdown") {
    allRounds = await fetchAllRounds(session.gameId, session.groupId, game.totalRounds);
    render();
  }
});

// ---------------- render ----------------

function render() {
  if (!game || !group) {
    app.innerHTML = loadingView();
    return;
  }
  if (game.status === "completed" || group.status === "finished") {
    app.innerHTML = finishedView();
    return;
  }
  if (game.status === "setup") {
    app.innerHTML = waitingForStartView();
    return;
  }
  if (!round || round.status !== "resolved") {
    app.innerHTML = pickerView();
    return;
  }
  app.innerHTML = revealView();
}

function shellHeader(subtitle) {
  return `
    <div class="brand">
      <div class="brand__mark"><img src="iima-logo.png" alt="IIMA" /></div>
      <div>
        <div class="brand__name">${escapeHtml(game?.name || "Median Choice")}</div>
        <div class="brand__tag">${subtitle}</div>
      </div>
    </div>`;
}

function loadingView() {
  return `<div class="center-note"><div class="spinner"></div><p style="margin-top:14px;">Loading your game…</p></div>`;
}

function waitingForStartView() {
  return `
    ${shellHeader(group.label)}
    <div class="panel" style="text-align:center;">
      <span class="badge"><span class="dot dot--wait"></span> Waiting for instructor</span>
      <h2 style="margin-top:14px;">You're in ${escapeHtml(group.label)}</h2>
      <p>The round begins as soon as your instructor starts the game. Keep this tab open.</p>
      <p class="hint">Seat ${group.memberCount} of ${group.capacity} filled in your group.</p>
    </div>`;
}

function pickerView() {
  const alreadySubmitted = round?.choices && round.choices[session.uid] !== undefined;
  const submittedCount = round ? Object.keys(round.choices || {}).length : 0;
  const paused = game.status === "paused";
  const totalScore = player?.totalScore || 0;

  const chips = [];
  for (let n = MIN_CHOICE; n <= MAX_CHOICE; n++) {
    chips.push(
      `<button type="button" class="chip${selectedChoice === n ? " is-selected" : ""}" data-value="${n}" ${alreadySubmitted || paused ? "disabled" : ""}>${n}</button>`
    );
  }

  const body = alreadySubmitted
    ? `
      <div class="center-note" style="padding:24px 0;">
        <div class="spinner"></div>
        <p style="margin-top:14px;">You chose <strong style="color:var(--text);">${round.choices[session.uid]}</strong>. Waiting for the rest of your group<br/>(${submittedCount} of ${group.capacity} chosen)</p>
      </div>`
    : `
      <div class="chip-grid">${chips.join("")}</div>
      <button class="btn btn--primary" id="submit-btn" ${selectedChoice === null || submitting ? "disabled" : ""}>
        ${submitting ? "Submitting…" : "Submit choice"}
      </button>
      ${paused ? `<p class="hint" style="text-align:center;margin-top:10px;">The instructor has paused the game.</p>` : ""}`;

  return `
    ${shellHeader(`${group.label} · Round ${displayRound} of ${game.totalRounds}`)}
    <div class="panel">
      <div class="panel__header">
        <h2 style="margin:0;">Pick a number</h2>
        <span class="num" style="color:var(--text-muted);">${fmtSigned(totalScore)} total</span>
      </div>
      <p>Choose 1–14. Your payoff depends on this number and your group's median.</p>
      ${body}
    </div>
    ${payoffTableToggle()}`;
}

function revealView() {
  const myChoice = round.choices[session.uid];
  const myPayoff = round.payoffs ? round.payoffs[session.uid] : null;
  const totalScore = player?.totalScore || 0;
  const isLast = displayRound >= game.totalRounds;

  let footer;
  if (isLast) {
    footer = `<p class="hint" style="text-align:center;">Final round complete — tallying your result…</p>`;
  } else if (game.autoResolve) {
    footer = `<p class="hint" style="text-align:center;">Next round starts in ${countdownLeft || 4}s…</p>`;
  } else {
    footer = `<p class="hint" style="text-align:center;">Waiting for the instructor to start the next round.</p>`;
  }

  return `
    ${shellHeader(`${group.label} · Round ${displayRound} of ${game.totalRounds}`)}
    <div class="panel">
      <h2>Round result</h2>
      <div class="stat-row"><span class="stat-row__label">Your choice</span><span class="stat-row__value num">${myChoice}</span></div>
      <div class="stat-row"><span class="stat-row__label">Group median</span><span class="stat-row__value num">${fmt1(round.median)} <span class="hint">(col ${round.medianColumn})</span></span></div>
      <div class="stat-row"><span class="stat-row__label">Payoff this round</span><span class="stat-row__value num ${payoffClass(myPayoff)}">${fmtSigned(myPayoff)}</span></div>
      <div class="stat-row"><span class="stat-row__label">Running total</span><span class="stat-row__value stat-row__value--big num ${payoffClass(totalScore)}">${fmtSigned(totalScore)}</span></div>
      ${footer}
    </div>
    ${payoffTableToggle()}`;
}

function finishedView() {
  const totalScore = player?.totalScore || 0;
  const breakdown = allRounds
    ? `
      <div class="table-scroll" style="margin-top:16px;">
        <table class="leaderboard">
          <thead><tr><th>Round</th><th>Your choice</th><th>Median</th><th>Payoff</th></tr></thead>
          <tbody>
            ${allRounds.map((r) => `
              <tr>
                <td class="num">${r.round}</td>
                <td class="num">${r.choices?.[session.uid] ?? "—"}</td>
                <td class="num">${r.medianColumn ?? "—"}</td>
                <td class="num ${payoffClass(r.payoffs?.[session.uid])}">${fmtSigned(r.payoffs?.[session.uid])}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : `<button class="btn btn--ghost" id="view-breakdown">View round-by-round breakdown</button>`;

  return `
    ${shellHeader(group?.label || "")}
    <div class="panel" style="text-align:center;">
      <span class="badge"><span class="dot dot--done"></span> Game complete</span>
      <h2 style="margin-top:14px;">Final score</h2>
      <div class="stat-row__value stat-row__value--big num ${payoffClass(totalScore)}" style="font-size:2.6rem;">${fmtSigned(totalScore)}</div>
      <p>Nicely played, ${escapeHtml(session.name)}.</p>
      ${breakdown}
    </div>`;
}

function payoffTableToggle() {
  if (!game?.payoffTable) return "";
  const table = tableFromFirestore(game.payoffTable);
  return `
    <div class="panel">
      <button class="btn btn--ghost btn--small" id="toggle-table">${showTable ? "Hide" : "View"} payoff table</button>
      ${showTable ? renderTable(table) : ""}
    </div>`;
}

function renderTable(table) {
  let head = "<tr><th>Choice \\ Median</th>" + Array.from({ length: 14 }, (_, i) => `<th>${i + 1}</th>`).join("") + "</tr>";
  let rows = table.map((row, i) =>
    `<tr><th>${i + 1}</th>${row.map((v) => `<td class="num">${fmt1(v)}</td>`).join("")}</tr>`
  ).join("");
  return `<div class="table-scroll" style="margin-top:12px;"><table class="grid-table">${head}${rows}</table></div>`;
}

function payoffClass(n) {
  if (n === null || n === undefined) return "";
  return n > 0 ? "positive" : n < 0 ? "negative" : "";
}


