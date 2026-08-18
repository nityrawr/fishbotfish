// Discord Bot - !fish command
// -------------------------------------------------
// Setup:
//   1. npm init -y
//   2. npm install discord.js
//   3. Replace YOUR_TOKEN_HERE with your bot token (Discord Developer Portal)
//   4. node bot.js
// -------------------------------------------------

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // must also be enabled in the Developer Portal
  ],
});

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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`${FISH_TABLE.length} fish loaded.`);
});

const REPAIR_MS = 60 * 60 * 1000; // 1 hour to repair a broken rod
const BREAK_CHANCE = 0.05; // 5% chance to break the rod on each cast
const NO_CATCH_CHANCE = 0.20; // 20% chance to catch nothing
const rodBrokenUntil = new Map(); // userId -> timestamp when repair finishes
const currentlyFishing = new Set(); // userId currently fishing

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

      let text;
      if (fish.rarity === 'Legendary') {
        text = `🐟✨ ${displayName} caught a **${fish.name}** — ${emoji} **${fish.rarity}** catch! Incredible! ✨`;
      } else {
        text = `🐟 ${displayName} caught a **${fish.name}** — ${emoji} ${fish.rarity}`;
      }

      try {
        await waitingMessage.edit(text);
      } catch (e) {
        console.error('Error editing message:', e);
      }
    }, waitMs);
  }
});

client.login(process.env.DISCORD_TOKEN);
