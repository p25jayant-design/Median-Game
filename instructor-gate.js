// A lightweight front-door lock for the instructor-facing pages. This is a
// convenience deterrent, not real security — the passcode ships in this
// client-side file, so anyone who opens dev tools can read it. It's meant
// to stop a student who stumbles onto admin.html/dashboard.html from
// poking around, not to withstand a determined attacker. Change the
// passcode below whenever you like; it takes effect immediately (everyone
// who already unlocked their browser stays unlocked until they clear
// localStorage, so tell returning users to do that if you rotate it).
const PASSCODE = "2468";
const STORAGE_KEY = "mc_instructor_gate";

export function instructorGateUnlocked() {
  return localStorage.getItem(STORAGE_KEY) === "unlocked";
}

/** Resolves once the instructor has entered the correct passcode (or already had it saved). */
export function requireInstructorGate() {
  return new Promise((resolve) => {
    if (instructorGateUnlocked()) return resolve();

    const overlay = document.createElement("div");
    overlay.className = "gate-overlay";
    overlay.innerHTML = `
      <div class="panel gate-panel">
        <h2>Instructor access</h2>
        <p id="gate-msg">This area is for instructors only. Enter the passcode to continue.</p>
        <form id="gate-form">
          <div class="field">
            <label for="gate-input">Passcode</label>
            <input type="password" id="gate-input" autocomplete="off" autofocus required />
          </div>
          <button class="btn btn--primary" type="submit">Unlock</button>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("gate-input").focus();

    document.getElementById("gate-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("gate-input");
      if (input.value === PASSCODE) {
        localStorage.setItem(STORAGE_KEY, "unlocked");
        overlay.remove();
        resolve();
      } else {
        document.getElementById("gate-msg").textContent = "Incorrect passcode — try again.";
        document.getElementById("gate-msg").style.color = "var(--negative)";
        input.value = "";
        input.focus();
      }
    });
  });
}
