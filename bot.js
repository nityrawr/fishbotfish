// Discord Bot - !fish command
// -------------------------------------------------
// Setup:
//   1. npm init -y
//   2. npm install discord.js
//   3. Replace YOUR_TOKEN_HERE with your bot token (Discord Developer Portal)
//   4. node bot.js
// -------------------------------------------------

const { Client, GatewayIntentBits } = require('discord.js');
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

const BASE_REPAIR_COST = 500;
const REPAIR_COST_INCREASE = 50;

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

// Fish table: each fish has its own drop weight (in %) among successful catches.
// Weights are normalized so they sum to ~100.
const FISH_TABLE = [
  { name: 'Trout', rarity: 'Common', weight: 1.4314 },
  { name: 'Mullet', rarity: 'Common', weight: 1.4314 },
  { name: 'Garfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Blue tuskfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Blackspot tuskfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Coral trout', rarity: 'Common', weight: 1.4314 },
  { name: 'Cod', rarity: 'Common', weight: 1.4314 },
  { name: 'Mackerel', rarity: 'Common', weight: 1.4314 },
  { name: 'Carp', rarity: 'Common', weight: 1.4314 },
  { name: 'Perch', rarity: 'Common', weight: 1.4314 },
  { name: 'Sardine', rarity: 'Common', weight: 1.4314 },
  { name: 'Stripey snapper', rarity: 'Common', weight: 1.4314 },
  { name: 'Red emperor', rarity: 'Common', weight: 1.4314 },
  { name: 'Grass emperor', rarity: 'Common', weight: 1.4314 },
  { name: 'Goldspotted rockcod', rarity: 'Common', weight: 1.4314 },
  { name: 'Longfin rockcod', rarity: 'Common', weight: 1.4314 },
  { name: 'Sand bass', rarity: 'Common', weight: 1.4314 },
  { name: 'Queensland groper', rarity: 'Common', weight: 1.4314 },
  { name: 'Mackerel tuna', rarity: 'Common', weight: 1.4314 },
  { name: 'Longtail tuna', rarity: 'Common', weight: 1.4314 },
  { name: 'Spanish mackerel', rarity: 'Common', weight: 1.4314 },
  { name: 'Giant trevally', rarity: 'Common', weight: 1.4314 },
  { name: 'Golden trevally', rarity: 'Common', weight: 1.4314 },
  { name: 'Forktail catfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Beach salmon', rarity: 'Common', weight: 1.4314 },
  { name: 'Mud crab', rarity: 'Common', weight: 1.4314 },
  { name: 'Sand crab', rarity: 'Common', weight: 1.4314 },
  { name: 'Archer fish', rarity: 'Common', weight: 1.4314 },
  { name: 'King crab', rarity: 'Common', weight: 1.4314 },
  { name: 'Brown crab', rarity: 'Common', weight: 1.4314 },
  { name: 'Blue shrimp', rarity: 'Common', weight: 1.4314 },
  { name: 'Pink shrimp', rarity: 'Common', weight: 1.4314 },
  { name: 'Spider crab', rarity: 'Common', weight: 1.4314 },
  { name: 'Pacific giant octopus', rarity: 'Common', weight: 1.4314 },
  { name: 'Swordfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Guppy', rarity: 'Common', weight: 1.4314 },
  { name: 'Goldfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Eel', rarity: 'Common', weight: 1.4314 },
  { name: 'Stingray', rarity: 'Common', weight: 1.4314 },
  { name: 'Tuna', rarity: 'Common', weight: 1.4314 },
  { name: 'Barracuda', rarity: 'Common', weight: 1.4314 },
  { name: 'Mahi mahi', rarity: 'Common', weight: 1.4314 },
  { name: 'Haddock', rarity: 'Common', weight: 1.4314 },
  { name: 'Sea bass', rarity: 'Common', weight: 1.4314 },
  { name: 'Sockeye Salmon', rarity: 'Common', weight: 1.4314 },
  { name: 'Chinook Salmon', rarity: 'Common', weight: 1.4314 },
  { name: 'Pink Salmon', rarity: 'Common', weight: 1.4314 },
  { name: 'Halibut', rarity: 'Common', weight: 1.4314 },
  { name: 'Tilapia', rarity: 'Common', weight: 1.4314 },
  { name: 'Big fin squid', rarity: 'Common', weight: 1.4314 },
  { name: 'Clownfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Catfish', rarity: 'Common', weight: 1.4314 },
  { name: 'Marlin', rarity: 'Common', weight: 1.4314 },
  { name: 'Hammerhead shark', rarity: 'Common', weight: 1.1451 },
  { name: 'Bull shark', rarity: 'Common', weight: 1.1451 },
  { name: 'Tiger shark', rarity: 'Common', weight: 1.1451 },
  { name: 'Great white shark', rarity: 'Rare', weight: 0.8589 },
  { name: 'Electric eel', rarity: 'Rare', weight: 0.8589 },
  { name: 'Lionfish', rarity: 'Rare', weight: 0.8589 },
  { name: 'Horseshoe crab', rarity: 'Rare', weight: 0.8589 },
  { name: 'Flying gurnard', rarity: 'Rare', weight: 0.8589 },
  { name: 'Flying fish', rarity: 'Rare', weight: 0.8589 },
  { name: 'Electric ray', rarity: 'Rare', weight: 0.8589 },
  { name: 'Star gazer fish', rarity: 'Rare', weight: 0.8589 },
  { name: 'Suckermouth catfish', rarity: 'Rare', weight: 0.8589 },
  { name: 'Orca', rarity: 'Rare', weight: 0.8589 },
  { name: 'Alligatorfish', rarity: 'Rare', weight: 0.8589 },
  { name: 'Manta ray', rarity: 'Rare', weight: 0.8589 },
  { name: 'Deepsea squid', rarity: 'Rare', weight: 0.8589 },
  { name: 'Blue ringed octopus', rarity: 'Rare', weight: 0.7873 },
  { name: 'Coconut octopus', rarity: 'Rare', weight: 0.7873 },
  { name: 'Giant squid', rarity: 'Rare', weight: 0.6298 },
  { name: 'Dolphin', rarity: 'Rare', weight: 0.8589 },
  { name: 'Sunfish', rarity: 'Rare', weight: 0.8589 },
  { name: 'Blue whale', rarity: 'Rare', weight: 0.8589 },
  { name: 'Greenland shark', rarity: 'Epic', weight: 0.4294 },
  { name: 'Saw shark', rarity: 'Epic', weight: 0.4294 },
  { name: 'Tequila splitfin', rarity: 'Epic', weight: 0.4294 },
  { name: 'Ornate sleeper ray', rarity: 'Epic', weight: 0.4294 },
  { name: 'Oarfish', rarity: 'Epic', weight: 0.4294 },
  { name: 'Giant sea bass', rarity: 'Epic', weight: 0.4294 },
  { name: 'Beluga sturgeon', rarity: 'Epic', weight: 0.2863 },
  { name: 'Alligator gar', rarity: 'Epic', weight: 0.4294 },
  { name: 'Arapaïma gigas', rarity: 'Epic', weight: 0.4294 },
  { name: 'Whale shark', rarity: 'Epic', weight: 0.4294 },
  { name: 'Chernobyl monster catfish', rarity: 'Legendary', weight: 0.1431 },
  { name: 'European sturgeon', rarity: 'Legendary', weight: 0.1431 },
  { name: 'Giant dam catfish', rarity: 'Legendary', weight: 0.0859 },
  { name: 'White whale', rarity: 'Legendary', weight: 0.0716 },
  { name: 'Coelacanth', rarity: 'Legendary', weight: 0.0716 },
  { name: 'Megalodon', rarity: 'Legendary', weight: 0.0286 },
  { name: 'Loch ness monster', rarity: 'Legendary', weight: 0.0286 },
  { name: 'Kraken', rarity: 'Legendary', weight: 0.0286 }
];

const RARITY_EMOJI = {
  Common: '⚪',
  Rare: '🔵',
  Epic: '🟣',
  Legendary: '🟡',
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
const BREAK_CHANCE = 0.05; // 5% chance to break the rod on each cast
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

    currentlyFishing.add(userId);
    const waitMs = Math.floor(Math.random() * (35000 - 15000 + 1)) + 15000;
    const waitingMessage = await message.reply(`🎣 ${displayName} cast his line into the water...`);

    setTimeout(async () => {
      currentlyFishing.delete(userId);

      // Does the rod break?
      if (Math.random() < BREAK_CHANCE) {
        rodBrokenUntil.set(userId, Date.now() + REPAIR_MS);
        try {
          await waitingMessage.edit(`💥 Snap! ${displayName}'s fishing rod broke! It will take 1 hour to repair.`);
        } catch (e) {
          console.error('Error editing message:', e);
        }
        return;
      }

      // Nothing biting this time?
      if (Math.random() < NO_CATCH_CHANCE) {
        try {
          await waitingMessage.edit(`🎣 ${displayName} waited patiently... but nothing was biting today.`);
        } catch (e) {
          console.error('Error editing message:', e);
        }
        return;
      }

      const fish = pickFish();
      const emoji = RARITY_EMOJI[fish.rarity];

      let isNew = false;
      try {
        isNew = await recordCatch(userId, fish.name);
      } catch (e) {
        console.error('Error recording catch:', e);
      }
      const newTag = isNew ? ' 🆕 **NEW!**' : '';

      const creditAmount = CREDIT_VALUES[fish.rarity];
      try {
        await addCredits(userId, creditAmount);
      } catch (e) {
        console.error('Error adding credits:', e);
      }

      let text;
      if (fish.rarity === 'Legendary') {
        text = `🐟✨ ${displayName} caught a **${fish.name}** — ${emoji} **${fish.rarity}** catch! Incredible! ✨${newTag}\n💰 +${creditAmount} Bits Coins`;
      } else {
        text = `🐟 ${displayName} caught a **${fish.name}** — ${emoji} ${fish.rarity}${newTag}\n💰 +${creditAmount} Bits Coins`;
      }

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
      message.reply(`📖 ${displayName}'s collection: **${count}/${total}** different fish caught.\n💰 Bits Coins: **${balance}**\n🎣 Total fish caught: **${totalCatches}**`);
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
});

client.login(process.env.DISCORD_TOKEN);
