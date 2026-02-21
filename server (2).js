const express = require("express");
const app = express();

console.log("Server file loaded");

// =======================
// CORS - MUST BE FIRST!
// =======================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// =======================
// Root & Health
// =======================
app.get('/', (req, res) => {
  res.send('Hello 👋 the server is alive');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Friends server is connected'
  });
});

// =======================
// In-memory DB (MVP)
// =======================
const USERS = {};
const MATCHES = [];
const MESSAGES = {}; 
// { [matchId]: [{ sender, text, createdAt }] }

// =======================
// Utils
// =======================
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// =======================
// Match Finder
// =======================
function findNearbyMatches(currentEmail) {
  const currentUser = USERS[currentEmail];
  if (!currentUser || !currentUser.isActive || !currentUser.location) return;

  for (const email in USERS) {
    if (email === currentEmail) continue;

    const otherUser = USERS[email];
    if (
      !otherUser.isActive ||
      !otherUser.location ||
      otherUser.mode !== currentUser.mode
    ) {
      continue;
    }

    const distance = getDistanceInMeters(
      currentUser.location.latitude,
      currentUser.location.longitude,
      otherUser.location.latitude,
      otherUser.location.longitude
    );

    console.log(
      "DISTANCE CHECK:",
      currentEmail,
      "↔",
      email,
      Math.round(distance),
      "m"
    );

    if (distance <= 500) {
      const exists = MATCHES.find(
        (m) =>
          (m.initiator === currentEmail && m.receiver === email) ||
          (m.initiator === email && m.receiver === currentEmail)
      );

      if (exists) continue;

      const match = {
        id: Date.now(),
        initiator: currentEmail,
        receiver: email,
        mode: currentUser.mode,
        status: "pending",
        createdAt: Date.now(),
        revealRequestedBy: null,
        revealed: false
      };

      MATCHES.push(match);
      console.log("✅ NEW MATCH CREATED:", match);
    }
  }
}

// =======================
// Matches
// =======================
app.get("/matches", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email required" });

  const userMatches = MATCHES.filter(
    (m) => m.initiator === email || m.receiver === email
  );

  res.json(userMatches);
});

// ACCEPT (receiver only)
app.post("/matches/accept", (req, res) => {
  const { matchId, email } = req.body;

  const match = MATCHES.find(
    (m) => String(m.id) === String(matchId)
  );

  if (!match) return res.status(404).json({ error: "Match not found" });
  if (match.receiver !== email) {
    return res.status(403).json({ error: "Not allowed" });
  }

  match.status = "accepted";
  res.json(match);
});

// IGNORE (receiver only)
app.post("/matches/ignore", (req, res) => {
  const { matchId, email } = req.body;

  const index = MATCHES.findIndex(
    (m) => String(m.id) === String(matchId) && m.receiver === email
  );

  if (index === -1) {
    return res.status(404).json({ error: "Match not found" });
  }

  MATCHES.splice(index, 1);
  res.json({ success: true });
});

// =======================
// Anonymous Reveal
// =======================
app.post("/matches/reveal/request", (req, res) => {
  const { matchId, email } = req.body;

  const match = MATCHES.find(
    (m) => String(m.id) === String(matchId)
  );

  if (!match || match.mode !== "anonymous") {
    return res.status(400).json({ error: "Invalid match" });
  }

  // First user requests reveal
  if (!match.revealRequestedBy) {
    match.revealRequestedBy = email;
  }
  // Second user agrees → reveal identities
  else if (match.revealRequestedBy !== email) {
    match.revealed = true;
    match.mode = "visible";
  }

  res.json(match);
});

// ACCEPT REVEAL
app.post("/matches/reveal/accept", (req, res) => {
  const { matchId, email } = req.body;

  const match = MATCHES.find(
    (m) => String(m.id) === String(matchId)
  );

  if (!match || match.mode !== "anonymous") {
    return res.status(400).json({ error: "Invalid match" });
  }

  // Only the person who didn't request can accept
  if (match.revealRequestedBy && match.revealRequestedBy !== email) {
    match.revealed = true;
    match.mode = "visible";
  }

  res.json(match);
});

// =======================
// Messages
// =======================
app.post("/messages/send", (req, res) => {
  const { matchId, sender, text } = req.body;
  if (!matchId || !sender || !text) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const match = MATCHES.find(
    (m) => String(m.id) === String(matchId)
  );

  if (!match || match.status !== "accepted") {
    return res.status(403).json({ error: "Chat not allowed" });
  }

  const key = String(matchId);
  if (!MESSAGES[key]) {
    MESSAGES[key] = [];
  }

  MESSAGES[key].push({
    sender,
    text,
    createdAt: Date.now()
  });

  res.json({ success: true });
});

app.get("/messages", (req, res) => {
  const { matchId } = req.query;
  if (!matchId) return res.status(400).json({ error: "matchId required" });

  res.json(MESSAGES[String(matchId)] || []);
});

// =======================
// Auth / Presence
// =======================
app.post("/login", (req, res) => {
  const { email } = req.body;
  console.log("LOGIN HIT:", email);

  if (!email) return res.status(400).json({ error: "Email required" });

  if (!USERS[email]) {
    USERS[email] = {
      id: Date.now(),
      email,

      // profile
      name: "",
      bio: "",
      photo: "",
      interests: [],
      profileCompleted: false,

      // presence
      isActive: false,
      mode: null,
      anonymousStartedAt: null,
      location: null
    };
  }

  res.json({ user: USERS[email] });
});

// =======================
// Profile
// =======================
app.post("/profile/update", (req, res) => {
  const { email, name, bio, photo, interests } = req.body;

  if (!USERS[email]) {
    return res.status(404).json({ error: "User not found" });
  }

  USERS[email].name = name ?? USERS[email].name;
  USERS[email].bio = bio ?? USERS[email].bio;
  USERS[email].photo = photo ?? USERS[email].photo;
  USERS[email].interests = interests ?? USERS[email].interests;

  USERS[email].profileCompleted =
    !!USERS[email].name && !!USERS[email].bio;

  res.json({
    success: true,
    profile: {
      name: USERS[email].name,
      bio: USERS[email].bio,
      photo: USERS[email].photo,
      interests: USERS[email].interests,
      profileCompleted: USERS[email].profileCompleted
    }
  });
});

// Profile with privacy check
app.get("/profile/:email", (req, res) => {
  const { email } = req.params;
  const { requestingUser } = req.query;
  
  const user = USERS[email];

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Privacy check: Can requesting user see this profile?
  let canView = true;

  // If user is currently in anonymous mode
  if (user.mode === "anonymous" && user.isActive && requestingUser) {
    // Check if they have a revealed match
    const match = MATCHES.find(
      (m) =>
        ((m.initiator === email && m.receiver === requestingUser) ||
         (m.initiator === requestingUser && m.receiver === email)) &&
        m.revealed === true
    );

    // If no revealed match, deny access
    if (!match) {
      canView = false;
    }
  }

  if (!canView) {
    return res.status(403).json({ 
      error: "Profile not accessible",
      message: "This user is anonymous. Reveal identities first."
    });
  }

  // Return profile data
  res.json({
    name: user.name,
    bio: user.bio,
    photo: user.photo,
    interests: user.interests || []
  });
});

// =======================
// Activate/Deactivate
// =======================
app.post("/activate", (req, res) => {
  const { email, mode, latitude, longitude } = req.body;
  if (!USERS[email]) return res.status(404).json({ error: "User not found" });

  USERS[email].isActive = true;
  USERS[email].mode = mode;
  USERS[email].location = { latitude, longitude };
  USERS[email].anonymousStartedAt =
    mode === "anonymous" ? Date.now() : null;

  console.log("Location:", USERS[email].location);

  findNearbyMatches(email);
  res.json(USERS[email]);
});

app.post("/deactivate", (req, res) => {
  const { email } = req.body;
  if (!USERS[email]) return res.status(404).json({ error: "User not found" });

  USERS[email].isActive = false;
  USERS[email].mode = null;
  USERS[email].anonymousStartedAt = null;

  res.json(USERS[email]);
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Friends API running on port ${PORT}`);
});
