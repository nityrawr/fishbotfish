// Discord Bot - !fish command
// -------------------------------------------------
// Setup:
//   1. npm init -y
//   2. npm install discord.js
//   3. Replace YOUR_TOKEN_HERE with your bot token (Discord Developer Portal)
//   4. node bot.js
// -------------------------------------------------

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { Pool } = require('pg');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // must also be enabled in the Developer Portal
  ],
});

// PostgreSQL connection (Railway provides DATABASE_URL automatically once a
// Postgres database is added to the project)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catches (
      user_id TEXT NOT NULL,
      fish_name TEXT NOT NULL,
      caught_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      times_caught INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, fish_name)
    )
  `);
  // In case the table already existed from a previous deploy without this column
  await pool.query(`ALTER TABLE catches ADD COLUMN IF NOT EXISTS times_caught INTEGER NOT NULL DEFAULT 1`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      repair_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_upgrades (
      user_id TEXT PRIMARY KEY,
      hook_tier INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_trophies (
      user_id TEXT NOT NULL,
      trophy_key TEXT NOT NULL,
      earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, trophy_key)
    )
  `);
}

// Credits awarded per rarity when a fish is caught
const CREDIT_VALUES = {
  Common: 25,
  Rare: 50,
  Epic: 250,
  Legendary: 2500,
};

// Adds credits to a user's balance (creating the row if needed) and returns
// the new total balance. Pass a negative amount to deduct.
async function addCredits(userId, amount) {
  const result = await pool.query(
    `INSERT INTO user_credits (user_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance = user_credits.balance + $2
     RETURNING balance`,
    [userId, amount]
  );
  return result.rows[0].balance;
}

async function getCreditBalance(userId) {
  const result = await pool.query(
    `SELECT balance FROM user_credits WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].balance : 0;
}

// Atomically transfers credits from one user to another.
// Returns { success: true } on success, or { success: false, balance } if
// the sender doesn't have enough credits.
async function transferCredits(senderId, receiverId, amount) {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const res = await dbClient.query(
      `SELECT balance FROM user_credits WHERE user_id = $1 FOR UPDATE`,
      [senderId]
    );
    const balance = res.rows.length > 0 ? res.rows[0].balance : 0;

    if (balance < amount) {
      await dbClient.query('ROLLBACK');
      return { success: false, balance };
    }

    await dbClient.query(
      `UPDATE user_credits SET balance = balance - $2 WHERE user_id = $1`,
      [senderId, amount]
    );
    await dbClient.query(
      `INSERT INTO user_credits (user_id, balance)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance = user_credits.balance + $2`,
      [receiverId, amount]
    );

    await dbClient.query('COMMIT');
    return { success: true };
  } catch (e) {
    await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    dbClient.release();
  }
}

const BASE_REPAIR_COST = 500;
const REPAIR_COST_INCREASE = 10;

// Returns { balance, repairCost } for a user: current credit balance and
// the cost of their NEXT repair (increases by 50 after each successful repair).
async function getRepairInfo(userId) {
  const result = await pool.query(
    `SELECT balance, repair_count FROM user_credits WHERE user_id = $1`,
    [userId]
  );
  const balance = result.rows.length > 0 ? result.rows[0].balance : 0;
  const repairCount = result.rows.length > 0 ? result.rows[0].repair_count : 0;
  const repairCost = BASE_REPAIR_COST + repairCount * REPAIR_COST_INCREASE;
  return { balance, repairCost };
}

// Increments a user's repair count (used to raise the cost of their next repair)
async function incrementRepairCount(userId) {
  await pool.query(
    `INSERT INTO user_credits (user_id, balance, repair_count)
     VALUES ($1, 0, 1)
     ON CONFLICT (user_id) DO UPDATE SET repair_count = user_credits.repair_count + 1`,
    [userId]
  );
}

// Records a catch, incrementing times_caught each time (even repeats).
// Returns true if this is the first time this user caught this specific fish.
async function recordCatch(userId, fishName) {
  const result = await pool.query(
    `INSERT INTO catches (user_id, fish_name, times_caught)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, fish_name) DO UPDATE SET times_caught = catches.times_caught + 1
     RETURNING (xmax = 0) AS inserted`,
    [userId, fishName]
  );
  return result.rows[0].inserted;
}

async function getCollectionCount(userId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM catches WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0].count;
}

// Total number of fish caught by a user, counting repeats (sum of times_caught)
async function getTotalCatches(userId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(times_caught), 0)::int AS total FROM catches WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0].total;
}

// Returns a Set of fish names this user has caught at least once
async function getCaughtFishNames(userId) {
  const result = await pool.query(
    `SELECT fish_name FROM catches WHERE user_id = $1`,
    [userId]
  );
  return new Set(result.rows.map((r) => r.fish_name));
}

async function getTimesCaughtForFish(userId, fishName) {
  const result = await pool.query(
    `SELECT times_caught FROM catches WHERE user_id = $1 AND fish_name = $2`,
    [userId, fishName]
  );
  return result.rows.length > 0 ? result.rows[0].times_caught : 0;
}

// Returns a Set of trophy keys a user already owns
async function getOwnedTrophies(userId) {
  const result = await pool.query(
    `SELECT trophy_key FROM user_trophies WHERE user_id = $1`,
    [userId]
  );
  return new Set(result.rows.map((r) => r.trophy_key));
}

async function addTrophy(userId, trophyKey) {
  await pool.query(
    `INSERT INTO user_trophies (user_id, trophy_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, trophyKey]
  );
}

// Returns the hook upgrade tier a user currently owns (0 = no upgrade)
async function getHookTier(userId) {
  const result = await pool.query(
    `SELECT hook_tier FROM user_upgrades WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].hook_tier : 0;
}

async function setHookTier(userId, tier) {
  await pool.query(
    `INSERT INTO user_upgrades (user_id, hook_tier)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET hook_tier = $2`,
    [userId, tier]
  );
}

// Hook upgrade tiers, purchasable in the !shop. Index 0 is unused (tier 0 =
// no upgrade owned, base 4% break chance). chances[i] is the probability of
// catching the (i+2)th fish, only rolled if the previous one succeeded.
const HOOK_TIERS = [
  null,
  { name: 'Double-hook I', cost: 3000, breakChance: 0.045, chances: [0.10] },
  { name: 'Double-hook II', cost: 5000, breakChance: 0.05, chances: [0.20] },
  { name: 'Triple-hook I', cost: 15000, breakChance: 0.055, chances: [0.25, 0.10] },
  { name: 'Triple-hook II', cost: 25000, breakChance: 0.06, chances: [0.40, 0.25] },
  { name: 'Multi-hook I', cost: 75000, breakChance: 0.065, chances: [0.50, 0.30, 0.15, 0.08] },
  { name: 'Multi-hook II', cost: 100000, breakChance: 0.07, chances: [0.75, 0.50, 0.30, 0.16] },
];

// Trophies, purchasable in the !shop under the "Trophies" category. Each one
// requires both enough Bits Coins AND meeting a specific in-game requirement
// (fishdex completion %, a specific fish caught, or all 4 unique treasures).
const TROPHIES = [
  { key: 'rookie', name: 'Rookie', cost: 2500, type: 'completion', value: 20 },
  { key: 'fisherman', name: 'Fisherman', cost: 5000, type: 'completion', value: 40 },
  { key: 'the-captain', name: 'The Captain', cost: 7500, type: 'completion', value: 60 },
  { key: 'legendary-fisherman', name: 'The Legendary Fisherman', cost: 10000, type: 'completion', value: 80 },
  { key: 'neptune', name: 'Neptune, God of the Sea', cost: 25000, type: 'completion', value: 100 },
  { key: 'martin-brody', name: 'Martin Brody', cost: 25000, type: 'fish', value: 'Megalodon', hidden: true },
  { key: 'davy-jones', name: 'Davy Jones', cost: 25000, type: 'fish', value: 'Kraken', hidden: true },
  { key: 'jeremy-wade', name: 'Jeremy Wade', cost: 25000, type: 'fish', value: 'Giant dam catfish', hidden: true },
  { key: 'monster-hunter', name: 'Monster Hunter', cost: 25000, type: 'fish', value: 'Loch ness monster', hidden: true },
  { key: 'back-to-the-past', name: 'Back to the Past', cost: 25000, type: 'fish', value: 'Coelacanth', hidden: true },
  { key: 'snatcher', name: 'Snatcher', cost: 2500, type: 'fish', value: 'Lost purse' },
  { key: 'money-bag', name: 'Money Bag', cost: 5000, type: 'fish', value: 'Bag of money' },
  { key: 'golden-retriever', name: 'Golden Retriever', cost: 7500, type: 'fish', value: 'Gold bar' },
  {
    key: 'pirate-seven-seas',
    name: 'Pirate of the Seven Seas',
    cost: 10000,
    type: 'allUniques',
    value: ['Lost purse', 'Bag of money', 'Gold bar', 'Long thought forgotten treasure'],
  },
];

// Checks whether a user currently meets a trophy's in-game requirement
// (separate from whether they can afford it). Returns { met, reason }.
async function checkTrophyRequirement(userId, trophy) {
  if (trophy.type === 'completion') {
    const count = await getCollectionCount(userId);
    const percent = (count / FISH_TABLE.length) * 100;
    return {
      met: percent >= trophy.value,
      reason: `Requires **${trophy.value}%** Fishdex completion (you're at **${percent.toFixed(1)}%**).`,
    };
  }
  if (trophy.type === 'fish') {
    const caughtSet = await getCaughtFishNames(userId);
    const met = caughtSet.has(trophy.value);
    return {
      met,
      reason: trophy.hidden
        ? `Requires catching a specific, mysterious legendary creature... 🕵️`
        : `Requires catching **${trophy.value}** first.`,
    };
  }
  if (trophy.type === 'allUniques') {
    const caughtSet = await getCaughtFishNames(userId);
    const missing = trophy.value.filter((name) => !caughtSet.has(name));
    return {
      met: missing.length === 0,
      reason: missing.length > 0 ? `Still missing: ${missing.join(', ')}.` : '',
    };
  }
  return { met: false, reason: 'Unknown requirement.' };
}

// Fish table: each fish has its own drop weight (in %) among successful catches.
// Weights are normalized so they sum to ~100.
const FISH_TABLE = [
  { name: 'Trout', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1800 },
  { name: 'Mullet', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1000 },
  { name: 'Garfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1200 },
  { name: 'Blue tuskfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 5000 },
  { name: 'Blackspot tuskfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 10000 },
  { name: 'Coral trout', rarity: 'Common', weight: 1.3951, baseWeightGrams: 4000 },
  { name: 'Cod', rarity: 'Common', weight: 1.3951, baseWeightGrams: 5000 },
  { name: 'Mackerel', rarity: 'Common', weight: 1.3951, baseWeightGrams: 350 },
  { name: 'Carp', rarity: 'Common', weight: 1.3951, baseWeightGrams: 6000 },
  { name: 'Perch', rarity: 'Common', weight: 1.3951, baseWeightGrams: 300 },
  { name: 'Sardine', rarity: 'Common', weight: 1.3951, baseWeightGrams: 80 },
  { name: 'Stripey snapper', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1300 },
  { name: 'Red emperor', rarity: 'Common', weight: 1.3951, baseWeightGrams: 7000 },
  { name: 'Grass emperor', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1000 },
  { name: 'Goldspotted rockcod', rarity: 'Common', weight: 1.3951, baseWeightGrams: 7500 },
  { name: 'Longfin rockcod', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1000 },
  { name: 'Sand bass', rarity: 'Common', weight: 1.3951, baseWeightGrams: 900 },
  { name: 'Queensland groper', rarity: 'Common', weight: 1.3951 },
  { name: 'Mackerel tuna', rarity: 'Common', weight: 1.3951, baseWeightGrams: 3500 },
  { name: 'Longtail tuna', rarity: 'Common', weight: 1.3951, baseWeightGrams: 25000 },
  { name: 'Spanish mackerel', rarity: 'Common', weight: 1.3951, baseWeightGrams: 4000 },
  { name: 'Giant trevally', rarity: 'Common', weight: 1.3951, baseWeightGrams: 35000 },
  { name: 'Golden trevally', rarity: 'Common', weight: 1.3951, baseWeightGrams: 8000 },
  { name: 'Forktail catfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 10000 },
  { name: 'Beach salmon', rarity: 'Common', weight: 1.3951, baseWeightGrams: 3200 },
  { name: 'Mud crab', rarity: 'Common', weight: 1.3951, baseWeightGrams: 700 },
  { name: 'Sand crab', rarity: 'Common', weight: 1.3951, baseWeightGrams: 500 },
  { name: 'Archer fish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 400 },
  { name: 'King crab', rarity: 'Common', weight: 1.3951, baseWeightGrams: 8000 },
  { name: 'Brown crab', rarity: 'Common', weight: 1.3951, baseWeightGrams: 2200 },
  { name: 'Blue shrimp', rarity: 'Common', weight: 1.3951, baseWeightGrams: 30 },
  { name: 'Pink shrimp', rarity: 'Common', weight: 1.3951, baseWeightGrams: 8 },
  { name: 'Spider crab', rarity: 'Common', weight: 1.3951, baseWeightGrams: 20000 },
  { name: 'Pacific giant octopus', rarity: 'Common', weight: 1.3951, baseWeightGrams: 30000 },
  { name: 'Swordfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 100000 },
  { name: 'Guppy', rarity: 'Common', weight: 1.3951, baseWeightGrams: 0.1 },
  { name: 'Goldfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 150 },
  { name: 'Eel', rarity: 'Common', weight: 1.3951, baseWeightGrams: 5000 },
  { name: 'Stingray', rarity: 'Common', weight: 1.3951, baseWeightGrams: 20000 },
  { name: 'Tuna', rarity: 'Common', weight: 1.3951, baseWeightGrams: 300000 },
  { name: 'Barracuda', rarity: 'Common', weight: 1.3951, baseWeightGrams: 6000 },
  { name: 'Mahi mahi', rarity: 'Common', weight: 1.3951, baseWeightGrams: 10000 },
  { name: 'Haddock', rarity: 'Common', weight: 1.3951, baseWeightGrams: 2500 },
  { name: 'Sea bass', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1500 },
  { name: 'Sockeye Salmon', rarity: 'Common', weight: 1.3951, baseWeightGrams: 5000 },
  { name: 'Chinook Salmon', rarity: 'Common', weight: 1.3951, baseWeightGrams: 12000 },
  { name: 'Pink Salmon', rarity: 'Common', weight: 1.3951, baseWeightGrams: 3000 },
  { name: 'Halibut', rarity: 'Common', weight: 1.3951, baseWeightGrams: 16000 },
  { name: 'Tilapia', rarity: 'Common', weight: 1.3951, baseWeightGrams: 650 },
  { name: 'Big fin squid', rarity: 'Common', weight: 1.3951, baseWeightGrams: 1750 },
  { name: 'Clownfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 125 },
  { name: 'Catfish', rarity: 'Common', weight: 1.3951, baseWeightGrams: 28000 },
  { name: 'Marlin', rarity: 'Common', weight: 1.3951, baseWeightGrams: 500000 },
  { name: 'Hammerhead shark', rarity: 'Common', weight: 1.116, baseWeightGrams: 300000 },
  { name: 'Bull shark', rarity: 'Common', weight: 1.116, baseWeightGrams: 150000 },
  { name: 'Tiger shark', rarity: 'Common', weight: 1.116, baseWeightGrams: 200000 },
  { name: 'Great white shark', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 1200000 },
  { name: 'Electric eel', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 18000 },
  { name: 'Lionfish', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 1000 },
  { name: 'Horseshoe crab', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 3500 },
  { name: 'Flying gurnard', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 3000 },
  { name: 'Flying fish', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 700 },
  { name: 'Electric ray', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 70000 },
  { name: 'Star gazer fish', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 700 },
  { name: 'Suckermouth catfish', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 1400 },
  { name: 'Orca', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 6000000 },
  { name: 'Alligatorfish', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 50 },
  { name: 'Manta ray', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 2500000 },
  { name: 'Deepsea squid', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 400000 },
  { name: 'Blue ringed octopus', rarity: 'Rare', weight: 0.7673, baseWeightGrams: 60 },
  { name: 'Coconut octopus', rarity: 'Rare', weight: 0.7673, baseWeightGrams: 300 },
  { name: 'Giant squid', rarity: 'Rare', weight: 0.6138, baseWeightGrams: 225000 },
  { name: 'Dolphin', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 120000 },
  { name: 'Sunfish', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 500000 },
  { name: 'Blue whale', rarity: 'Rare', weight: 0.8371, baseWeightGrams: 110000000 },
  { name: 'Greenland shark', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 700000 },
  { name: 'Saw shark', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 10000 },
  { name: 'Tequila splitfin', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 3 },
  { name: 'Ornate sleeper ray', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 1800 },
  { name: 'Oarfish', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 250000 },
  { name: 'Giant sea bass', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 220000 },
  { name: 'Beluga sturgeon', rarity: 'Epic', weight: 0.279, baseWeightGrams: 250000 },
  { name: 'Alligator gar', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 80000 },
  { name: 'Arapaïma gigas', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 160000 },
  { name: 'Whale shark', rarity: 'Epic', weight: 0.4185, baseWeightGrams: 12000000 },
  { name: 'Chernobyl monster catfish', rarity: 'Legendary', weight: 0.1395, baseWeightGrams: 150000 },
  { name: 'European sturgeon', rarity: 'Legendary', weight: 0.1395, baseWeightGrams: 350000 },
  { name: 'Giant dam catfish', rarity: 'Legendary', weight: 0.0837, baseWeightGrams: 300000 },
  { name: 'White whale', rarity: 'Legendary', weight: 0.0698, baseWeightGrams: 40000000 },
  { name: 'Coelacanth', rarity: 'Legendary', weight: 0.0698, baseWeightGrams: 90000 },
  { name: 'Megalodon', rarity: 'Legendary', weight: 0.0279, baseWeightGrams: 75000000 },
  { name: 'Loch ness monster', rarity: 'Legendary', weight: 0.0279, baseWeightGrams: 12000000 },
  { name: 'Kraken', rarity: 'Legendary', weight: 0.0279, baseWeightGrams: 30000000 },
  { name: 'Lost purse', rarity: 'Common Unique', weight: 1.3951, customCredit: 75 },
  { name: 'Bag of money', rarity: 'Rare Unique', weight: 0.8371, customCredit: 150 },
  { name: 'Gold bar', rarity: 'Epic Unique', weight: 0.279, customCredit: 750 },
  { name: 'Long thought forgotten treasure', rarity: 'Legendary Unique', weight: 0.0279, customCredit: 7500 }
];

const RARITY_EMOJI = {
  Common: '⚪',
  Rare: '🔵',
  Epic: '🟣',
  Legendary: '🟡',
  'Common Unique': '⚪💎',
  'Rare Unique': '🔵💎',
  'Epic Unique': '🟣💎',
  'Legendary Unique': '🟡💎',
};

// Precompute cumulative weights once for fast weighted random picks
const TOTAL_WEIGHT = FISH_TABLE.reduce((sum, f) => sum + f.weight, 0);
let cumulative = 0;
const CUMULATIVE_TABLE = FISH_TABLE.map((f) => {
  cumulative += f.weight;
  return { ...f, cumulative };
});

function pickFish() {
  const r = Math.random() * TOTAL_WEIGHT;
  for (const entry of CUMULATIVE_TABLE) {
    if (r <= entry.cumulative) return entry;
  }
  return CUMULATIVE_TABLE[CUMULATIVE_TABLE.length - 1]; // fallback, floating point safety
}

// Rolls a random variation factor between 0.60 and 1.40 (±40%), applied to
// both a fish's physical weight and the credits earned for that catch, so a
// heavier-than-average catch pays out proportionally more.
function rollVariationFactor() {
  return 0.60 + Math.random() * 0.80;
}

// Formats a weight in grams into a human-readable string using the most
// sensible unit (g, kg, or tons).
function formatWeight(grams) {
  if (grams >= 1_000_000) {
    return `${(grams / 1_000_000).toFixed(2)} tons`;
  } else if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`;
  } else {
    return `${grams.toFixed(1)} g`;
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`${FISH_TABLE.length} fish loaded.`);
  try {
    await initDatabase();
    console.log('Database ready.');
  } catch (e) {
    console.error('Database init error:', e);
  }
});

const REPAIR_MS = 60 * 60 * 1000; // 1 hour to repair a broken rod passively (if the user does nothing)
const BREAK_CHANCE = 0.04; // 4% chance to break the rod on each cast
const NO_CATCH_CHANCE = 0.20; // 20% chance to catch nothing
const rodBrokenUntil = new Map(); // userId -> timestamp when passive repair finishes
const currentlyFishing = new Set(); // userId currently fishing
const currentlyRepairing = new Set(); // userId currently repairing their rod

const BREAK_MESSAGES = [
  (name) => `😡 ${name} snaps in a fit of rage and breaks their rod in half!`,
  (name) => `🎣💢 ${name} loses their temper and hurls their rod into the deep water!`,
  (name) => `🤬 ${name} smashes their fishing rod against a rock out of pure frustration!`,
  (name) => `😤 ${name} storms off, stomping their rod into pieces!`,
  (name) => `💥 ${name} slams the rod down so hard it shatters!`,
];

// Resolves a single fish catch: picks a fish, applies weight/credit variation,
// records it and awards credits. Returns a formatted line of text for this catch.
async function resolveSingleCatch(userId) {
  const fish = pickFish();
  const emoji = RARITY_EMOJI[fish.rarity];

  let isNew = false;
  try {
    isNew = await recordCatch(userId, fish.name);
  } catch (e) {
    console.error('Error recording catch:', e);
  }
  const newTag = isNew ? ' 🆕 **NEW!**' : '';

  // Roll a single ±40% variation factor, applied to both the catch's
  // weight and the credits earned (a heavier catch pays out more).
  const variationFactor = rollVariationFactor();
  const baseCreditAmount = fish.customCredit ?? CREDIT_VALUES[fish.rarity];
  const creditAmount = Math.max(1, Math.round(baseCreditAmount * variationFactor));

  try {
    await addCredits(userId, creditAmount);
  } catch (e) {
    console.error('Error adding credits:', e);
  }

  const weightText = fish.baseWeightGrams
    ? ` (${formatWeight(fish.baseWeightGrams * variationFactor)})`
    : '';

  if (fish.rarity.startsWith('Legendary')) {
    return `🐟✨ **${fish.name}**${weightText} — ${emoji} **${fish.rarity}** catch! Incredible! ✨${newTag} (+${creditAmount} Bits Coins)`;
  }
  return `🐟 **${fish.name}**${weightText} — ${emoji} ${fish.rarity}${newTag} (+${creditAmount} Bits Coins)`;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.trim().toLowerCase() === '!fish') {
    const userId = message.author.id;
    const now = Date.now();
    // Server display name, falls back to username if unavailable (e.g. DMs)
    const displayName = message.member?.displayName ?? message.author.username;

    // Rod broken?
    const repairEnd = rodBrokenUntil.get(userId);
    if (repairEnd && now < repairEnd) {
      const minutes = Math.ceil((repairEnd - now) / 60000);
      message.reply(`🎣💔 ${displayName}'s fishing rod is broken! ${minutes} more minute(s) until it's repaired.`);
      return;
    }

    // Already fishing?
    if (currentlyFishing.has(userId)) {
      message.reply(`🎣 ${displayName} is already fishing, be patient!`);
      return;
    }

    // Determine this user's break chance and multi-catch chances based on
    // their owned hook upgrade tier (0 = no upgrade, base 4% break chance)
    let hookTier = 0;
    try {
      hookTier = await getHookTier(userId);
    } catch (e) {
      console.error('Error fetching hook tier:', e);
    }
    const tierData = hookTier > 0 ? HOOK_TIERS[hookTier] : null;
    const breakChance = tierData ? tierData.breakChance : BREAK_CHANCE;
    const bonusChances = tierData ? tierData.chances : [];

    currentlyFishing.add(userId);
    const waitMs = Math.floor(Math.random() * (35000 - 15000 + 1)) + 15000;
    const waitingMessage = await message.reply(`🎣 ${displayName} cast his line into the water...`);

    setTimeout(async () => {
      currentlyFishing.delete(userId);

      // Does the rod break?
      if (Math.random() < breakChance) {
        rodBrokenUntil.set(userId, Date.now() + REPAIR_MS);
        try {
          await waitingMessage.edit(`💥 Snap! ${displayName}'s fishing rod broke! It will take 1 hour to repair.`);
        } catch (e) {
          console.error('Error editing message:', e);
        }
        return;
      }

      // Each hook is a separate line in the water. Hooks try one after
      // another as "the first" (using the standard base catch chance) until
      // one of them actually catches a fish — so a miss on hook 1 doesn't
      // waste hook 2, it just gets the same odds hook 1 had. Once ONE fish
      // is caught, any remaining hooks then try for BONUS fish using this
      // tier's (smaller) bonus chances, chained in order — each bonus only
      // rolled if the previous one succeeded. If every hook misses its
      // "first fish" attempt, nothing is caught at all.
      const hookCount = tierData ? tierData.chances.length + 1 : 1;
      const catchLines = [];
      try {
        let hooksLeft = hookCount;
        let hasCaughtFirst = false;
        let bonusIndex = 0;

        while (hooksLeft > 0) {
          hooksLeft--;

          if (!hasCaughtFirst) {
            // This hook attempts as if it were the very first one
            if (Math.random() >= NO_CATCH_CHANCE) {
              hasCaughtFirst = true;
              catchLines.push(await resolveSingleCatch(userId));
            }
            // otherwise: this hook missed, the next one gets the same shot
          } else {
            // We already have a fish — remaining hooks try for a bonus catch
            if (bonusIndex < bonusChances.length && Math.random() < bonusChances[bonusIndex]) {
              catchLines.push(await resolveSingleCatch(userId));
              bonusIndex++;
            } else {
              break; // bonus chain stops on the first failed roll
            }
          }
        }
      } catch (e) {
        console.error('Error resolving catch:', e);
      }

      if (catchLines.length === 0) {
        try {
          await waitingMessage.edit(`🎣 ${displayName} waited patiently... but nothing was biting today.`);
        } catch (e) {
          console.error('Error editing message:', e);
        }
        return;
      }

      const header =
        catchLines.length > 1
          ? `🎏 ${displayName} reeled in **${catchLines.length} fish** at once!\n`
          : `${displayName} `;
      const text = header + catchLines.join('\n');

      try {
        await message.reply(text);
      } catch (e) {
        console.error('Error sending message:', e);
      }
    }, waitMs);
  }

  if (message.content.trim().toLowerCase() === '!fishdex') {
    const userId = message.author.id;
    const displayName = message.member?.displayName ?? message.author.username;

    try {
      const count = await getCollectionCount(userId);
      const total = FISH_TABLE.length;
      const balance = await getCreditBalance(userId);
      const totalCatches = await getTotalCatches(userId);
      const percentage = ((count / total) * 100).toFixed(1);
      const hookTier = await getHookTier(userId);
      const equippedName = hookTier > 0 ? HOOK_TIERS[hookTier].name : 'None';
      const caughtSet = await getCaughtFishNames(userId);

      const statsText = `📖 ${displayName}'s collection: **${count}/${total}** (${percentage}%) different fish caught.\n💰 Bits Coins: **${balance}**\n🎣 Total fish caught: **${totalCatches}**\n🪝 Equipped upgrade: **${equippedName}**`;

      // Build up to 4 dropdowns (Discord caps a select menu at 25 options),
      // covering all 97 fish in the same order as FISH_TABLE (rarity order).
      const PAGE_SIZE = 25;
      const rows = [];
      for (let start = 0; start < FISH_TABLE.length; start += PAGE_SIZE) {
        const pageFish = FISH_TABLE.slice(start, start + PAGE_SIZE);
        const options = pageFish.map((fish, i) => {
          const globalIndex = start + i;
          const caught = caughtSet.has(fish.name);
          const label = `${globalIndex + 1}: ${caught ? fish.name : '???'}`.slice(0, 100);
          return {
            label,
            value: String(globalIndex),
            ...(caught ? { description: fish.rarity } : {}),
          };
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`fishdex_page_${start / PAGE_SIZE}`)
          .setPlaceholder(`Fish #${start + 1}-${start + pageFish.length}`)
          .addOptions(options);

        rows.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      await message.reply({ content: statsText, components: rows });
    } catch (e) {
      console.error('Error fetching collection:', e);
      message.reply(`⚠️ Couldn't fetch your collection right now, try again later.`);
    }
  }

  if (message.content.trim().toLowerCase() === '!repair') {
    const userId = message.author.id;
    const now = Date.now();
    const displayName = message.member?.displayName ?? message.author.username;

    const repairEnd = rodBrokenUntil.get(userId);
    if (!repairEnd || now >= repairEnd) {
      message.reply(`🎣 ${displayName}, your fishing rod isn't broken, no need to repair it!`);
      return;
    }

    if (currentlyRepairing.has(userId)) {
      message.reply(`🔧 ${displayName} is already repairing their rod, be patient!`);
      return;
    }

    let repairInfo;
    try {
      repairInfo = await getRepairInfo(userId);
    } catch (e) {
      console.error('Error fetching repair info:', e);
      message.reply(`⚠️ Couldn't check your Bits Coins balance right now, try again later.`);
      return;
    }

    if (repairInfo.balance < repairInfo.repairCost) {
      message.reply(`💸 ${displayName}, you need **${repairInfo.repairCost}** Bits Coins to repair your rod, but you only have **${repairInfo.balance}**.`);
      return;
    }

    currentlyRepairing.add(userId);
    const waitMs = Math.floor(Math.random() * (120000 - 60000 + 1)) + 60000;
    await message.reply(`🔧 ${displayName} starts repairing their fishing rod...`);

    setTimeout(async () => {
      currentlyRepairing.delete(userId);
      try {
        await addCredits(userId, -repairInfo.repairCost);
        await incrementRepairCount(userId);
        rodBrokenUntil.delete(userId);
        await message.channel.send(`✅ ${displayName}'s fishing rod is repaired and ready to use! (-${repairInfo.repairCost} Bits Coins)`);
      } catch (e) {
        console.error('Error completing repair:', e);
        currentlyRepairing.delete(userId);
      }
    }, waitMs);
  }

  if (message.content.trim().toLowerCase() === '!break') {
    const userId = message.author.id;
    const now = Date.now();
    const displayName = message.member?.displayName ?? message.author.username;

    const repairEnd = rodBrokenUntil.get(userId);
    if (repairEnd && now < repairEnd) {
      message.reply(`🎣💔 ${displayName}, your rod is already broken!`);
      return;
    }

    if (currentlyFishing.has(userId)) {
      message.reply(`🎣 ${displayName}, you can't do that while your line is in the water!`);
      return;
    }

    rodBrokenUntil.set(userId, now + REPAIR_MS);
    const flavor = BREAK_MESSAGES[Math.floor(Math.random() * BREAK_MESSAGES.length)];
    message.reply(flavor(displayName));
  }

  if (message.content.trim().toLowerCase().startsWith('!give')) {
    const senderId = message.author.id;
    const senderName = message.member?.displayName ?? message.author.username;

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      message.reply(`⚠️ ${senderName}, please mention who you want to give Bits Coins to, e.g. \`!give 100 @username\`.`);
      return;
    }

    if (targetUser.bot) {
      message.reply(`⚠️ ${senderName}, you can't give Bits Coins to a bot!`);
      return;
    }

    if (targetUser.id === senderId) {
      message.reply(`⚠️ ${senderName}, you can't give Bits Coins to yourself!`);
      return;
    }

    // Strip mentions from the message so we can find the amount reliably
    const contentWithoutMentions = message.content.replace(/<@!?\d+>/g, '').trim();
    const parts = contentWithoutMentions.split(/\s+/); // e.g. ['!give', '1250']
    const amount = parseInt(parts[1], 10);

    if (!Number.isInteger(amount) || amount <= 0) {
      message.reply(`⚠️ ${senderName}, please specify a valid positive amount, e.g. \`!give 100 @username\`.`);
      return;
    }

    const targetName = message.mentions.members?.first()?.displayName ?? targetUser.username;

    try {
      const result = await transferCredits(senderId, targetUser.id, amount);
      if (!result.success) {
        message.reply(`💸 ${senderName}, you don't have enough Bits Coins! You have **${result.balance}**, but tried to give **${amount}**.`);
        return;
      }
      message.reply(`💸 ${senderName} gave **${amount}** Bits Coins to ${targetName}!`);
    } catch (e) {
      console.error('Error transferring credits:', e);
      message.reply(`⚠️ Something went wrong while transferring Bits Coins, try again later.`);
    }
  }

  if (message.content.trim().toLowerCase() === '!shop') {
    const upgradeOptions = HOOK_TIERS.slice(1).map((tier, index) => {
      const tierNumber = index + 1; // real tier index (1-6)
      const chancesText = tier.chances
        .map((c, i) => `${Math.round(c * 100)}% for fish #${i + 2}`)
        .join(', ');
      return {
        label: `${tier.name} — ${tier.cost.toLocaleString('en-US')} Bits Coins`,
        description: `${chancesText} | Rod break: ${(tier.breakChance * 100).toFixed(1)}%`.slice(0, 100),
        value: String(tierNumber),
      };
    });

    const upgradeMenu = new StringSelectMenuBuilder()
      .setCustomId('shop_hook_upgrade')
      .setPlaceholder('🪝 Upgrades — choose an upgrade to buy...')
      .addOptions(upgradeOptions);

    const trophyOptions = TROPHIES.map((trophy) => {
      let reqText;
      if (trophy.type === 'completion') reqText = `Requires ${trophy.value}% Fishdex completion`;
      else if (trophy.type === 'fish') reqText = trophy.hidden ? `Requires catching a mysterious legendary creature` : `Requires catching: ${trophy.value}`;
      else reqText = `Requires all 4 unique treasures`;
      return {
        label: `${trophy.name} — ${trophy.cost.toLocaleString('en-US')} Bits Coins`,
        description: reqText.slice(0, 100),
        value: trophy.key,
      };
    });

    const trophyMenu = new StringSelectMenuBuilder()
      .setCustomId('shop_trophy')
      .setPlaceholder('🏆 Trophies — choose a trophy to buy...')
      .addOptions(trophyOptions);

    const rows = [
      new ActionRowBuilder().addComponents(upgradeMenu),
      new ActionRowBuilder().addComponents(trophyMenu),
    ];

    await message.reply({
      content: `🎣 **SHOP**\n🪝 **Upgrades** — hook upgrades let you catch multiple fish at once, at the cost of a higher rod break chance.\n🏆 **Trophies** — cosmetic trophies that require both Bits Coins AND meeting a specific in-game achievement.\nPick one below (only you will see the purchase result):`,
      components: rows,
    });
  }
});

// Handles select menu interactions: !shop purchases and !fishdex browsing.
// Replies here are ephemeral, so results are only visible to the person who
// interacted — the original message (shop or fishdex) stays as-is.
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  if (interaction.customId.startsWith('fishdex_page_')) {
    const userId = interaction.user.id;
    const chosenIndex = parseInt(interaction.values[0], 10);
    const fish = FISH_TABLE[chosenIndex];

    if (!fish) {
      await interaction.reply({ content: `⚠️ Invalid fish selection.`, ephemeral: true });
      return;
    }

    try {
      const caughtSet = await getCaughtFishNames(userId);
      if (!caughtSet.has(fish.name)) {
        await interaction.reply({
          content: `❓ You haven't caught fish **#${chosenIndex + 1}** yet — keep fishing to reveal it!`,
          ephemeral: true,
        });
        return;
      }

      const timesCaught = await getTimesCaughtForFish(userId, fish.name);
      const emoji = RARITY_EMOJI[fish.rarity];
      let detail = `🐟 **#${chosenIndex + 1}: ${fish.name}** — ${emoji} ${fish.rarity}\nCaught **${timesCaught}** time(s).`;
      if (fish.baseWeightGrams) {
        const min = formatWeight(fish.baseWeightGrams * 0.6);
        const max = formatWeight(fish.baseWeightGrams * 1.4);
        detail += `\nWeight range: ${min} – ${max}`;
      }

      await interaction.reply({ content: detail, ephemeral: true });
    } catch (e) {
      console.error('Error fetching fish detail:', e);
      await interaction.reply({ content: `⚠️ Something went wrong, try again later.`, ephemeral: true });
    }
    return;
  }

  if (interaction.customId === 'shop_trophy') {
    const userId = interaction.user.id;
    const displayName = interaction.member?.displayName ?? interaction.user.username;
    const trophyKey = interaction.values[0];
    const trophy = TROPHIES.find((t) => t.key === trophyKey);

    if (!trophy) {
      await interaction.reply({ content: `⚠️ Invalid trophy selection.`, ephemeral: true });
      return;
    }

    try {
      const owned = await getOwnedTrophies(userId);
      if (owned.has(trophy.key)) {
        await interaction.reply({
          content: `🏆 ${displayName}, you already own the **${trophy.name}** trophy!`,
          ephemeral: true,
        });
        return;
      }

      const { met, reason } = await checkTrophyRequirement(userId, trophy);
      if (!met) {
        await interaction.reply({
          content: `🔒 ${displayName}, you don't meet the requirement for **${trophy.name}** yet.\n${reason}`,
          ephemeral: true,
        });
        return;
      }

      const balance = await getCreditBalance(userId);
      if (balance < trophy.cost) {
        await interaction.reply({
          content: `💸 ${displayName}, you need **${trophy.cost.toLocaleString('en-US')}** Bits Coins for **${trophy.name}**, but you only have **${balance}**.`,
          ephemeral: true,
        });
        return;
      }

      await addCredits(userId, -trophy.cost);
      await addTrophy(userId, trophy.key);

      await interaction.reply({
        content: `🏆 ${displayName} earned the **${trophy.name}** trophy!`,
        ephemeral: true,
      });
    } catch (e) {
      console.error('Error processing trophy purchase:', e);
      await interaction.reply({ content: `⚠️ Something went wrong with your purchase, try again later.`, ephemeral: true });
    }
    return;
  }

  if (interaction.customId !== 'shop_hook_upgrade') return;

  const userId = interaction.user.id;
  const displayName = interaction.member?.displayName ?? interaction.user.username;
  const chosenTier = parseInt(interaction.values[0], 10);
  const tierData = HOOK_TIERS[chosenTier];

  if (!tierData) {
    await interaction.reply({ content: `⚠️ Invalid upgrade selection.`, ephemeral: true });
    return;
  }

  try {
    const currentTier = await getHookTier(userId);
    if (chosenTier <= currentTier) {
      const ownedName = currentTier > 0 ? HOOK_TIERS[currentTier].name : 'no upgrade';
      await interaction.reply({
        content: `🎣 ${displayName}, you already own **${ownedName}**, which is the same tier or better than **${tierData.name}**. No need to buy it!`,
        ephemeral: true,
      });
      return;
    }

    const balance = await getCreditBalance(userId);
    if (balance < tierData.cost) {
      await interaction.reply({
        content: `💸 ${displayName}, you need **${tierData.cost.toLocaleString('en-US')}** Bits Coins for **${tierData.name}**, but you only have **${balance}**.`,
        ephemeral: true,
      });
      return;
    }

    await addCredits(userId, -tierData.cost);
    await setHookTier(userId, chosenTier);

    await interaction.reply({
      content: `✅ ${displayName} upgraded to **${tierData.name}**! Your fishing rod now has a **${(tierData.breakChance * 100).toFixed(1)}%** break chance, with a shot at catching multiple fish per cast. (This replaces your previous hook upgrade.)`,
      ephemeral: true,
    });
  } catch (e) {
    console.error('Error processing shop purchase:', e);
    await interaction.reply({ content: `⚠️ Something went wrong with your purchase, try again later.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
