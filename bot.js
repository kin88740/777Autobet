const { Telegraf, Markup, session } = require('telegraf');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

// Logging configuration
const logging = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  warning: (msg) => console.log(`[WARN] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

const BOT_TOKEN = "7724287416:AAESOBhPmQbno9hRYFSUEXtyBDjp0un5JHs";
const BASE_URL = "https://api.bigwinqaz.com/api/webapi/";
const IGNORE_SSL = true;
const WIN_LOSE_CHECK_INTERVAL = 2;
const MAX_RESULT_WAIT_TIME = 60;
const ADMIN_ID = 6867481050;
const MAX_BALANCE_RETRIES = 10;
const BALANCE_RETRY_DELAY = 5;
const BALANCE_API_TIMEOUT = 20000;
const BET_API_TIMEOUT = 30000;
const MAX_BET_RETRIES = 3;
const BET_RETRY_DELAY = 5;
const MAX_CONSECUTIVE_ERRORS = 5;
const MESSAGE_RATE_LIMIT_SECONDS = 10;
const MAX_TELEGRAM_RETRIES = 3;
const TELEGRAM_RETRY_DELAY = 2000;
const DEFAULT_BS_ORDER = "BSBBSBSSSB";
const VIRTUAL_BALANCE = 786700;
const MIN_AI_PREDICTION_DATA = 5;
const MIN_LYZO_PREDICTION_DATA = 10;
const DREAM2_PATTERN = "BBSBSSBBSBSS";

// Global storage
const userState = {};
const userTemp = {};
const userSessions = {};
const userSettings = {};
const userPendingBets = {};
const userWaitingForResult = {};
const userStats = {};
const userGameInfo = {};
const userSkippedBets = {};
const userShouldSkipNext = {};
const userBalanceWarnings = {};
const userSkipResultWait = {};
const userLast10Results = {};
const userLyzoRoundCount = {};
const userAILast10Results = {};
const userAIRoundCount = {};
const userStopInitiated = {};
const userSLSkipWaitingForWin = {};
let allowed777bigwinIds = new Set();
let patterns = {};
let dreamPatterns = {};

// Ensure data directory exists
const ensureDataDir = () => {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
};

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ 
      rejectUnauthorized: !IGNORE_SSL,
      keepAlive: true,
      keepAliveMsecs: 1000
    });
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; Mobile Build/QP1A.190711.020)',
        'Connection': 'Keep-Alive'
      },
      timeout: 12000
    };
    
    const requestOptions = {
      ...defaultOptions,
      ...options,
      agent
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ data: jsonData });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Security helpers
function loadAllowedUsers() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'users_777bigwin.json');
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      allowed777bigwinIds = new Set(data.allowed_ids || []);
      logging.info(`Loaded ${allowed777bigwinIds.size} users`);
    } else {
      logging.warning("users_777bigwin.json not found. Starting new");
      allowed777bigwinIds = new Set();
      // Create empty file
      saveAllowedUsers();
    }
  } catch (error) {
    logging.error(`Error loading users_777bigwin.json: ${error}`);
    allowed777bigwinIds = new Set();
  }
}

function saveAllowedUsers() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'users_777bigwin.json');
    
    fs.writeFileSync(filePath, JSON.stringify({ 
      allowed_ids: Array.from(allowed777bigwinIds) 
    }, null, 4));
    logging.info(`Saved ${allowed777bigwinIds.size} users`);
  } catch (error) {
    logging.error(`Error saving user list: ${error}`);
  }
}

// Load patterns for Lyzo strategy
function loadPatterns() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'patterns.json');
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      patterns = data;
      logging.info(`Loaded ${Object.keys(patterns).length} patterns for Lyzo strategy`);
    } else {
      logging.warning("patterns.json not found. Lyzo strategy will not work properly.");
      patterns = {};
      // Create empty file
      fs.writeFileSync(filePath, JSON.stringify({}, null, 4));
    }
  } catch (error) {
    logging.error(`Error loading patterns.json: ${error}`);
    patterns = {};
  }
}

// Load patterns for DREAM strategy
function loadDreamPatterns() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'dream.json');
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      dreamPatterns = data;
      logging.info(`Loaded ${Object.keys(dreamPatterns).length} patterns for DREAM strategy`);
    } else {
      logging.warning("dream.json not found. DREAM strategy will not work properly.");
      dreamPatterns = {
        "0": "SBBSBSSBBS",
        "1": "BBSBSBSBBS",
        "2": "SBSBBSBSBB",
        "3": "BSBSBSSBSB",
        "4": "SBBSBSBBSS",
        "5": "BSSBSBBSBS",
        "6": "BSBSSBSBSB",
        "7": "SBSBSBSSBB",
        "8": "BSBBSBSBSB",
        "9": "SBSBBSSBSB"
      };
      // Create default file
      fs.writeFileSync(filePath, JSON.stringify(dreamPatterns, null, 4));
    }
  } catch (error) {
    logging.error(`Error loading dream.json: ${error}`);
    dreamPatterns = {
      "0": "SBBSBSSBBS",
      "1": "BBSBSBSBBS",
      "2": "SBSBBSBSBB",
      "3": "BSBSBSSBSB",
      "4": "SBBSBSBBSS",
      "5": "BSSBSBBSBS",
      "6": "BSBSSBSBSB",
      "7": "SBSBSBSSBB",
      "8": "BSBBSBSBSB",
      "9": "SBSBBSSBSB"
    };
  }
}

function normalizeText(text) {
  return text.normalize('NFKC').trim();
}

function signMd5(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "signature" && key !== "timestamp") {
      filtered[key] = value;
    }
  }
  const sorted = Object.keys(filtered).sort().reduce((acc, key) => {
    acc[key] = filtered[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function signMd5Original(data) {
  const dataCopy = { ...data };
  delete dataCopy.signature;
  delete dataCopy.timestamp;
  const sorted = Object.keys(dataCopy).sort().reduce((acc, key) => {
    acc[key] = dataCopy[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const amtStr = String(amt);
  const trailingZeros = amtStr.length - amtStr.replace(/0+$/, '').length;
  
  if (trailingZeros >= 4) return 10000;
  if (trailingZeros === 3) return 1000;
  if (trailingZeros === 2) return 100;
  if (trailingZeros === 1) return 10;
  return Math.pow(10, amtStr.length - 1);
}

function getSelectMap(gameType) {
  return { "B": 13, "S": 14 };
}

function numberToBS(num) {
  return num >= 5 ? 'B' : 'S';
}

// Updated AI prediction function
async function getAIPrediction(userId, gameType) {
  try {
    if (!userAILast10Results[userId]) {
      userAILast10Results[userId] = [];
    }
    if (!userAIRoundCount[userId]) {
      userAIRoundCount[userId] = 0;
    }
    
    userAIRoundCount[userId]++;
    
    if (userAIRoundCount[userId] <= 10) {
      const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`AI Prediction: Round ${userAIRoundCount[userId]} - Random (${randomPrediction})`);
      return { result: randomPrediction, percent: '50.0' };
    }
    
    if (userAILast10Results[userId].length < MIN_AI_PREDICTION_DATA) {
      const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`AI Prediction: Not enough results (${userAILast10Results[userId].length}), using random (${randomPrediction})`);
      return { result: randomPrediction, percent: '50.0' };
    }
    
    const lastTenResults = userAILast10Results[userId].slice(-10);
    logging.debug(`AI Prediction: Last 10 results: ${lastTenResults.join(', ')}`);
    
    const counts = { B: 0, S: 0 };
    for (const result of lastTenResults) {
      counts[result]++;
    }
    
    const lastThree = lastTenResults.slice(-3).join('');
    
    if (lastThree === 'BBB') {
      logging.info(`AI Prediction: S (based on BBB pattern)`);
      return { result: 'S', percent: '70.0' };
    } else if (lastThree === 'SSS') {
      logging.info(`AI Prediction: B (based on SSS pattern)`);
      return { result: 'B', percent: '70.0' };
    }
    
    let prediction;
    if (counts.B > counts.S) {
      prediction = 'B';
      logging.info(`AI Prediction: B (B appeared ${counts.B} times, S appeared ${counts.S} times)`);
    } else if (counts.S > counts.B) {
      prediction = 'S';
      logging.info(`AI Prediction: S (S appeared ${counts.S} times, B appeared ${counts.B} times)`);
    } else {
      prediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`AI Prediction: Random (${prediction}) due to tie (B: ${counts.B}, S: ${counts.S})`);
    }
    
    const diff = Math.abs(counts.B - counts.S);
    const confidence = 50 + (diff * 5);
    const percent = Math.min(confidence, 95).toFixed(1);
    
    return { result: prediction, percent };
  } catch (error) {
    logging.error(`Error getting AI prediction: ${error}`);
    const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
    return { result: randomPrediction, percent: '50.0' };
  }
}

async function getLyzoPrediction(userId, gameType) {
  try {
    if (Object.keys(patterns).length === 0) {
      logging.warning("No patterns loaded for Lyzo strategy");
      return null;
    }
    
    if (!userLast10Results[userId]) {
      userLast10Results[userId] = [];
    }
    if (!userLyzoRoundCount[userId]) {
      userLyzoRoundCount[userId] = 0;
    }
    
    userLyzoRoundCount[userId]++;
    
    if (userLyzoRoundCount[userId] <= 10) {
      const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`Lyzo Prediction: Round ${userLyzoRoundCount[userId]} - Random (${randomPrediction})`);
      return { result: randomPrediction, percent: '50.0' };
    }
    
    if (userLast10Results[userId].length < MIN_LYZO_PREDICTION_DATA) {
      const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`Lyzo Prediction: Not enough results (${userLast10Results[userId].length}), using random (${randomPrediction})`);
      return { result: randomPrediction, percent: '50.0' };
    }
    
    const lastTenResults = userLast10Results[userId].slice(-10);
    logging.debug(`Lyzo Prediction: Last 10 results: ${lastTenResults.join(', ')}`);
    
    const patternString = lastTenResults.join('');
    logging.debug(`Lyzo Prediction: Pattern string: ${patternString}`);
    
    const prediction = patterns[patternString];
    
    if (prediction) {
      logging.info(`Lyzo Prediction: ${prediction} (matched pattern: ${patternString})`);
      return { result: prediction, percent: 'N/A' };
    } else {
      logging.debug(`No matching pattern found for: ${patternString}`);
      const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`Lyzo Prediction: Random (${randomPrediction}) because no pattern matched`);
      return { result: randomPrediction, percent: '50.0' };
    }
  } catch (error) {
    logging.error(`Error getting Lyzo prediction: ${error}`);
    const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
    return { result: randomPrediction, percent: '50.0' };
  }
}

function getValidDalembertBetAmount(unitSize, currentUnits, balance, minBet) {
  let amount = unitSize * currentUnits;
  
  while (amount > balance && currentUnits > 1) {
    currentUnits--;
    amount = unitSize * currentUnits;
  }
  
  if (amount > balance) {
    amount = balance;
  }
  
  if (amount < minBet) {
    amount = minBet;
  }
  
  return { amount, adjustedUnits: currentUnits };
}

function computeBetDetails(desiredAmount) {
  if (desiredAmount <= 0) {
    return { unitAmount: 0, betCount: 0, actualAmount: 0 };
  }
  
  const unitAmount = computeUnitAmount(desiredAmount);
  const betCount = Math.max(1, Math.floor(desiredAmount / unitAmount));
  const actualAmount = unitAmount * betCount;
  
  return { unitAmount, betCount, actualAmount };
}

function calculateBetAmount(settings, currentBalance) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  const minBetSize = Math.min(...betSizes);
  
  logging.debug(`Calculating bet amount - Strategy: ${bettingStrategy}, Bet Sizes: [${betSizes.join(', ')}]`);
  
  if (bettingStrategy === "D'Alembert") {
    if (betSizes.length > 1) {
      throw new Error("D'Alembert strategy requires only ONE bet size");
    }
    
    const unitSize = betSizes[0];
    let units = settings.dalembert_units || 1;
    
    const { amount: validAmount, adjustedUnits } = getValidDalembertBetAmount(unitSize, units, currentBalance, minBetSize);
    
    if (adjustedUnits !== units) {
      settings.dalembert_units = adjustedUnits;
      units = adjustedUnits;
      logging.info(`D'Alembert: Adjusted units to ${units} due to balance constraints`);
    }
    
    logging.info(`D'Alembert: Betting ${validAmount} (${units} units of ${unitSize})`);
    return validAmount;
    
  } else if (bettingStrategy === "Custom") {
    const customIndex = settings.custom_index || 0;
    const adjustedIndex = Math.min(customIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`Custom: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
    
  } else {
    // Martingale or Anti-Martingale
    const martinIndex = settings.martin_index || 0;
    const adjustedIndex = Math.min(martinIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`${bettingStrategy}: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
  }
}

// Function to update betting strategy after win/loss
function updateBettingStrategy(settings, isWin, betAmount) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  
  logging.debug(`Updating betting strategy - Strategy: ${bettingStrategy}, Result: ${isWin ? 'WIN' : 'LOSS'}, Bet Amount: ${betAmount}`);
  
  if (bettingStrategy === "Martingale") {
    if (isWin) {
      settings.martin_index = 0;
      logging.info("Martingale: Win - Reset to index 0");
    } else {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Martingale: Loss - Move to index ${settings.martin_index}`);
    }
    
  } else if (bettingStrategy === "Anti-Martingale") {
    if (isWin) {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Anti-Martingale: Win - Move to index ${settings.martin_index}`);
    } else {
      settings.martin_index = 0;
      logging.info("Anti-Martingale: Loss - Reset to index 0");
    }
    
  } else if (bettingStrategy === "D'Alembert") {
    if (isWin) {
      settings.dalembert_units = Math.max(1, (settings.dalembert_units || 1) - 1);
      logging.info(`D'Alembert: Win - Decrease units to ${settings.dalembert_units}`);
    } else {
      settings.dalembert_units = (settings.dalembert_units || 1) + 1;
      logging.info(`D'Alembert: Loss - Increase units to ${settings.dalembert_units}`);
    }
    
  } else if (bettingStrategy === "Custom") {
    const currentIndex = settings.custom_index || 0;
    
    // Find the current bet amount index
    let actualIndex = 0;
    for (let i = 0; i < betSizes.length; i++) {
      if (betSizes[i] === betAmount) {
        actualIndex = i;
        break;
      }
    }
    
    if (isWin) {
      // After win, move to previous index if possible
      if (actualIndex > 0) {
        settings.custom_index = actualIndex - 1;
      } else {
        settings.custom_index = 0;
      }
      logging.info(`Custom: Win - Move to index ${settings.custom_index}`);
    } else {
      // After loss, move to next index if possible
      if (actualIndex < betSizes.length - 1) {
        settings.custom_index = actualIndex + 1;
      } else {
        settings.custom_index = betSizes.length - 1;
      }
      logging.info(`Custom: Loss - Move to index ${settings.custom_index}`);
    }
  }
}

// API wrappers with improved error handling
async function loginRequest(phone, password) {
  const body = {
    "phonetype": -1,
    "language": 0,
    "logintype": "mobile",
    "random": "9078efc98754430e92e51da59eb2563c",
    "username": "95" + phone,
    "pwd": password
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await makeRequest(BASE_URL + "Login", {
      method: 'POST',
      body: body
    });
    
    const res = response.data;
    if (res.code === 0 && res.data) {
      const tokenHeader = res.data.tokenHeader || "Bearer ";
      const token = res.data.token || "";
      const session = {
        post: async (endpoint, data) => {
          const url = BASE_URL + endpoint;
          const options = {
            method: 'POST',
            headers: {
              "Authorization": `${tokenHeader}${token}`,
              "Content-Type": "application/json; charset=UTF-8",
              "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 10; Build/QP1A.190711.020)"
            },
            body: data
          };
          return makeRequest(url, options);
        }
      };
      return { response: res, session };
    }
    return { response: res, session: null };
  } catch (error) {
    logging.error(`Login error: ${error.message}`);
    return { response: { error: error.message }, session: null };
  }
}

async function getUserInfo(session, userId) {
  const body = {
    "language": 0,
    "random": "9078efc98754430e92e51da59eb2563c"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetUserInfo", body);
    const res = response.data;
    if (res.code === 0 && res.data) {
      const info = {
        "user_id": res.data.userId,
        "username": res.data.userName,
        "nickname": res.data.nickName,
        "balance": res.data.amount,
        "photo": res.data.userPhoto,
        "login_date": res.data.userLoginDate,
        "withdraw_count": res.data.withdrawCount,
        "is_allow_withdraw": res.data.isAllowWithdraw === 1
      };
      userGameInfo[userId] = info;
      return info;
    }
    return null;
  } catch (error) {
    logging.error(`Get user info error: ${error.message}`);
    return null;
  }
}

async function getBalance(session, userId) {
  const body = {
    "language": 0,
    "random": "9078efc6f3794bf49f257d07937d1a29"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetBalance", body);
    const res = response.data;
    logging.info(`Balance check response for user ${userId}: ${JSON.stringify(res)}`);
    
    if (res.code === 0 && res.data) {
      const data = res.data;
      const amount = data.Amount || data.amount || data.balance;
      if (amount !== undefined && amount !== null) {
        const balance = parseFloat(amount);
        if (userGameInfo[userId]) {
          userGameInfo[userId].balance = balance;
        }
        if (!userStats[userId]) {
          userStats[userId] = { start_balance: balance, profit: 0.0 };
        }
        return balance;
      }
      logging.warning(`No balance amount found for user ${userId}: ${JSON.stringify(res)}`);
    } else {
      logging.error(`Get balance failed for user ${userId}: ${res.msg || 'Unknown error'}`);
    }
    return null;
  } catch (error) {
    logging.error(`Balance check error for user ${userId}: ${error.message}`);
    return null;
  }
}

async function getGameIssueRequest(session, gameType) {
  const body = {
    "typeId": gameType === "TRX" ? 13 : 1,
    "language": 0,
    "random": "b05034ba4a2642009350ee863f29e2e9"
  };
  body.signature = signMd5(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const endpoint = gameType === "TRX" ? "GetTrxGameIssue" : "GetGameIssue";
    const response = await session.post(endpoint, body);
    logging.info(`Game issue request for ${gameType}: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    logging.error(`Game issue error for ${gameType}: ${error.message}`);
    return { error: error.message };
  }
}

async function placeBetRequest(session, issueNumber, selectType, unitAmount, betCount, gameType, userId) {
  const betBody = {
    "typeId": gameType === "TRX" ? 13 : 1,
    "issuenumber": issueNumber,
    "language": 0,
    "gameType": 2,
    "amount": unitAmount,
    "betCount": betCount,
    "selectType": selectType,
    "random": "9078efc98754430e92e51da59eb2563c"
  };
  betBody.signature = signMd5Original(betBody).toUpperCase();
  betBody.timestamp = Math.floor(Date.now() / 1000);
  const endpoint = gameType === "TRX" ? "GameTrxBetting" : "GameBetting";
  
  for (let attempt = 0; attempt < MAX_BET_RETRIES; attempt++) {
    try {
      const response = await session.post(endpoint, betBody);
      const res = response.data;
      logging.info(`Bet request for user ${userId}, ${gameType}, issue ${issueNumber}, select_type ${selectType}, amount ${unitAmount * betCount}: ${JSON.stringify(res)}`);
      return res;
    } catch (error) {
      logging.error(`Bet error for user ${userId}, attempt ${attempt + 1}: ${error.message}`);
      
      if (attempt < MAX_BET_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BET_RETRY_DELAY * 1000));
        continue;
      }
      return { error: error.message };
    }
  }
  return { error: "Failed after retries" };
}

// WINGO API function using Python code parameters
async function getNoaverageEmerdListRequest(session) {
  const body = {
    "pageSize": 10,
    "typeId": 1,
    "language": 7,
    "random": "f15bdcc4e6a04f8f828c4627baea8434",
    "signature": "5436315B4844CE16E7AB5BFB42A8FC3B",
    "timestamp": Math.floor(Date.now() / 1000)
  };
  
  const headers = {
    "Content-Type": "application/json"
  };
  
  try {
    const response = await makeRequest("https://api.bigwinqaz.com/api/webapi/GetNoaverageEmerdList", {
      method: 'POST',
      headers: headers,
      body: body
    });
    
    logging.info(`Emerd list request for Wingo: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    logging.error(`Emerd list error for Wingo: ${error.message}`);
    return { error: error.message };
  }
}

async function getGameHistory(session) {
  const body = {
    "pageSize": 10000,
    "typeId": 1,
    "language": 7,
    "random": "f15bdcc4e6a04f82828b2f7a7b4c6e5a"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetNoaverageEmerdList", body);
    const data = response.data?.list || [];
    logging.debug(`Game history response: ${data.length} records retrieved`);
    
    const validData = data.filter(item => item && item.number !== undefined && item.number !== null);
    logging.debug(`Game history valid records: ${validData.length} out of ${data.length}`);
    
    return validData;
  } catch (error) {
    logging.error(`Error fetching game history: ${error.message}`);
    return [];
  }
}

// Telegram message retry
async function sendMessageWithRetry(ctx, text, replyMarkup = null) {
  for (let attempt = 0; attempt < MAX_TELEGRAM_RETRIES; attempt++) {
    try {
      if (replyMarkup) {
        await ctx.reply(text, replyMarkup);
      } else {
        await ctx.reply(text);
      }
      return true;
    } catch (error) {
      logging.error(`Telegram message error, attempt ${attempt + 1}: ${error.message}`);
      if (attempt < MAX_TELEGRAM_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, TELEGRAM_RETRY_DELAY));
        continue;
      }
      return false;
    }
  }
  return false;
}

// Check profit target and stop bot if reached
async function checkProfitAndStopLoss(userId, bot) {
  const settings = userSettings[userId] || {};
  const targetProfit = settings.target_profit;
  const stopLossLimit = settings.stop_loss;
  
  if (!targetProfit && !stopLossLimit) {
    return false;
  }
  
  let currentProfit;
  let balanceText;
  
  if (settings.virtual_mode) {
    currentProfit = (userStats[userId].virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
    balanceText = `Final Virtual Balance: ${userStats[userId].virtual_balance.toFixed(2)} MMK\n`;
  } else {
    currentProfit = userStats[userId].profit || 0;
    const session = userSessions[userId];
    const finalBalance = await getBalance(session, userId);
    balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} MMK\n`;
  }
  
  // Check for profit target reached
  if (targetProfit && currentProfit >= targetProfit) {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    
    // Reset betting strategy
    delete settings.bet_sizes;
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    
    // Calculate profit indicator
    let profitIndicator = "";
    if (currentProfit > 0) {
      profitIndicator = "+";
    } else if (currentProfit < 0) {
      profitIndicator = "-";
    }
    
    const message = `🎯 PROFIT TARGET REACHED! 🎯\n` +
                   `Target: ${targetProfit} MMK\n` +
                   `Achieved: ${profitIndicator}${currentProfit.toFixed(2)} MMK\n` +
                   balanceText;
    
    try {
      await bot.telegram.sendMessage(userId, message, makeMainKeyboard(true));
      userStopInitiated[userId] = true;
    } catch (error) {
      logging.error(`Failed to send profit target message to ${userId}: ${error.message}`);
    }
    
    return true;
  }
  
  // Check for stop loss limit reached
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    
    // Reset betting strategy
    delete settings.bet_sizes;
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    
    const message = `🛑 STOP LOSS LIMIT REACHED! 🛑\n` +
                   `Stop Loss Limit: ${stopLossLimit} MMK\n` +
                   `Current Loss: ${Math.abs(currentProfit).toFixed(2)} MMK\n` +
                   balanceText;
    
    try {
      await bot.telegram.sendMessage(userId, message, makeMainKeyboard(true));
      userStopInitiated[userId] = true;
    } catch (error) {
      logging.error(`Failed to send stop loss message to ${userId}: ${error.message}`);
    }
    
    return true;
  }
  
  return false;
}

// Win/lose checker with improved SL layer logic
async function winLoseChecker(bot) {
  logging.info("Win/lose checker started");
  while (true) {
    try {
      for (const [userId, session] of Object.entries(userSessions)) {
        if (!session) continue;
        const settings = userSettings[userId] || {};
        const gameType = settings.game_type || "WINGO";
        
        let issueRes;
        if (gameType === "WINGO") {
          issueRes = await getNoaverageEmerdListRequest(session);
        } else {
          issueRes = await getGameIssueRequest(session, gameType);
        }
        
        if (!issueRes || issueRes.code !== 0) {
          continue;
        }
        
        const data = gameType === "WINGO" ? (issueRes.data?.list || []) : (issueRes.data ? [issueRes.data.settled || {}] : []);
        
        // Process pending bets (ACTUAL BETS)
        if (userPendingBets[userId]) {
          for (const [period, betInfo] of Object.entries(userPendingBets[userId])) {
            const settled = data.find(item => item.issueNumber === period);
            if (settled && settled.number) {
              const [betType, amount, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const isWin = (betType === "B" && bigSmall === "B") || (betType === "S" && bigSmall === "S");
              
              // Store result for AI strategy
              if (settings.strategy === "AI_PREDICTION") {
                if (!userAILast10Results[userId]) {
                  userAILast10Results[userId] = [];
                }
                userAILast10Results[userId].push(bigSmall);
                if (userAILast10Results[userId].length > 10) {
                  userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for AI: ${bigSmall} (now have ${userAILast10Results[userId].length} results)`);
              }
              
              // Store result for Lyzo strategy if using TRX
              if (gameType === "TRX" && settings.strategy === "LYZO") {
                if (!userLast10Results[userId]) {
                  userLast10Results[userId] = [];
                }
                userLast10Results[userId].push(bigSmall);
                if (userLast10Results[userId].length > 10) {
                  userLast10Results[userId] = userLast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for Lyzo: ${bigSmall} (now have ${userLast10Results[userId].length} results)`);
              }
              
              const entryLayer = settings.layer_limit || 1;
              
              // Entry Layer logic
              if (entryLayer === 2) {
                if (!settings.entry_layer_state) {
                  settings.entry_layer_state = { waiting_for_lose: true };
                }
                
                if (isWin) {
                  // Win - reset to wait for 1 lose
                  settings.entry_layer_state.waiting_for_lose = true;
                } else {
                  // Lose - if we were waiting for a lose, now we can bet
                  if (settings.entry_layer_state.waiting_for_lose) {
                    settings.entry_layer_state.waiting_for_lose = false;
                  }
                }
              } else if (entryLayer === 3) {
                if (!settings.entry_layer_state) {
                  settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
                }
                
                if (isWin) {
                  // Win - reset to wait for 2 consecutive loses
                  settings.entry_layer_state.waiting_for_loses = true;
                  settings.entry_layer_state.consecutive_loses = 0;
                } else {
                  // Lose - increment consecutive loses counter
                  settings.entry_layer_state.consecutive_loses++;
                  
                  // If we have 2 consecutive loses, we can now bet
                  if (settings.entry_layer_state.consecutive_loses >= 2) {
                    settings.entry_layer_state.waiting_for_loses = false;
                  }
                }
              }
              
              // SL layer logic
              if (settings.sl_layer && settings.sl_layer > 0) {
                if (isWin) {
                  settings.consecutive_losses = 0;
                  userShouldSkipNext[userId] = false;
                  
                  // If we were waiting for a skip win and got a win, reset SL skip state
                  if (userSLSkipWaitingForWin[userId]) {
                    delete userSLSkipWaitingForWin[userId];
                    logging.info(`SL Layer: Got win after skip, resetting SL state for user ${userId}`);
                  }
                  
                  // Update betting strategy after win
                  updateBettingStrategy(settings, true, amount);
                } else {
                  // ONLY increment consecutive_losses for ACTUAL losses
                  settings.consecutive_losses = (settings.consecutive_losses || 0) + 1;
                  logging.info(`SL Layer: Consecutive losses increased to ${settings.consecutive_losses}/${settings.sl_layer}`);
                  
                  // Update betting strategy after loss
                  updateBettingStrategy(settings, false, amount);
                  
                  if (settings.consecutive_losses >= settings.sl_layer) {
                    // Save current state before skipping
                    const bettingStrategy = settings.betting_strategy || "Martingale";
                    if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
                      settings.original_martin_index = settings.martin_index || 0;
                    } else if (bettingStrategy === "D'Alembert") {
                      settings.original_dalembert_units = settings.dalembert_units || 1;
                    } else if (bettingStrategy === "Custom") {
                      settings.original_custom_index = settings.custom_index || 0;
                    }
                    
                    settings.skip_betting = true;
                    userShouldSkipNext[userId] = true;
                    userSLSkipWaitingForWin[userId] = true;
                    logging.warning(`SL Layer triggered! Skipping next bet after ${settings.consecutive_losses} consecutive losses. Waiting for skip win.`);
                  }
                }
              } else {
                // No SL layer - update betting strategy normally
                updateBettingStrategy(settings, isWin, amount);
              }
              
              // Update profit based on mode
              if (isVirtual) {
                if (!userStats[userId].virtual_balance) {
                  userStats[userId].virtual_balance = VIRTUAL_BALANCE;
                }
                
                if (isWin) {
                  userStats[userId].virtual_balance += amount * 0.96;
                } else {
                  userStats[userId].virtual_balance -= amount;
                }
              } else {
                if (userStats[userId] && amount > 0) {
                  if (isWin) {
                    const profitChange = amount * 0.96;
                    userStats[userId].profit += profitChange;
                  } else {
                    userStats[userId].profit -= amount;
                  }
                }
              }
              
              // Update DREAM strategy state if using DREAM strategy
              if (settings.strategy === "DREAM" && settings.dream_state) {
                const dreamState = settings.dream_state;
                
                const resultNumber = parseInt(settled.number || "0") % 10;
                logging.info(`DREAM strategy: Result number is ${resultNumber}`);
                
                if (dreamState.first_bet) {
                  dreamState.first_bet = false;
                  dreamState.current_pattern = dreamPatterns[resultNumber.toString()] || dreamPatterns["0"];
                  dreamState.current_index = 0;
                  logging.info(`DREAM strategy: First bet complete. Using pattern for result ${resultNumber}: ${dreamState.current_pattern}`);
                } else {
                  if (isWin) {
                    dreamState.current_pattern = dreamPatterns[resultNumber.toString()] || dreamPatterns["0"];
                    dreamState.current_index = 0;
                    logging.info(`DREAM strategy: Win! Changed to pattern for result ${resultNumber}: ${dreamState.current_pattern}`);
                  } else {
                    dreamState.current_index = (dreamState.current_index + 1) % dreamState.current_pattern.length;
                    logging.info(`DREAM strategy: Loss. Moving to index ${dreamState.current_index} in current pattern: ${dreamState.current_pattern}`);
                  }
                }
              }
              
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              
              // Check for profit target or stop loss
              const botStopped = await checkProfitAndStopLoss(userId, bot);
              if (botStopped) {
                delete userPendingBets[userId][period];
                if (Object.keys(userPendingBets[userId]).length === 0) {
                  delete userPendingBets[userId];
                }
                userWaitingForResult[userId] = false;
                continue;
              }
              
              let message;
              if (isWin) {
                const winAmount = amount * 0.96;
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - VIRTUAL_BALANCE)
                  : (userStats[userId]?.profit || 0);
                message = `💚 WIN +${winAmount.toFixed(2)} MMK\n\n🆔 ${period}\n\n🎯 Result: ${number} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}\n\n💸 Balance: ${currentBalance?.toFixed(2) || '0.00'} MMK\n\n📈 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} MMK`;
              } else {
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - VIRTUAL_BALANCE)
                  : (userStats[userId]?.profit || 0);
                const consecutiveLosses = settings.consecutive_losses || 0;
                const slStatus = settings.sl_layer ? `` : '';
                message = `💔 LOSE -${amount} MMK\n\n🆔 ${period}\n\n🎯 Result: ${number} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}${slStatus}\n\n💸 Balance: ${currentBalance?.toFixed(2) || '0.00'} MMK\n\n📈 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} MMK`;
              }
              
              try {
                await bot.telegram.sendMessage(userId, message);
              } catch (error) {
                logging.error(`Failed to send result to ${userId}: ${error.message}`);
              }
              
              delete userPendingBets[userId][period];
              if (Object.keys(userPendingBets[userId]).length === 0) {
                delete userPendingBets[userId];
              }
              userWaitingForResult[userId] = false;
            }
          }
        }
        
        // Process skipped bets (DO NOT count towards SL layer)
        if (userSkippedBets[userId]) {
          for (const [period, betInfo] of Object.entries(userSkippedBets[userId])) {
            const settled = data.find(item => item.issueNumber === period);
            if (settled && settled.number) {
              const [betType, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const isWin = (betType === "B" && bigSmall === "B") || (betType === "S" && bigSmall === "S");
              
              // Store result for AI strategy
              if (settings.strategy === "AI_PREDICTION") {
                if (!userAILast10Results[userId]) {
                  userAILast10Results[userId] = [];
                }
                userAILast10Results[userId].push(bigSmall);
                if (userAILast10Results[userId].length > 10) {
                  userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for AI (skipped bet): ${bigSmall} (now have ${userAILast10Results[userId].length} results)`);
              }
              
              // Store result for Lyzo strategy if using TRX
              if (gameType === "TRX" && settings.strategy === "LYZO") {
                if (!userLast10Results[userId]) {
                  userLast10Results[userId] = [];
                }
                userLast10Results[userId].push(bigSmall);
                if (userLast10Results[userId].length > 10) {
                  userLast10Results[userId] = userLast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for Lyzo (skipped bet): ${bigSmall} (now have ${userLast10Results[userId].length} results)`);
              }
              
              // SL skip win logic
              if (userSLSkipWaitingForWin[userId] && isWin) {
                // Reset SL state and continue with normal betting
                userShouldSkipNext[userId] = false;
                settings.skip_betting = false;
                settings.consecutive_losses = 0;
                delete userSLSkipWaitingForWin[userId];
                
                // Restore original betting strategy state
                const bettingStrategy = settings.betting_strategy || "Martingale";
                if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
                  settings.martin_index = settings.original_martin_index || 0;
                } else if (bettingStrategy === "D'Alembert") {
                  settings.dalembert_units = settings.original_dalembert_units || 1;
                } else if (bettingStrategy === "Custom") {
                  settings.custom_index = settings.original_custom_index || 0;
                }
                
                logging.info(`SL Layer: Skip win achieved! Resetting SL state and continuing with normal betting for user ${userId}`);
              }
              
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              const totalProfit = isVirtual 
                ? (userStats[userId].virtual_balance - VIRTUAL_BALANCE)
                : (userStats[userId]?.profit || 0);
              
              const entryLayer = settings.layer_limit || 1;
              
              // Entry Layer logic for skipped bets
              if (entryLayer === 2) {
                if (!settings.entry_layer_state) {
                  settings.entry_layer_state = { waiting_for_lose: true };
                }
                
                if (isWin) {
                  // Win - reset to wait for 1 lose
                  settings.entry_layer_state.waiting_for_lose = true;
                  const winMessage = 
                    `🟢 WIN! 0 MMK \n` +
                    `🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number} `;
                  
                  try {
                    await bot.telegram.sendMessage(userId, winMessage);
                  } catch (error) {
                    logging.error(`Failed to send virtual win message to ${userId}: ${error.message}`);
                  }
                } else {
                  // Lose - if we were waiting for a lose, now we can bet
                  if (settings.entry_layer_state.waiting_for_lose) {
                    settings.entry_layer_state.waiting_for_lose = false;
                  }
                  
                  const loseMessage = 
                    `🔴 LOSE 0 MMK \n` +
                    `🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number} `;
                  
                  try {
                    await bot.telegram.sendMessage(userId, loseMessage);
                  } catch (error) {
                    logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                  }
                }
              } else if (entryLayer === 3) {
                if (!settings.entry_layer_state) {
                  settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
                }
                
                if (isWin) {
                  // Win - reset to wait for 2 consecutive loses
                  settings.entry_layer_state.waiting_for_loses = true;
                  settings.entry_layer_state.consecutive_loses = 0;
                  
                  const winMessage = 
                    `🟢 WIN! 0 MMK  \n` +
                    `🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number} `;
                  
                  try {
                    await bot.telegram.sendMessage(userId, winMessage);
                  } catch (error) {
                    logging.error(`Failed to send virtual win message to ${userId}: ${error.message}`);
                  }
                } else {
                  // Lose - increment consecutive loses counter
                  settings.entry_layer_state.consecutive_loses++;
                  
                  if (settings.entry_layer_state.consecutive_loses >= 2) {
                    // If we have 2 consecutive loses, we can now bet
                    settings.entry_layer_state.waiting_for_loses = false;
                    
                    const loseMessage = 
                      `🔴 LOSE 0 MMK \n` +
                      `🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number} `;
                    
                    try {
                      await bot.telegram.sendMessage(userId, loseMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                    }
                  } else {
                    const loseMessage = 
                      `🔴 LOSE 0 MMK \n` +
                      `🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number}\n` +
                      `⏳ Waiting for ${2 - settings.entry_layer_state.consecutive_loses} more lose(s)`;
                    
                    try {
                      await bot.telegram.sendMessage(userId, loseMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                    }
                  }
                }
              } else {
                const resultMessage = isWin ? 
                  `🟢 WIN! 0 MMK \n 🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number}` :
                  `🔴 LOSE 0 MMK \n 🆔 ${period} => ${bigSmall === 'B' ? 'BIG' : 'SMALL'}~${number} `;
                
                try {
                  await bot.telegram.sendMessage(userId, resultMessage);
                } catch (error) {
                  logging.error(`Failed to send virtual result to ${userId}: ${error.message}`);
                }
              }
              
              // DO NOT update SL layer for skipped bets
              logging.debug(`Skipped bet result processed - NOT counting towards SL layer: ${isWin ? 'WIN' : 'LOSS'}`);
              
              delete userSkippedBets[userId][period];
              if (Object.keys(userSkippedBets[userId]).length === 0) {
                delete userSkippedBets[userId];
              }
              
              if (userSkipResultWait[userId] === period) {
                delete userSkipResultWait[userId];
              }
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, WIN_LOSE_CHECK_INTERVAL * 1000));
    } catch (error) {
      logging.error(`Win/lose checker error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

// Betting worker with improved error handling and balance checking
async function bettingWorker(userId, ctx, bot) {
  const settings = userSettings[userId] || {};
  let session = userSessions[userId];
  if (!settings || !session) {
    await sendMessageWithRetry(ctx, "Please login first");
    settings.running = false;
    return;
  }
  
  // Initialize user stats if not exists
  if (!userStats[userId]) {
    if (settings.virtual_mode) {
      userStats[userId] = { virtual_balance: VIRTUAL_BALANCE };
    } else {
      userStats[userId] = { start_balance: 0.0, profit: 0.0 };
    }
  }
  
  settings.running = true;
  settings.last_issue = null;
  settings.consecutive_errors = 0;
  settings.consecutive_losses = 0;
  settings.current_layer = 0;
  settings.skip_betting = false;
  
  // Initialize original indices if not set
  if (settings.original_martin_index === undefined) {
    settings.original_martin_index = 0;
  }
  if (settings.original_dalembert_units === undefined) {
    settings.original_dalembert_units = 1;
  }
  if (settings.original_custom_index === undefined) {
    settings.original_custom_index = 0;
  }
  
  userShouldSkipNext[userId] = false;
  delete userSLSkipWaitingForWin[userId];
  
  // Initialize entry layer state
  const entryLayer = settings.layer_limit || 1;
  if (entryLayer === 2) {
    settings.entry_layer_state = { waiting_for_lose: true };
  } else if (entryLayer === 3) {
    settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
  }
  
  // Initialize DREAM strategy state if using DREAM strategy
  if (settings.strategy === "DREAM") {
    settings.dream_state = {
      first_bet: true,
      current_pattern: "",
      current_index: 0
    };
  }
  
  // Initialize AI strategy data
  if (settings.strategy === "AI_PREDICTION") {
    userAILast10Results[userId] = [];
    userAIRoundCount[userId] = 0;
    logging.info(`AI strategy initialized for user ${userId}`);
  }
  
  // Initialize Lyzo strategy data
  if (settings.strategy === "LYZO") {
    userLast10Results[userId] = [];
    userLyzoRoundCount[userId] = 0;
    logging.info(`Lyzo strategy initialized for user ${userId}`);
  }
  
  let currentBalance = null;
  if (settings.virtual_mode) {
    currentBalance = userStats[userId].virtual_balance || VIRTUAL_BALANCE;
  } else {
    let balanceRetrieved = false;
    for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt++) {
      try {
        const balanceResult = await getBalance(session, parseInt(userId));
        if (balanceResult !== null) {
          currentBalance = balanceResult;
          userStats[userId].start_balance = currentBalance;
          balanceRetrieved = true;
          break;
        }
      } catch (error) {
        logging.error(`Balance check attempt ${attempt + 1} failed: ${error.message}`);
      }
      
      if (attempt < MAX_BALANCE_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BALANCE_RETRY_DELAY * 1000));
      }
    }
    
    if (!balanceRetrieved) {
      await sendMessageWithRetry(ctx, "❌ Failed to check balance after multiple attempts. Please check your connection or try again.", makeMainKeyboard(true));
      settings.running = false;
      return;
    }
  }
  
  await sendMessageWithRetry(ctx, `✅ BOT START \nBalance: ${currentBalance} MMK`);
  
  try {
    while (settings.running) {
      if (userWaitingForResult[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (userSkipResultWait[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Update current balance with better error handling
      if (settings.virtual_mode) {
        currentBalance = userStats[userId].virtual_balance || VIRTUAL_BALANCE;
      } else {
        try {
          const balanceResult = await getBalance(session, parseInt(userId));
          if (balanceResult !== null) {
            currentBalance = balanceResult;
          } else {
            logging.warning(`Balance check returned null for user ${userId}, using previous value`);
          }
        } catch (error) {
          logging.error(`Balance check failed: ${error.message}`);
          if (currentBalance === null) {
            currentBalance = userStats[userId].start_balance || 0;
            logging.warning(`Using default balance value: ${currentBalance}`);
          }
        }
      }
      
      // Add null check for currentBalance
      if (currentBalance === null) {
        logging.error(`Current balance is null for user ${userId}, attempting to recover`);
        let recovered = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const balanceResult = await getBalance(session, parseInt(userId));
            if (balanceResult !== null) {
              currentBalance = balanceResult;
              recovered = true;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            logging.error(`Balance recovery attempt ${attempt + 1} failed: ${error.message}`);
          }
        }
        
        if (!recovered) {
          await sendMessageWithRetry(ctx, "❌ Failed to recover balance. Stopping bot to prevent errors.", makeMainKeyboard(true));
          settings.running = false;
          break;
        }
      }
      
      const betSizes = settings.bet_sizes || [100];
      if (!betSizes.length) {
        await sendMessageWithRetry(ctx, "Bet sizes not set. Please set BET SIZE first.");
        settings.running = false;
        break;
      }
      
      const minBetSize = Math.min(...betSizes);
      if (currentBalance < minBetSize) {
        const message = `❌ Insufficient balance!\n` +
                        `Current Balance: ${currentBalance.toFixed(2)} MMK\n` +
                        `Minimum Bet Required: ${minBetSize} MMK\n` +
                        `Please add funds to continue betting.`;
        await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
        settings.running = false;
        break;
      }
      
      // Balance warning check
      const balanceWarningThreshold = minBetSize * 3;
      const now = Date.now();
      const lastWarning = userBalanceWarnings[userId] || 0;
      
      if (currentBalance < balanceWarningThreshold && currentBalance >= minBetSize && (now - lastWarning > 60000)) {
        const warningMessage = `⚠️ Balance Warning!\n` +
                              `Current Balance: ${currentBalance.toFixed(2)} MMK\n` +
                              `Minimum Bet: ${minBetSize} MMK\n` +
                              `Consider adding funds soon to avoid interruption.`;
        await sendMessageWithRetry(ctx, warningMessage);
        userBalanceWarnings[userId] = now;
      }
      
      const gameType = settings.game_type || "WINGO";
      
      // Get current issue
      let issueRes;
      try {
        if (gameType === "WINGO") {
          issueRes = await getNoaverageEmerdListRequest(session);
          if (!issueRes || issueRes.code !== 0 || !issueRes.data || !issueRes.data.list || issueRes.data.list.length === 0) {
            settings.consecutive_errors++;
            if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
              await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
              settings.running = false;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        } else {
          issueRes = await getGameIssueRequest(session, gameType);
          if (!issueRes || issueRes.code !== 0) {
            settings.consecutive_errors++;
            if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
              await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
              settings.running = false;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        }
      } catch (error) {
        logging.error(`Error getting issue: ${error.message}`);
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // Reset consecutive errors on successful request
      settings.consecutive_errors = 0;
      
      // Get current issue number
      let currentIssue;
      if (gameType === "WINGO") {
        const latestIssue = issueRes.data.list[0];
        if (!latestIssue || !latestIssue.issueNumber) {
          settings.consecutive_errors++;
          if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
            await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
            settings.running = false;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        currentIssue = latestIssue.issueNumber;
      } else {
        const data = issueRes.data || {};
        currentIssue = gameType === "TRX" ? data.predraw?.issueNumber : data.issueNumber;
      }
      
      if (!currentIssue || currentIssue === settings.last_issue) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Determine bet choice (B/S)
      let ch;
      if (settings.strategy === "AI_PREDICTION") {
        const prediction = await getAIPrediction(userId, gameType);
        if (prediction) {
          ch = prediction.result;
        } else {
          ch = Math.random() < 0.5 ? 'B' : 'S';
          logging.warning("AI prediction failed, using random prediction");
        }
      } else if (settings.strategy === "LYZO") {
        const prediction = await getLyzoPrediction(userId, gameType);
        if (prediction) {
          ch = prediction.result;
        } else {
          ch = Math.random() < 0.5 ? 'B' : 'S';
          logging.warning("Lyzo prediction failed, using random prediction");
        }
      } else if (settings.strategy === "DREAM") {
        if (!settings.dream_state) {
          settings.dream_state = {
            first_bet: true,
            current_pattern: "",
            current_index: 0
          };
        }
        
        const dreamState = settings.dream_state;
        
        if (dreamState.first_bet) {
          ch = Math.random() < 0.5 ? 'B' : 'S';
          logging.info(`DREAM strategy: First bet is random: ${ch}`);
        } else if (dreamState.current_pattern && dreamState.current_index < dreamState.current_pattern.length) {
          ch = dreamState.current_pattern[dreamState.current_index];
          logging.info(`DREAM strategy: Using pattern ${dreamState.current_pattern} at index ${dreamState.current_index}: ${ch}`);
        } else {
          ch = Math.random() < 0.5 ? 'B' : 'S';
          logging.warning("DREAM strategy pattern invalid, using random prediction");
        }
      } else if (settings.strategy === "DREAM2") {
        const patternIndex = settings.pattern_index || 0;
        ch = DREAM2_PATTERN[patternIndex % DREAM2_PATTERN.length];
        logging.info(`DREAM 2 strategy: Using pattern ${DREAM2_PATTERN} at index ${patternIndex}: ${ch}`);
      } else if (settings.strategy === "BS_ORDER") {
        if (!settings.pattern) {
          settings.pattern = DEFAULT_BS_ORDER;
          settings.pattern_index = 0;
          await sendMessageWithRetry(ctx, `No BS order provided. Using default: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true));
        }
        
        const pattern = settings.pattern;
        const patternIndex = settings.pattern_index || 0;
        ch = pattern[patternIndex % pattern.length];
      } else {
        // Default to AI prediction if no strategy is set
        const prediction = await getAIPrediction(userId, gameType);
        ch = prediction.result;
        logging.info(`Using default AI prediction: ${ch}`);
      }
      
      const selectType = getSelectMap(gameType)[ch];
      
      if (selectType === undefined) {
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // Check if we should skip this bet
      let betMsg;
      let shouldSkip = false;
      let skipReason = "";
      
      // Entry Layer logic for skipping bets
      if (entryLayer === 1) {
        shouldSkip = userShouldSkipNext[userId] || false;
        if (shouldSkip) {
          skipReason = "(SL Layer)";
        }
      } else if (entryLayer === 2) {
        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose) {
          shouldSkip = true;
          skipReason = "(Entry Layer 2)";
        } else {
          shouldSkip = userShouldSkipNext[userId] || false;
          if (shouldSkip) {
            skipReason = "(SL Layer)";
          }
        }
      } else if (entryLayer === 3) {
        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
          shouldSkip = true;
          skipReason = `(Entry Layer 3)`;
        } else {
          shouldSkip = userShouldSkipNext[userId] || false;
          if (shouldSkip) {
            skipReason = "(SL Layer)";
          }
        }
      }
      
      // Add SL skip waiting status to message
      if (userSLSkipWaitingForWin[userId]) {
        skipReason += "-";
      }
      
      if (shouldSkip) {
        betMsg = `🆔 ${currentIssue} ( SKIP )\n🎯 Order: ${ch === 'B' ? 'BIG' : 'SMALL'}\n▫️ Value: 0 MMK ${skipReason}`;
        
        if (!userSkippedBets[userId]) {
          userSkippedBets[userId] = {};
        }
        userSkippedBets[userId][currentIssue] = [ch, settings.virtual_mode];
        
        userSkipResultWait[userId] = currentIssue;
        
        await sendMessageWithRetry(ctx, betMsg);
        
        // Wait for result
        let resultAvailable = false;
        let waitAttempts = 0;
        const maxWaitAttempts = 60;
        
        while (!resultAvailable && waitAttempts < maxWaitAttempts && settings.running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (!userSkippedBets[userId] || !userSkippedBets[userId][currentIssue]) {
            resultAvailable = true;
          }
          
          waitAttempts++;
        }
        
        if (!resultAvailable) {
          logging.warning(`Result not available for skipped bet ${currentIssue} after ${maxWaitAttempts} seconds`);
          if (userSkipResultWait[userId] === currentIssue) {
            delete userSkipResultWait[userId];
          }
        }
      } else {
        // Calculate bet amount using the new function
        let desiredAmount;
        try {
          desiredAmount = calculateBetAmount(settings, currentBalance);
        } catch (error) {
          await sendMessageWithRetry(ctx, 
            `❌ ${error.message}\n` +
            `Please stop bot and set Bet Size again.`,
            makeMainKeyboard(true)
          );
          settings.running = false;
          break;
        }
        
        // Compute actual bet details
        const { unitAmount, betCount, actualAmount } = computeBetDetails(desiredAmount);
        
        // Check if actual amount is valid
        if (actualAmount === 0) {
          await sendMessageWithRetry(ctx, 
            `❌ Invalid bet amount: ${desiredAmount} MMK\n` +
            `Minimum bet amount is ${unitAmount} MMK\n` +
            `Please increase your bet size.`,
            makeMainKeyboard(true)
          );
          settings.running = false;
          break;
        }
        
        // Check if balance is sufficient for next bet
        if (currentBalance < actualAmount) {
          const message = `❌ Insufficient balance for next bet!\n` +
                          `Current Balance: ${currentBalance.toFixed(2)} MMK\n` +
                          `Required Bet Amount: ${actualAmount.toFixed(2)} MMK\n` +
                          `Please add funds to continue betting.`;
          await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
          settings.running = false;
          break;
        }
        
        betMsg = `🆔 ${currentIssue}\n🎯 Order: ${ch === 'B' ? 'BIG' : 'SMALL'}\n▫️ Value: ${actualAmount} MMK`;
        await sendMessageWithRetry(ctx, betMsg);
        
        if (settings.virtual_mode) {
          // Virtual mode - simulate bet without placing
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, true];
          userWaitingForResult[userId] = true;
        } else {
          // Real mode - place actual bet
          const betResp = await placeBetRequest(session, currentIssue, selectType, unitAmount, betCount, gameType, parseInt(userId));
          
          if (betResp.error || betResp.code !== 0) {
            await sendMessageWithRetry(ctx, `Bet error: ${betResp.msg || betResp.error}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, false];
          userWaitingForResult[userId] = true;
        }
      }
      
      settings.last_issue = currentIssue;
      if (settings.pattern || settings.strategy === "DREAM2" || settings.strategy === "BS_ORDER") {
        settings.pattern_index = (settings.pattern_index + 1) % (settings.strategy === "DREAM2" ? DREAM2_PATTERN.length : (settings.pattern ? settings.pattern.length : 10));
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    logging.error(`Betting worker error for user ${userId}: ${error.message}`);
    await sendMessageWithRetry(ctx, `Betting error: ${error.message}. Stopping...`);
    settings.running = false;
  } finally {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    delete userBalanceWarnings[userId];
    delete userSkipResultWait[userId];
    delete userSLSkipWaitingForWin[userId];
    
    // Clean up AI strategy data
    if (settings.strategy === "AI_PREDICTION") {
      delete userAILast10Results[userId];
      delete userAIRoundCount[userId];
    }
    
    // Clean up Lyzo strategy data
    if (settings.strategy === "LYZO") {
      delete userLast10Results[userId];
      delete userLyzoRoundCount[userId];
    }
    
    // Calculate profit before resetting stats
    let totalProfit = 0;
    let balanceText = "";
    
    if (settings.virtual_mode) {
      totalProfit = (userStats[userId]?.virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
      balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || VIRTUAL_BALANCE).toFixed(2)} MMK\n`;
    } else {
      totalProfit = userStats[userId]?.profit || 0;
      try {
        const finalBalance = await getBalance(session, userId);
        balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} MMK\n`;
      } catch (error) {
        logging.error(`Failed to get final balance: ${error.message}`);
        balanceText = "Final Balance: Unknown\n";
      }
    }
    
    // Calculate profit indicator
    let profitIndicator = "";
    if (totalProfit > 0) {
      profitIndicator = "+";
    } else if (totalProfit < 0) {
      profitIndicator = "-";
    } else {
      profitIndicator = "";
    }
    
    // RESET profit tracking and bet sizes when bot stops
    delete userStats[userId];
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    
    // Only send the stopped message if not already sent by user command
    if (!userStopInitiated[userId]) {
      const message = `🛑 BOT STOPPED\n${balanceText}💰 Total Profit: ${profitIndicator}${totalProfit.toFixed(2)} MMK`;
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    }
    
    // Clear the stop initiated flag
    delete userStopInitiated[userId];
  }
}

// Telegram keyboard helpers
function makeMainKeyboard(loggedIn = false) {
  if (!loggedIn) {
    return Markup.keyboard([["🔐 Login"]]).resize().oneTime(false);
  }
  return Markup.keyboard([
    ["⚔️ Start", "🛡️ Stop"],
    ["💣 Bet_Size", "🎮 Virtual/Real Mode"],
    ["🏹 Profit Target", "🔥 Stop Loss Limit"],
    ["🎲 WINGO/TRX", "🧠 Strategy"],
    ["🔄 Entry Layer", "💥 Bet_SL"],
    ["🚀 Anti/Martingale", "🏁 Info"],
    ["🔐 Login"]
  ]).resize().oneTime(false);
}

function makeStrategyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📜 BS-Order", "strategy:BS_ORDER"),
      Markup.button.callback("🤖 AI_PREDICATION", "strategy:AI_PREDICTION")
    ],
    [
      Markup.button.callback("🔮 LYZO", "strategy:LYZO"),
      Markup.button.callback("💭 DREAM", "strategy:DREAM")
    ],
    [
      Markup.button.callback("🌙 DREAM 2", "strategy:DREAM2")
    ]
  ]);
}

function makeBettingStrategyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Anti-Martingale", "betting_strategy:Anti-Martingale")],
    [Markup.button.callback("Martingale", "betting_strategy:Martingale")],
    [Markup.button.callback("D'Alembert", "betting_strategy:D'Alembert")]
  ]);
}

function makeGameTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("WINGO", "game_type:WINGO")],
    [Markup.button.callback("TRX", "game_type:TRX")]
  ]);
}

function makeEntryLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1 - Direct  For BET", "entry_layer:1")],
    [Markup.button.callback("2 - Wait for 1 Lose", "entry_layer:2")],
    [Markup.button.callback("3 - Wait for 2 Loses", "entry_layer:3")]
  ]);
}

function makeSLLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("0 - Disabled", "sl_layer:0")],
    [Markup.button.callback("1", "sl_layer:1"), Markup.button.callback("2", "sl_layer:2"), Markup.button.callback("3", "sl_layer:3")],
    [Markup.button.callback("4", "sl_layer:4"), Markup.button.callback("5", "sl_layer:5"), Markup.button.callback("6", "sl_layer:6")],
    [Markup.button.callback("7", "sl_layer:7"), Markup.button.callback("8", "sl_layer:8"), Markup.button.callback("9", "sl_layer:9")]
  ]);
}

function makeModeSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🖥️ Virtual Mode", "mode:virtual")],
    [Markup.button.callback("💵 Real Mode", "mode:real")]
  ]);
}

async function checkUserAuthorized(ctx) {
  const userId = ctx.from.id;
  if (!userSessions[userId]) {
    await sendMessageWithRetry(ctx, "Please login first", makeMainKeyboard(false));
    return false;
  }
  if (!userSettings[userId]) {
    userSettings[userId] = {
      strategy: "AI_PREDICTION",
      betting_strategy: "Martingale",
      game_type: "WINGO",
      martin_index: 0,
      dalembert_units: 1,
      pattern_index: 0,
      running: false,
      consecutive_losses: 0,
      current_layer: 0,
      skip_betting: false,
      sl_layer: null,
      original_martin_index: 0,
      original_dalembert_units: 1,
      original_custom_index: 0,
      custom_index: 0,
      layer_limit: 1,
      virtual_mode: false
    };
  }
  return true;
}

// Telegram command handlers
async function cmdStartHandler(ctx) {
  const userId = ctx.from.id;
  if (!userSettings[userId]) {
    userSettings[userId] = {
      strategy: "AI_PREDICTION",
      betting_strategy: "Martingale",
      game_type: "WINGO",
      martin_index: 0,
      dalembert_units: 1,
      pattern_index: 0,
      running: false,
      consecutive_losses: 0,
      current_layer: 0,
      skip_betting: false,
      sl_layer: null,
      original_martin_index: 0,
      original_dalembert_units: 1,
      original_custom_index: 0,
      custom_index: 0,
      layer_limit: 1,
      virtual_mode: false
    };
  }
  const loggedIn = !!userSessions[userId];
  await sendMessageWithRetry(ctx, "777BigWin AutoBet Bot မှကြိုဆိုပါတယ်🫶!", makeMainKeyboard(loggedIn));
}

async function cmdAllowHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length || !args[0].match(/^\d+$/)) {
    await sendMessageWithRetry(ctx, "Usage: /allow {777bigwin_id}");
    return;
  }
  const bigwinId = parseInt(args[0]);
  if (allowed777bigwinIds.has(bigwinId)) {
    await sendMessageWithRetry(ctx, `User ${bigwinId} already added`);
  } else {
    allowed777bigwinIds.add(bigwinId);
    saveAllowedUsers();
    await sendMessageWithRetry(ctx, `User ${bigwinId} added`);
  }
}

async function cmdRemoveHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length || !args[0].match(/^\d+$/)) {
    await sendMessageWithRetry(ctx, "Usage: /remove {777bigwin_id}");
    return;
  }
  const bigwinId = parseInt(args[0]);
  if (!allowed777bigwinIds.has(bigwinId)) {
    await sendMessageWithRetry(ctx, `User ${bigwinId} not found`);
  } else {
    allowed777bigwinIds.delete(bigwinId);
    saveAllowedUsers();
    await sendMessageWithRetry(ctx, `User ${bigwinId} removed`);
  }
}

// New /show command handler
async function cmdShowHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  
  const allowedIds = Array.from(allowed777bigwinIds);
  if (allowedIds.length === 0) {
    await sendMessageWithRetry(ctx, "No users have been added yet.");
    return;
  }
  
  let message = "🧔 Add User ID\n\n";
  allowedIds.forEach((id, index) => {
    message += `${index + 1}. ${id}\n`;
  });
  
  message += `\nTotal: ${allowedIds.length} users`;
  await sendMessageWithRetry(ctx, message);
}

async function callbackQueryHandler(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  
  if (!await checkUserAuthorized(ctx)) {
    return;
  }
  
  if (data.startsWith("strategy:")) {
    const strategy = data.split(":")[1];
    userSettings[userId].strategy = strategy;
    
    if (strategy === "BS_ORDER") {
      // Set state for BS pattern input when user selects BS-Order strategy
      userState[userId] = { state: "INPUT_BS_PATTERN" };
      await sendMessageWithRetry(ctx, "Please enter your BS pattern (e.g., BSBSSBBS):");
    } else {
      await sendMessageWithRetry(ctx, `Strategy : ${strategy}`, makeMainKeyboard(true));
    }
    await ctx.deleteMessage();
  } else if (data.startsWith("betting_strategy:")) {
    const bettingStrategy = data.split(":")[1];
    userSettings[userId].betting_strategy = bettingStrategy;
    
    userSettings[userId].martin_index = 0;
    userSettings[userId].dalembert_units = 1;
    userSettings[userId].consecutive_losses = 0;
    userSettings[userId].skip_betting = false;
    userSettings[userId].custom_index = 0;
    
    await sendMessageWithRetry(ctx, `Betting Strategy: ${bettingStrategy}`, makeMainKeyboard(true));
    await ctx.deleteMessage();
  } else if (data.startsWith("game_type:")) {
    const gameType = data.split(":")[1];
    userSettings[userId].game_type = gameType;
    await sendMessageWithRetry(ctx, `Game Type : ${gameType}`, makeMainKeyboard(true));
    await ctx.deleteMessage();
  } else if (data.startsWith("entry_layer:")) {
    const layerValue = parseInt(data.split(":")[1]);
    userSettings[userId].layer_limit = layerValue;
    
    // Initialize entry layer state based on layer value
    if (layerValue === 2) {
      userSettings[userId].entry_layer_state = { waiting_for_lose: true };
    } else if (layerValue === 3) {
      userSettings[userId].entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
    }
    
    let description = "";
    if (layerValue === 1) {
      description = "Bet immediately according to strategy";
    } else if (layerValue === 2) {
      description = "Wait for 1 lose before betting";
    } else if (layerValue === 3) {
      description = "Wait for 2 consecutive loses before betting";
    }
    
    await sendMessageWithRetry(ctx, `Entry Layer : ${layerValue} (${description})`, makeMainKeyboard(true));
    await ctx.deleteMessage();
  } else if (data.startsWith("sl_layer:")) {
    const slValue = parseInt(data.split(":")[1]);
    userSettings[userId].sl_layer = slValue > 0 ? slValue : null;
    userSettings[userId].consecutive_losses = 0;
    userSettings[userId].skip_betting = false;
    
    userSettings[userId].original_martin_index = 0;
    userSettings[userId].original_dalembert_units = 1;
    userSettings[userId].original_custom_index = 0;
    
    let description = "";
    if (slValue === 0) {
      description = "Disabled";
    } else {
      description = `Skip after ${slValue} consecutive losses`;
    }
    
    await sendMessageWithRetry(ctx, `SL Layer : ${slValue} (${description})`, makeMainKeyboard(true));
    await ctx.deleteMessage();
  } else if (data.startsWith("mode:")) {
    const mode = data.split(":")[1];
    const settings = userSettings[userId];
    
    if (mode === "virtual") {
      settings.virtual_mode = true;
      if (!userStats[userId]) {
        userStats[userId] = {};
      }
      if (userStats[userId].virtual_balance === undefined) {
        userStats[userId].virtual_balance = VIRTUAL_BALANCE;
      }
      await sendMessageWithRetry(ctx, `🖥️ Switched to Virtual Mode (${VIRTUAL_BALANCE} MMK)`, makeMainKeyboard(true));
    } else if (mode === "real") {
      settings.virtual_mode = false;
      await sendMessageWithRetry(ctx, "💵 Switched to Real Mode", makeMainKeyboard(true));
    }
    
    await ctx.deleteMessage();
  }
}

async function textMessageHandler(ctx) {
  const userId = ctx.from.id;
  const rawText = ctx.message.text;
  const text = normalizeText(rawText);
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  if (rawText.includes("🔐 Login")) {
    await sendMessageWithRetry(ctx, "အောက်မှာပြထားသည့်အတိုင်း Login ၀င်ပါ:\nLogin\n<phone>\n<password>");
    return;
  }
  
  if (rawText.includes("🏁 Info")) {
    await showUserStats(ctx, userId);
    return;
  }
  
  if (rawText.includes("⚔️ Start")) {
    const settings = userSettings[userId] || {};
    
    // Check if bet sizes are set
    if (!settings.bet_sizes) {
      await sendMessageWithRetry(ctx, "PLEASE BET SIZE !", makeMainKeyboard(true));
      return;
    }
    
    if (settings.strategy === "BS_ORDER" && !settings.pattern) {
      settings.pattern = DEFAULT_BS_ORDER;
      settings.pattern_index = 0;
      await sendMessageWithRetry(ctx, `No BS order provided. Using default: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true));
    }
    
    if (settings.betting_strategy === "D'Alembert" && settings.bet_sizes.length > 1) {
      await sendMessageWithRetry(ctx, 
        "❌ D'Alembert strategy requires only ONE bet size.\n" +
        "Please set Bet Size again with only one number.",
        makeMainKeyboard(true)
      );
      return;
    }
    
    if (settings.running) {
      await sendMessageWithRetry(ctx, "Bot Is Running!", makeMainKeyboard(true));
      return;
    }
    
    settings.running = true;
    settings.consecutive_errors = 0;
    
    // Initialize entry layer state based on layer limit
    const entryLayer = settings.layer_limit || 1;
    if (entryLayer === 2) {
      settings.entry_layer_state = { waiting_for_lose: true };
    } else if (entryLayer === 3) {
      settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
    }
    
    // Initialize DREAM strategy state if using DREAM strategy
    if (settings.strategy === "DREAM") {
      settings.dream_state = {
        first_bet: true,
        current_pattern: "",
        current_index: 0
      };
    }
    
    // Initialize AI strategy data
    if (settings.strategy === "AI_PREDICTION") {
      userAILast10Results[userId] = [];
      userAIRoundCount[userId] = 0;
      logging.info(`AI strategy initialized for user ${userId}`);
    }
    
    // Initialize Lyzo strategy data
    if (settings.strategy === "LYZO") {
      userLast10Results[userId] = [];
      userLyzoRoundCount[userId] = 0;
      logging.info(`Lyzo strategy initialized for user ${userId}`);
    }
    
    delete userSkippedBets[userId];
    userShouldSkipNext[userId] = false;
    delete userSLSkipWaitingForWin[userId];
    
    userWaitingForResult[userId] = false;
    bettingWorker(userId, ctx, ctx.telegram);
    return;
  }
  
  if (rawText.includes("🛡️ Stop")) {
    const settings = userSettings[userId] || {};
    if (!settings.running) {
      await sendMessageWithRetry(ctx, "Bot Is Not Running!", makeMainKeyboard(true));
      return;
    }
    
    userStopInitiated[userId] = true;
    
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    delete userSLSkipWaitingForWin[userId];
    
    // Clean up strategy data
    if (settings.strategy === "AI_PREDICTION") {
      delete userAILast10Results[userId];
      delete userAIRoundCount[userId];
    }
    
    if (settings.strategy === "LYZO") {
      delete userLast10Results[userId];
      delete userLyzoRoundCount[userId];
    }
    
    // Calculate profit before reset
    let totalProfit = 0;
    let balanceText = "";
    
    if (settings.virtual_mode) {
      totalProfit = (userStats[userId]?.virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
      balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || VIRTUAL_BALANCE).toFixed(2)} MMK\n`;
    } else {
      totalProfit = userStats[userId]?.profit || 0;
      try {
        const session = userSessions[userId];
        const finalBalance = await getBalance(session, userId);
        balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} MMK\n`;
      } catch (error) {
        logging.error(`Failed to get final balance: ${error.message}`);
        balanceText = "Final Balance: Unknown\n";
      }
    }
    
    // Calculate profit indicator
    let profitIndicator = "";
    if (totalProfit > 0) {
      profitIndicator = "+";
    } else if (totalProfit < 0) {
      profitIndicator = "-";
    } else {
      profitIndicator = "";
    }
    
    // RESET profit tracking and bet sizes when bot stops
    delete userStats[userId];
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    
    const message = `🛑 BOT STOPPED\n${balanceText}💰 Total Profit: ${profitIndicator}${totalProfit.toFixed(2)} MMK`;
    await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    return;
  }
  
  if (rawText.includes("💣 Bet_Size")) {
    userState[userId] = { state: "INPUT_BET_SIZES" };
    await sendMessageWithRetry(ctx, "Enter Bet Size :\n100\n200\n500", makeMainKeyboard(true));
    return;
  }
  
  if (rawText.includes("🎮 Virtual/Real Mode")) {
    await sendMessageWithRetry(ctx, "Select Mode:", makeModeSelectionKeyboard());
    return;
  }
  
  if (rawText.includes("🏹 Profit Target")) {
    userState[userId] = { state: "INPUT_PROFIT_TARGET" };
    await sendMessageWithRetry(ctx, "Enter Profit Target : \n\n100000", makeMainKeyboard(true));
    return;
  }
  
  if (rawText.includes("🔥 Stop Loss Limit")) {
    userState[userId] = { state: "INPUT_STOP_LIMIT" };
    await sendMessageWithRetry(ctx, "Enter Stop Loss Limit : \n\n100000", makeMainKeyboard(true));
    return;
  }
  
  if (rawText.includes("🎲 WINGO/TRX")) {
    await sendMessageWithRetry(ctx, "Select Game Type:", makeGameTypeKeyboard());
    return;
  }
  
  if (rawText.includes("🧠 Strategy")) {
    await sendMessageWithRetry(ctx, "Choose Strategy:", makeStrategyKeyboard());
    return;
  }
  
  if (rawText.includes("🔄 Entry Layer")) {
    await sendMessageWithRetry(ctx, "Select Entry Layer:", makeEntryLayerKeyboard());
    return;
  }
  
  if (rawText.includes("💥 Bet_SL")) {
    await sendMessageWithRetry(ctx, "Select SL Layer:", makeSLLayerKeyboard());
    return;
  }
  
  if (rawText.includes("🚀 Anti/Martingale")) {
    await sendMessageWithRetry(ctx, "Choose Betting Strategy", makeBettingStrategyKeyboard());
    return;
  }
  
  const command = text.toUpperCase()
    .replace(/_/g, '')
    .replace(/ /g, '')
    .replace(/\//g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/⚔️/g, 'Start')
    .replace(/🛡️/g, 'Stop')
    .replace(/💣/g, 'Bet_Size')
    .replace(/🎮/g, 'Virtual/Real Mode')
    .replace(/🏹/g, 'Profit Target')
    .replace(/🔥/g, 'Stop Loss Limit')
    .replace(/🎲/g, 'WINGO/TRX')
    .replace(/🧠/g, 'Strategy')
    .replace(/🔄/g, 'Entry Layer')
    .replace(/💥/g, 'Bet_SL')
    .replace(/🚀/g, 'Anti/Martingale')
    .replace(/🏁/g, 'info')
    .replace(/ℹ️/g, 'INFO')
    .replace(/🖥️/g, 'PC')
    .replace(/🎯/g, 'TARGET')
    .replace(/🛑/g, 'STOP_SIGN')
    .replace(/⛔/g, 'NO_ENTRY')
    .replace(/🔐/g, 'Login')
    .replace(/💰/g, 'MONEY')
    .replace(/📝/g, 'NOTE')
    .replace(/▶️/g, 'PLAY')
    .replace(/⏹️/g, 'STOP_BUTTON');
    
  if (command === "LOGIN" || (lines.length > 0 && lines[0].toLowerCase() === "login")) {
    if (lines.length >= 3 && lines[0].toLowerCase() === "login") {
      const username = lines[1];
      const password = lines[2];
      await sendMessageWithRetry(ctx, "Checking Login...");
      const { response: res, session } = await loginRequest(username, password);
      if (session) {
        const userInfo = await getUserInfo(session, userId);
        if (userInfo && userInfo.user_id) {
          const gameUserId = userInfo.user_id;
          if (!allowed777bigwinIds.has(gameUserId)) {
            await sendMessageWithRetry(ctx, "ခွင့်ပြုချက်မရှိသေးပါ။အသုံးပြုသူ၏ ID ကို ခွင့်ပြုရန် စီမံခန့်ခွဲသူကို ဆက်သွယ်ပါ။.", makeMainKeyboard(false));
            return;
          }
          userSessions[userId] = session;
          userGameInfo[userId] = userInfo;
          userTemp[userId] = { password };
          const balance = await getBalance(session, userId);
          
          if (!userSettings[userId]) {
            userSettings[userId] = {
              strategy: "AI_PREDICTION",
              betting_strategy: "Martingale",
              game_type: "WINGO",
              martin_index: 0,
              dalembert_units: 1,
              pattern_index: 0,
              running: false,
              consecutive_losses: 0,
              current_layer: 0,
              skip_betting: false,
              sl_layer: null,
              original_martin_index: 0,
              original_dalembert_units: 1,
              original_custom_index: 0,
              custom_index: 0,
              layer_limit: 1,
              virtual_mode: false
            };
          }
          
          if (!userStats[userId]) {
            userStats[userId] = { start_balance: parseFloat(balance || 0), profit: 0.0 };
          }
          
          const balanceDisplay = balance !== null ? balance : 0.0;
          await sendMessageWithRetry(ctx, `✅ Login အောင်မြင်သည် ,\n ID: ${userInfo.user_id},\n Balance: ${balanceDisplay} MMK`, makeMainKeyboard(true));
         
          const settings = userSettings[userId];
          if (settings.bet_sizes && settings.pattern) {
            await showUserStats(ctx, userId);
          }
        } else {
          await sendMessageWithRetry(ctx, "Login failed: Could not get user info", makeMainKeyboard(false));
        }
      } else {
        const msg = res.msg || "Login မအောင်မြင်ပါ";
        await sendMessageWithRetry(ctx, `Login Error: ${msg}`, makeMainKeyboard(false));
      }
      delete userState[userId];
      delete userTemp[userId];
      return;
    }
    await sendMessageWithRetry(ctx, "အောက်မှာပြထားသည့်အတိုင်း Login ၀င်ပါ:\nLogin\n<phone>\n<password>");
    return;
  }
  
  if (!await checkUserAuthorized(ctx) && command !== "LOGIN") {
    return;
  }
  
  try {
    const currentState = userState[userId]?.state;
    if (currentState === "INPUT_BET_SIZES") {
      // Accept multiple lines of numbers directly without header
      const betSizes = lines.filter(s => s.match(/^\d+$/)).map(Number);
      if (betSizes.length === 0) {
        throw new Error("No valid numbers");
      }
      
      const settings = userSettings[userId];
      if (settings.betting_strategy === "D'Alembert" && betSizes.length > 1) {
        await sendMessageWithRetry(ctx, 
          "❌ D'Alembert strategy requires only ONE bet size.\n" +
          "Please enter only one number for unit size.\n" +
          "Example:\n100",
          makeMainKeyboard(true)
        );
        return;
      }
      
      userSettings[userId].bet_sizes = betSizes;
      userSettings[userId].dalembert_units = 1;
      userSettings[userId].martin_index = 0;
      userSettings[userId].custom_index = 0;
      
      let message = `BET SIZE: ${betSizes.join(',')} MMK`;
      if (settings.betting_strategy === "D'Alembert") {
        message += `\n📝 D'Alembert Unit Size: ${betSizes[0]} MMK`;
      }
      
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
      delete userState[userId];
    } else if (currentState === "INPUT_BS_PATTERN") {
      // Handle BS pattern input for BS-Order strategy
      const pattern = text.toUpperCase();
      if (pattern && pattern.split('').every(c => c === 'B' || c === 'S')) {
        userSettings[userId].pattern = pattern;
        userSettings[userId].pattern_index = 0;
        await sendMessageWithRetry(ctx, `BS Pattern: ${pattern}`, makeMainKeyboard(true));
        delete userState[userId];
      } else {
        await sendMessageWithRetry(ctx, "Invalid pattern. Please use only B and S. Example: BSBSSB", makeMainKeyboard(true));
      }
    } else if (currentState === "INPUT_PROFIT_TARGET") {
      const target = parseFloat(lines.length >= 2 ? lines[1] : text);
      if (isNaN(target) || target <= 0) {
        throw new Error("Invalid profit target");
      }
      userSettings[userId].target_profit = target;
      await sendMessageWithRetry(ctx, `PROFIT TARGET : ${target} MMK`, makeMainKeyboard(true));
      delete userState[userId];
    } else if (currentState === "INPUT_STOP_LIMIT") {
      const stopLoss = parseFloat(lines.length >= 2 ? lines[1] : text);
      if (isNaN(stopLoss) || stopLoss <= 0) {
        throw new Error("Invalid stop loss");
      }
      userSettings[userId].stop_loss = stopLoss;
      await sendMessageWithRetry(ctx, `STOP LOSS LIMIT : ${stopLoss} MMK`, makeMainKeyboard(true));
      delete userState[userId];
    }
  } catch (error) {
    await sendMessageWithRetry(ctx, `Error: ${error.message}`, makeMainKeyboard(true));
  }
}

async function showUserStats(ctx, userId) {
  const session = userSessions[userId];
  const userInfo = userGameInfo[userId];
  if (!userInfo) {
    await sendMessageWithRetry(ctx, "Failed to get info", makeMainKeyboard(true));
    return;
  }
  
  const settings = userSettings[userId] || {};
  const betSizes = settings.bet_sizes || [];
  const strategy = settings.strategy || "AI_PREDICTION";
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const gameType = settings.game_type || "WINGO";
  const virtualMode = settings.virtual_mode || false;
  const profitTarget = settings.target_profit;
  const stopLoss = settings.stop_loss;
  const slLayer = settings.sl_layer;
  const layerLimit = settings.layer_limit || 1;
  
  let balance, totalProfit, betOrder;
  
  if (virtualMode) {
    balance = userStats[userId]?.virtual_balance || VIRTUAL_BALANCE;
    totalProfit = balance - VIRTUAL_BALANCE;
  } else {
    balance = await getBalance(session, userId);
    totalProfit = userStats[userId]?.profit || 0;
  }
  
  // Calculate profit indicator
  let profitIndicator = "";
  if (totalProfit > 0) {
    profitIndicator = "+";
  } else if (totalProfit < 0) {
    profitIndicator = "-";
  } else {
    profitIndicator = "";
  }
  
  if (strategy === "DREAM" && settings.dream_state) {
    const dreamState = settings.dream_state;
    if (dreamState.first_bet) {
      betOrder = "DREAM: First bet (random)";
    } else {
      betOrder = `DREAM Pattern: ${dreamState.current_pattern}\nNext bet: ${dreamState.current_pattern[dreamState.current_index]} (index ${dreamState.current_index})`;
    }
  } else if (strategy === "AI_PREDICTION") {
    const roundCount = userAIRoundCount[userId] || 0;
    const resultCount = userAILast10Results[userId]?.length || 0;
    
    if (roundCount <= 10) {
      betOrder = `AI: Round ${roundCount}/10 (Random)`;
    } else if (resultCount < 10) {
      betOrder = `AI: Collecting results (${resultCount}/10)`;
    } else {
      betOrder = `AI: Using pattern analysis`;
    }
  } else if (strategy === "LYZO") {
    const roundCount = userLyzoRoundCount[userId] || 0;
    const resultCount = userLast10Results[userId]?.length || 0;
    
    if (roundCount <= 10) {
      betOrder = `LYZO: Round ${roundCount}/10 (Random)`;
    } else if (resultCount < 10) {
      betOrder = `LYZO: Collecting results (${resultCount}/10)`;
    } else {
      betOrder = `LYZO: Using pattern matching`;
    }
  } else if (strategy === "DREAM2") {
    const patternIndex = settings.pattern_index || 0;
    betOrder = `DREAM 2: ${DREAM2_PATTERN}\nNext bet: ${DREAM2_PATTERN[patternIndex]} (index ${patternIndex})`;
  } else if (strategy === "BS_ORDER") {
    betOrder = settings.pattern || "BS-Order";
  } else {
    betOrder = "AI Prediction (Default)";
  }
  
  // Show current betting state
  let bettingState = "";
  if (bettingStrategy === "Martingale") {
    const currentIndex = settings.martin_index || 0;
    bettingState = `Current Index: ${currentIndex}/${betSizes.length - 1}`;
  } else if (bettingStrategy === "Anti-Martingale") {
    const currentIndex = settings.martin_index || 0;
    bettingState = `Current Index: ${currentIndex}/${betSizes.length - 1}`;
  } else if (bettingStrategy === "D'Alembert") {
    const currentUnits = settings.dalembert_units || 1;
    bettingState = `Current Units: ${currentUnits}`;
  } else if (bettingStrategy === "Custom") {
    const currentIndex = settings.custom_index || 0;
    bettingState = `Current Index: ${currentIndex}/${betSizes.length - 1}`;
  }
  
  // Update entry layer description
  let entryLayerDesc = "";
  if (layerLimit === 1) {
    entryLayerDesc = "Bet immediately according to strategy";
  } else if (layerLimit === 2) {
    entryLayerDesc = "Wait for 1 lose before betting";
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose) {
      entryLayerDesc += " (Currently waiting for lose)";
    }
  } else if (layerLimit === 3) {
    entryLayerDesc = "Wait for 2 consecutive loses before betting";
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
      entryLayerDesc += ` (Currently waiting for ${settings.entry_layer_state.consecutive_loses || 0}/2 loses)`;
    }
  }
  
  // Add SL skip status
  let slStatus = "";
  if (userSLSkipWaitingForWin[userId]) {
    slStatus = `\n🔴 SL Status: Waiting for Skip Win`;
  } else if (settings.consecutive_losses > 0) {
    slStatus = `\n🔴 Consecutive Losses: ${settings.consecutive_losses}/${slLayer || 0}`;
  }
  
  const modeText = virtualMode ? "🖥️ Virtual Mode" : "💵 Real Mode";
  
  const infoText = 
  `🤖⚡️ 777BIG WIN  BOT PANEL ⚡️🤖\n\n` +
  `🧬 USER ID : ${userInfo.user_id || 'N/A'}\n\n` +
  `🎮 GAME TYPE : ${gameType}\n\n` +
  `💠 BALANCE : ${balance !== null ? balance.toFixed(2) : 'N/A'} MMK\n\n` +
  `🧠 STRATEGY : ${strategy}\n\n` +
  `🚀 BETTING MODE : ${bettingStrategy}\n\n` +
  `💎 BET SIZES : ${betSizes.join(', ') || 'Not Set'}\n\n` +
  `🔢 BET ORDER : ${betOrder}\n\n` +
  `📈 PROFIT TARGET : ${profitTarget !== undefined ? profitTarget + ' MMK' : '0 MMK'}\n\n` +
  `🛡️ STOP LOSS : ${stopLoss !== undefined ? stopLoss + ' MMK' : '0 MMK'}\n\n` +
  `🌀 SL LAYER : ( ${slLayer ? slLayer + ')' : 'Not Set'}\n\n` +
  `💫 ENTRY LAYER : ( ${layerLimit} ) Layer\n\n` +
  `🔰 BALANCE TYPE : ${modeText}\n\n` +
  `⚙️ BOT STATUS : ${settings.running ? '🟢 ONLINE' : '🔴 OFFLINE'}${slStatus}\n\n` +
  `🌌 ᴘᴏᴡᴇʀᴇᴅ ʙʏ DREAM TEAM 𝗦𝗬𝗦𝗧𝗘𝗠 ⚡️`;
  
  await sendMessageWithRetry(ctx, infoText, makeMainKeyboard(true));
}

// Main application
function main() {
  loadAllowedUsers();
  loadPatterns();
  loadDreamPatterns();
  const bot = new Telegraf(BOT_TOKEN);
  
  bot.start(cmdStartHandler);
  bot.command('allow', cmdAllowHandler);
  bot.command('remove', cmdRemoveHandler);
  bot.command('show', cmdShowHandler); // Added new command handler
  bot.on('callback_query', callbackQueryHandler);
  bot.on('text', textMessageHandler);
  
  winLoseChecker(bot).catch(error => {
    logging.error(`Win/lose checker failed: ${error.message}`);
  });
  
  bot.launch().then(() => {
    logging.info('Bot started successfully');
  }).catch(error => {
    logging.error(`Bot failed to start: ${error.message}`);
  });
  
  process.on('uncaughtException', (error) => {
    logging.error(`Uncaught Exception: ${error.message}`);
    logging.error(error.stack);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logging.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  });
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

if (require.main === module) {
  main();
}