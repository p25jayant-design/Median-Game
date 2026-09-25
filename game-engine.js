import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc,
  collection, query, where, orderBy, getDocs,
  runTransaction, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, ensureSignedIn } from "./firebase-init.js";
import { generateGameCode } from "./util.js";
import { computeMedian, getPayoff, DEFAULT_PAYOFF_TABLE } from "./payoff-table.js";

const MAX_CODE_ATTEMPTS = 6;

// ---------- refs ----------

const gameRef = (gameId) => doc(db, "games", gameId);
const groupRef = (gameId, groupId) => doc(db, "games", gameId, "groups", groupId);
const memberRef = (gameId, groupId, uid) => doc(db, "games", gameId, "groups", groupId, "members", uid);
const roundRef = (gameId, groupId, roundNumber) =>
  doc(db, "games", gameId, "groups", groupId, "rounds", String(roundNumber));
const playerRef = (gameId, uid) => doc(db, "games", gameId, "players", uid);

// Firestore doesn't allow nested arrays, so the 14x14 table is stored as a
// map of row-key -> array of 14 numbers.
export function tableToFirestore(table) {
  const out = {};
  table.forEach((row, i) => (out[String(i + 1)] = row));
  return out;
}
export function tableFromFirestore(map) {
  const out = [];
  for (let i = 1; i <= 14; i++) out.push((map && map[String(i)]) || DEFAULT_PAYOFF_TABLE[i - 1]);
  return out;
}

// ---------- admin: create / manage a game ----------

export async function createGame({
  name, totalRounds, groupSize, numGroups, autoResolve, payoffTable, adminPasscode,
}) {
  const uid = await ensureSignedIn();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode(5);
    const ref = gameRef(code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;

    await setDoc(ref, {
      name: name || "Median Choice game",
      adminUid: uid,
      adminPasscode: adminPasscode || "",
      status: "setup",
      totalRounds,
      groupSize,
      numGroups,
      autoResolve,
      payoffTable: tableToFirestore(payoffTable),
      createdAt: serverTimestamp(),
    });

    for (let i = 1; i <= numGroups; i++) {
      await setDoc(groupRef(code, `g${i}`), {
        index: i,
        label: `Group ${i}`,
        capacity: groupSize,
        memberCount: 0,
        currentRound: 1,
        status: "open",
        createdAt: serverTimestamp(),
      });
    }
    return code;
  }
  throw new Error("Could not generate a unique game code, please try again.");
}

export async function fetchGame(gameId) {
  const snap = await getDoc(gameRef(gameId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function claimAdmin(gameId, passcodeAttempt) {
  const uid = await ensureSignedIn();
  const snap = await getDoc(gameRef(gameId));
  if (!snap.exists()) throw new Error("Game not found.");
  const data = snap.data();
  if (data.adminUid === uid) return true;
  if (data.adminUid === null) {
    await updateDoc(gameRef(gameId), { adminUid: uid });
    return true;
  }
  await updateDoc(gameRef(gameId), { adminUid: uid, reclaimAttempt: passcodeAttempt });
  return true;
}

export async function updateGameSettings(gameId, patch) {
  await updateDoc(gameRef(gameId), patch);
}

export async function setPayoffTable(gameId, table) {
  await updateDoc(gameRef(gameId), { payoffTable: tableToFirestore(table) });
}

export async function addGroup(gameId, groupSize) {
  const groups = await getDocs(collection(db, "games", gameId, "groups"));
  const nextIndex = groups.size + 1;
  await setDoc(groupRef(gameId, `g${nextIndex}`), {
    index: nextIndex,
    label: `Group ${nextIndex}`,
    capacity: groupSize,
    memberCount: 0,
    currentRound: 1,
    status: "open",
    createdAt: serverTimestamp(),
  });
  return `g${nextIndex}`;
}

export async function removePlayer(gameId, groupId, uid) {
  await deleteDoc(memberRef(gameId, groupId, uid));
  await deleteDoc(playerRef(gameId, uid));
  await updateDoc(groupRef(gameId, groupId), { memberCount: increment(-1) });
}

export async function advanceRoundManually(gameId, groupId) {
  const gSnap = await getDoc(groupRef(gameId, groupId));
  const gameSnap = await getDoc(gameRef(gameId));
  if (!gSnap.exists() || !gameSnap.exists()) return;
  const group = gSnap.data();
  const game = gameSnap.data();
  const rSnap = await getDoc(roundRef(gameId, groupId, group.currentRound));
  if (rSnap.exists() && rSnap.data().status !== "resolved") {
    throw new Error("This round hasn't resolved yet.");
  }
  const next = group.currentRound + 1;
  await updateDoc(groupRef(gameId, groupId), {
    currentRound: next,
    status: next > game.totalRounds ? "finished" : "open",
  });
}

// ---------- student: join ----------

export async function joinGame(code, name) {
  const uid = await ensureSignedIn();
  const gameSnap = await getDoc(gameRef(code));
  if (!gameSnap.exists()) throw new Error("No game found with that code.");
  const game = gameSnap.data();
  if (game.status === "completed") throw new Error("This game has already ended.");

  const existingPlayer = await getDoc(playerRef(code, uid));
  if (existingPlayer.exists()) {
    const p = existingPlayer.data();
    if (name && name !== p.name) await updateDoc(playerRef(code, uid), { name });
    return { gameId: code, groupId: p.groupId, uid, name: name || p.name };
  }

  const groupsSnap = await getDocs(
    query(collection(db, "games", code, "groups"), orderBy("index"))
  );
  const candidates = groupsSnap.docs;
  if (candidates.length === 0) throw new Error("This game has no groups set up yet.");

  for (const candidate of candidates) {
    const gId = candidate.id;
    try {
      await runTransaction(db, async (tx) => {
        const gSnap = await tx.get(groupRef(code, gId));
        if (!gSnap.exists()) throw new Error("skip");
        const g = gSnap.data();
        if (g.memberCount >= g.capacity) throw new Error("skip");
        tx.update(groupRef(code, gId), { memberCount: increment(1) });
        tx.set(memberRef(code, gId, uid), { name, joinedAt: serverTimestamp() });
        tx.set(playerRef(code, uid), {
          name, groupId: gId, totalScore: 0, joinedAt: serverTimestamp(),
        });
      });
      return { gameId: code, groupId: gId, uid, name };
    } catch (err) {
      if (err && err.message === "skip") continue;
      throw err;
    }
  }
  throw new Error("All groups are full. Ask your instructor to add another group.");
}

// ---------- student: play ----------

export async function submitChoice(gameId, groupId, roundNumber, uid, choice) {
  await setDoc(
    roundRef(gameId, groupId, roundNumber),
    {
      status: "open",
      choices: { [uid]: choice },
      submittedAt: { [uid]: serverTimestamp() },
    },
    { merge: true }
  );
}

/**
 * Attempts to resolve a round if enough players have submitted. Safe to call
 * from every client on every snapshot — no-ops quietly if already resolved
 * or not yet full, and races between clients are resolved by Firestore's
 * transaction retry (only one write ever lands).
 */
export async function tryResolveRound(gameId, groupId, roundNumber, { force = false } = {}) {
  try {
    await runTransaction(db, async (tx) => {
      const roundR = roundRef(gameId, groupId, roundNumber);
      const [roundSnap, groupSnap, gameSnap] = await Promise.all([
        tx.get(roundR), tx.get(groupRef(gameId, groupId)), tx.get(gameRef(gameId)),
      ]);
      if (!roundSnap.exists()) return;
      const round = roundSnap.data();
      if (round.status === "resolved") return;
      const group = groupSnap.data();
      const game = gameSnap.data();
      const choices = round.choices || {};
      const entries = Object.entries(choices);
      if (!force && entries.length < group.capacity) return;
      if (entries.length === 0) return;

      const table = tableFromFirestore(game.payoffTable);
      const { rawMedian, medianColumn } = computeMedian(entries.map(([, v]) => v));
      const payoffs = {};
      for (const [uid, choice] of entries) {
        payoffs[uid] = getPayoff(table, choice, medianColumn);
      }

      tx.update(roundR, {
        status: "resolved",
        median: rawMedian,
        medianColumn,
        payoffs,
        resolvedAt: serverTimestamp(),
      });

      for (const [uid, payoff] of Object.entries(payoffs)) {
        tx.update(playerRef(gameId, uid), { totalScore: increment(payoff) });
      }

      if (group.currentRound === roundNumber) {
        const next = roundNumber + 1;
        const isLast = next > game.totalRounds;
        if (game.autoResolve) {
          tx.update(groupRef(gameId, groupId), {
            currentRound: isLast ? roundNumber : next,
            status: isLast ? "finished" : "open",
          });
        } else if (isLast) {
          tx.update(groupRef(gameId, groupId), { status: "finished" });
        }
      }
    });
  } catch (err) {
    // Contention from a racing client is expected and harmless; log anything else.
    if (!String(err?.message || err).includes("skip")) {
      console.warn("tryResolveRound:", err);
    }
  }
}

export async function forceResolveRound(gameId, groupId, roundNumber) {
  return tryResolveRound(gameId, groupId, roundNumber, { force: true });
}

// ---------- listeners ----------

export function listenGame(gameId, cb) {
  return onSnapshot(gameRef(gameId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}
export function listenGroup(gameId, groupId, cb) {
  return onSnapshot(groupRef(gameId, groupId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}
export function listenGroups(gameId, cb) {
  const q = query(collection(db, "games", gameId, "groups"), orderBy("index"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenMembers(gameId, groupId, cb) {
  return onSnapshot(collection(db, "games", gameId, "groups", groupId, "members"), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}
export function listenRound(gameId, groupId, roundNumber, cb) {
  return onSnapshot(roundRef(gameId, groupId, roundNumber), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  );
}
export function listenPlayer(gameId, uid, cb) {
  return onSnapshot(playerRef(gameId, uid), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}
export function listenPlayersInGroup(gameId, groupId, cb) {
  const q = query(collection(db, "games", gameId, "players"), where("groupId", "==", groupId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenLeaderboard(gameId, cb) {
  return onSnapshot(collection(db, "games", gameId, "players"), (snap) => {
    const players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    players.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    cb(players);
  });
}

export async function fetchAllRounds(gameId, groupId, totalRounds) {
  const out = [];
  for (let n = 1; n <= totalRounds; n++) {
    const snap = await getDoc(roundRef(gameId, groupId, n));
    if (snap.exists()) out.push({ round: n, ...snap.data() });
  }
  return out;
}

export { gameRef, groupRef, memberRef, roundRef, playerRef };
