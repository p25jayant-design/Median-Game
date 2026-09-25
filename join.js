import { joinGame } from "./game-engine.js";
import { toast, normalizeCode, qs } from "./util.js";

const form = document.getElementById("join-form");
const codeInput = document.getElementById("code");
const nameInput = document.getElementById("name");
const btn = document.getElementById("join-btn");

// Pre-fill from a shared link like join.html?code=7K3QP
const params = new URLSearchParams(location.search);
if (params.get("code")) codeInput.value = normalizeCode(params.get("code"));

const savedName = localStorage.getItem("mc_name");
if (savedName) nameInput.value = savedName;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = normalizeCode(codeInput.value);
  const name = nameInput.value.trim();
  if (!code || !name) return;

  btn.disabled = true;
  btn.textContent = "Joining…";
  try {
    const { gameId, groupId, uid } = await joinGame(code, name);
    localStorage.setItem("mc_name", name);
    localStorage.setItem(
      "mc_session",
      JSON.stringify({ gameId, groupId, uid, name })
    );
    location.href = "play.html" + qs({ game: gameId });
  } catch (err) {
    toast(err.message || "Couldn't join that game.", "error");
    btn.disabled = false;
    btn.textContent = "Join group";
  }
});
