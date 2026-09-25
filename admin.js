import { createGame, claimAdmin } from "./game-engine.js";
import { DEFAULT_PAYOFF_TABLE, MIN_CHOICE, MAX_CHOICE } from "./payoff-table.js";
import { toast, normalizeCode, qs, escapeHtml } from "./util.js";

renderRecentGames();

// ---------- payoff table editor (built once, not reactive) ----------

const toggleBtn = document.getElementById("toggle-payoff");
const editorWrap = document.getElementById("payoff-editor-wrap");
let editorBuilt = false;

toggleBtn.addEventListener("click", () => {
  if (!editorBuilt) {
    editorWrap.innerHTML = buildPayoffEditorHtml(DEFAULT_PAYOFF_TABLE);
    editorBuilt = true;
  }
  const visible = editorWrap.style.display !== "none";
  editorWrap.style.display = visible ? "none" : "block";
  toggleBtn.textContent = visible ? "Review / edit payoff table" : "Hide payoff table";
});

function buildPayoffEditorHtml(table) {
  let head = `<tr><th>Choice \\ Median</th>`;
  for (let m = MIN_CHOICE; m <= MAX_CHOICE; m++) head += `<th>${m}</th>`;
  head += `</tr>`;

  let rows = "";
  for (let c = MIN_CHOICE; c <= MAX_CHOICE; c++) {
    rows += `<tr><th>${c}</th>`;
    for (let m = MIN_CHOICE; m <= MAX_CHOICE; m++) {
      rows += `<td><input type="number" step="0.1" id="pt-${c}-${m}" value="${table[c - 1][m - 1]}" /></td>`;
    }
    rows += `</tr>`;
  }
  return `
    <p class="hint">Rows are your choice, columns are the group's median. Values are pre-filled from the handout — the bottom-right cell was unreadable on a torn page edge, double check it.</p>
    <div class="table-scroll"><table class="grid-table">${head}${rows}</table></div>`;
}

function readPayoffEditorTable() {
  if (!editorBuilt) return DEFAULT_PAYOFF_TABLE;
  const table = [];
  for (let c = MIN_CHOICE; c <= MAX_CHOICE; c++) {
    const row = [];
    for (let m = MIN_CHOICE; m <= MAX_CHOICE; m++) {
      const el = document.getElementById(`pt-${c}-${m}`);
      row.push(parseFloat(el.value));
    }
    table.push(row);
  }
  return table;
}

// ---------- create ----------

document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("create-btn");
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const name = document.getElementById("f-name").value.trim();
    const totalRounds = parseInt(document.getElementById("f-rounds").value, 10);
    const groupSize = parseInt(document.getElementById("f-groupsize").value, 10);
    const numGroups = parseInt(document.getElementById("f-numgroups").value, 10);
    const autoResolve = document.getElementById("f-auto").checked;
    const passcode = document.getElementById("f-passcode").value.trim();
    if (!passcode) throw new Error("Please set an admin passcode.");

    const payoffTable = readPayoffEditorTable();
    const gameId = await createGame({
      name, totalRounds, groupSize, numGroups, autoResolve, payoffTable, adminPasscode: passcode,
    });

    rememberGame(gameId, name, passcode);
    location.href = "dashboard.html" + qs({ game: gameId });
  } catch (err) {
    toast(err.message || "Couldn't create the game.", "error");
    btn.disabled = false;
    btn.textContent = "Create game";
  }
});

// ---------- reopen ----------

document.getElementById("manage-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = normalizeCode(document.getElementById("m-code").value);
  const passcode = document.getElementById("m-passcode").value.trim();
  try {
    await claimAdmin(code, passcode);
    rememberGame(code, "", passcode);
    location.href = "dashboard.html" + qs({ game: code });
  } catch (err) {
    toast(err.message || "Couldn't open that game. Check the code and passcode.", "error");
  }
});

// ---------- recent games (local convenience only) ----------

function rememberGame(gameId, name, passcode) {
  localStorage.setItem(`mc_pc_${gameId}`, passcode);
  const list = JSON.parse(localStorage.getItem("mc_admin_recent") || "[]").filter((g) => g.gameId !== gameId);
  list.unshift({ gameId, name });
  localStorage.setItem("mc_admin_recent", JSON.stringify(list.slice(0, 8)));
}

function renderRecentGames() {
  const list = JSON.parse(localStorage.getItem("mc_admin_recent") || "[]");
  if (list.length === 0) return;
  const el = document.getElementById("recent-games");
  el.innerHTML = `
    <div class="panel">
      <h2>Your recent games</h2>
      <div class="btn-row" style="flex-wrap:wrap;">
        ${list.map((g) => `<a class="btn btn--ghost btn--small" href="dashboard.html${qs({ game: g.gameId })}">${g.name ? escapeHtml(g.name) + " · " : ""}${g.gameId}</a>`).join("")}
      </div>
    </div>`;
}

