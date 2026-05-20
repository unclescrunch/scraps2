// ============================================================
// SCRAPS — Game Engine
// Deck, hand evaluation, signal validation, AI, turn logic
// ============================================================

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
export const RANK_VALUES = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,
  'J':11,'Q':12,'K':13,'A':14
};

// ── Deck ─────────────────────────────────────────────────────

export function createDeck() {
  const deck = [];
  let id = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: id++, rank, suit, value: RANK_VALUES[rank] });
      }
    }
  }
  return deck;
}

export function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function dealCards(deck, count) {
  return { dealt: deck.slice(0, count), remaining: deck.slice(count) };
}

// ── Trade-in value ────────────────────────────────────────────

export function tradeInValue(card) {
  if (card.value >= 2 && card.value <= 9) return 1;
  if (card.value >= 10 && card.value <= 13) return 2;
  if (card.value === 14) return 3; // Ace
  return 0;
}

// ── Hand evaluation ───────────────────────────────────────────

export function evaluateBestHand(cards, allowFlush = true) {
  if (!cards || cards.length === 0) return null;
  const combos = getCombinations(cards, Math.min(cards.length, 5));
  let best = null;
  for (const combo of combos) {
    const result = evaluateHand(combo, allowFlush);
    if (!best || result.rank > best.rank ||
      (result.rank === best.rank && compareKickers(result.tiebreakers, best.tiebreakers) > 0)) {
      best = result;
    }
  }
  return best;
}

// ── Extract only the "active" cards from a hand result ───────
export function getActiveHandCards(handResult) {
  if(!handResult || !handResult.cards) return [];
  const cards = handResult.cards;
  const rank = handResult.rank;
  if(rank === 0) return [cards[0]]; // High Card: just best card
  const rankCounts = {};
  for(const c of cards) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  if(rank === 1) { // Pair
    const pr = Object.keys(rankCounts).find(r => rankCounts[r] >= 2);
    return cards.filter(c => c.rank === pr).slice(0, 2);
  }
  if(rank === 2) { // Two Pair
    const prs = Object.keys(rankCounts).filter(r => rankCounts[r] >= 2);
    return cards.filter(c => prs.includes(c.rank)).slice(0, 4);
  }
  if(rank === 3) { // Trips
    const tr = Object.keys(rankCounts).find(r => rankCounts[r] >= 3);
    return cards.filter(c => c.rank === tr).slice(0, 3);
  }
  if(rank === 7) { // Quads
    const qr = Object.keys(rankCounts).find(r => rankCounts[r] >= 4);
    return cards.filter(c => c.rank === qr).slice(0, 4);
  }
  // Full House (6), Straight (4), Flush (5), Straight Flush (8): all 5
  return cards.slice(0, 5);
}

function evaluateHand(cards, allowFlush = true) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const ranks = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);
  const rankCounts = {};
  for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const uniqueRanks = Object.keys(rankCounts).map(Number).sort((a, b) => b - a);
  const isFlush = allowFlush && cards.length === 5 && suits.every(s => s === suits[0]);
  const isStraight = cards.length === 5 && checkStraight(ranks);
  const tiebreakers = ranks;
  if (isFlush && isStraight) return { rank: 8, name: 'Straight Flush', cards: sorted, tiebreakers };
  if (counts[0] === 4) {
    const quad = uniqueRanks.find(r => rankCounts[r] === 4);
    const kicker = uniqueRanks.find(r => rankCounts[r] !== 4);
    return { rank: 7, name: 'Four of a Kind', cards: sorted, tiebreakers: [quad, kicker || 0] };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    const three = uniqueRanks.find(r => rankCounts[r] === 3);
    const two = uniqueRanks.find(r => rankCounts[r] === 2);
    return { rank: 6, name: 'Full House', cards: sorted, tiebreakers: [three, two] };
  }
  if (isFlush) return { rank: 5, name: 'Flush', cards: sorted, tiebreakers };
  if (isStraight) return { rank: 4, name: 'Straight', cards: sorted, tiebreakers: [Math.max(...ranks)] };
  if (counts[0] === 3) {
    const three = uniqueRanks.find(r => rankCounts[r] === 3);
    const kickers = uniqueRanks.filter(r => rankCounts[r] !== 3);
    return { rank: 3, name: 'Three of a Kind', cards: sorted, tiebreakers: [three, ...kickers] };
  }
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = uniqueRanks.filter(r => rankCounts[r] === 2).sort((a, b) => b - a);
    const kicker = uniqueRanks.find(r => rankCounts[r] === 1);
    return { rank: 2, name: 'Two Pair', cards: sorted, tiebreakers: [...pairs, kicker || 0] };
  }
  if (counts[0] === 2) {
    const pair = uniqueRanks.find(r => rankCounts[r] === 2);
    const kickers = uniqueRanks.filter(r => rankCounts[r] !== 2);
    return { rank: 1, name: 'Pair', cards: sorted, tiebreakers: [pair, ...kickers] };
  }
  return { rank: 0, name: 'High Card', cards: sorted, tiebreakers: ranks };
}

function checkStraight(ranks) {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  if (sorted.length < 5) return false;
  if (sorted.join(',') === '2,3,4,5,14') return true;
  for (let i = 0; i <= sorted.length - 5; i++) {
    const slice = sorted.slice(i, i + 5);
    if (slice[4] - slice[0] === 4) return true;
  }
  return false;
}

function compareKickers(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getCombinations(arr, k) {
  if (k === arr.length) return [arr];
  if (k > arr.length) return [];
  const result = [];
  function pick(start, current) {
    if (current.length === k) { result.push([...current]); return; }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      pick(i + 1, current);
      current.pop();
    }
  }
  pick(0, []);
  return result;
}

// ── Signal validation ─────────────────────────────────────────

export function getValidSignals(hand) {
  const valid = new Set();
  if (hand.length >= 1) valid.add(1);
  const rankCounts = {};
  for (const c of hand) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const maxCount = counts[0] || 0;
  const pairCount = counts.filter(c => c >= 2).length;
  if (maxCount >= 2) valid.add(2);
  if (maxCount >= 3) valid.add(3);
  if (pairCount >= 2 || maxCount >= 4) valid.add(4);
  if (hand.length >= 5) {
    const best = evaluateBestHand(hand, true);
    if (best && best.rank >= 4) valid.add(5);
    if (best && best.rank === 6) valid.add(5);
  }
  return [...valid].sort((a, b) => a - b);
}

export function getBestCardsForSignal(hand, signal) {
  const rankCounts = {};
  for (const c of hand) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  if (signal === 1) {
    return [hand.reduce((best, c) => c.value > best.value ? c : best, hand[0])];
  }
  if (signal === 2) {
    const pairRanks = Object.keys(rankCounts).filter(r => rankCounts[r] >= 2)
      .sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (pairRanks.length === 0) return null;
    return hand.filter(c => c.rank === pairRanks[0]).slice(0, 2);
  }
  if (signal === 3) {
    const tripleRanks = Object.keys(rankCounts).filter(r => rankCounts[r] >= 3)
      .sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (tripleRanks.length === 0) return null;
    return hand.filter(c => c.rank === tripleRanks[0]).slice(0, 3);
  }
  if (signal === 4) {
    const quadRanks = Object.keys(rankCounts).filter(r => rankCounts[r] >= 4);
    if (quadRanks.length > 0) return hand.filter(c => c.rank === quadRanks[0]).slice(0, 4);
    const pairRanks = Object.keys(rankCounts).filter(r => rankCounts[r] >= 2)
      .sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (pairRanks.length >= 2) {
      return [
        ...hand.filter(c => c.rank === pairRanks[0]).slice(0, 2),
        ...hand.filter(c => c.rank === pairRanks[1]).slice(0, 2),
      ];
    }
    return null;
  }
  if (signal === 5) {
    if (hand.length < 5) return null;
    const best = evaluateBestHand(hand, true);
    if (best && best.rank >= 4) return best.cards.slice(0, 5);
    return null;
  }
  return null;
}

// ── Hand comparison ───────────────────────────────────────────

export function compareHands(handA, handB) {
  if (handA.rank !== handB.rank) return handA.rank > handB.rank ? 1 : -1;
  return compareKickers(handA.tiebreakers, handB.tiebreakers);
}

// ══════════════════════════════════════════════════════════════
// AI ENGINE — Strategic decision making
// ══════════════════════════════════════════════════════════════

// ── Scraps evaluation ─────────────────────────────────────────
// Returns a numeric strength score for a scraps pile.
// No flushes allowed in scraps — always evaluates with allowFlush=false.
function scrapsStrength(scraps) {
  if (!scraps || scraps.length === 0) return -1;
  const best = evaluateBestHand(scraps, false);
  return best ? best.rank : -1;
}

// ── Structural importance of a card in a scraps pile ──────────
// Returns the rank drop if this card were removed (0 = not load-bearing).
function cardImportance(card, scraps) {
  if (scraps.length < 2) return 0;
  const before = scrapsStrength(scraps);
  const without = scraps.filter(c => c.id !== card.id);
  if (without.length === 0) return 0;
  const after = scrapsStrength(without);
  return Math.max(0, before - after);
}

// ── Choose which 2 opponent scraps cards to remove with Ace ──
// Priority: structural damage first, then value.
function chooseAceTargets(opponentScraps) {
  if (opponentScraps.length < 2) return opponentScraps.slice(0, 2);

  // Score each card by how much removing it damages the hand
  const scored = opponentScraps.map(card => ({
    card,
    importance: cardImportance(card, opponentScraps),
    value: card.value,
  }));

  // Sort: highest importance first, then highest value as tiebreaker
  scored.sort((a, b) =>
    b.importance !== a.importance
      ? b.importance - a.importance
      : b.value - a.value
  );

  // Special case: if removing the single most important card leaves a straight,
  // prefer removing a connector (middle of a run) over endpoints.
  // Detect runs in opponent scraps:
  const vals = opponentScraps.map(c => c.value).sort((a, b) => a - b);
  const runCards = findRunConnectors(opponentScraps);
  if (runCards.length >= 2) {
    // Prefer middle connectors
    const byConnector = runCards.sort((a, b) => a.value - b.value);
    const mid = byConnector[Math.floor(byConnector.length / 2)];
    const second = scored.find(s => s.card.id !== mid.id);
    if (second) return [mid, second.card];
  }

  return [scored[0].card, scored[1].card];
}

// Find cards that are in the middle of a run (most structurally critical)
function findRunConnectors(scraps) {
  const vals = [...new Set(scraps.map(c => c.value))].sort((a, b) => a - b);
  const connectors = [];
  for (const v of vals) {
    // A connector is adjacent to two other values
    if (vals.includes(v - 1) && vals.includes(v + 1)) {
      const card = scraps.find(c => c.value === v);
      if (card) connectors.push(card);
    }
  }
  return connectors;
}

// ── Trade selection: choose the best card(s) to trade ─────────
// Returns array of cards to trade, targeting Scraps improvement.
function chooseTrade(aiHand, aiScraps, opponentScraps, maxTrade = 1) {
  const HAND_LIMIT = 7;
  const SCRAPS_LIMIT = 7;

  // Build rank counts for current hand
  const rankCounts = {};
  for (const c of aiHand) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;

  // Score each non-Ace card by how much trading it improves scraps
  // (Aces are handled separately — they're weapons, not trades)
  const candidates = aiHand.filter(c => {
    if (c.rank === 'A') return false;
    const gain = tradeInValue(c);
    const netHand = (aiHand.length - 1) + gain;
    const newScraps = aiScraps.length + 1;
    return netHand <= HAND_LIMIT && newScraps <= SCRAPS_LIMIT;
  });

  if (candidates.length === 0) {
    // Forced — trade an Ace if nothing else tradeable
    const ace = aiHand.find(c => c.rank === 'A');
    if (ace) {
      const gain = tradeInValue(ace);
      const netHand = (aiHand.length - 1) + gain;
      const newScraps = aiScraps.length + 1;
      if (netHand <= HAND_LIMIT && newScraps <= SCRAPS_LIMIT) return [ace];
    }
    return aiHand.length > 0 ? [aiHand[0]] : [];
  }

  // Score each candidate: does adding it to scraps improve the scraps hand?
  const scored = candidates.map(card => {
    const hypotheticalScraps = [...aiScraps, card];
    const before = scrapsStrength(aiScraps);
    const after = scrapsStrength(hypotheticalScraps);
    const scrapsGain = after - before;
    // Secondary score: is this card isolated in hand (no pair partner)?
    const isIsolated = rankCounts[card.rank] === 1;
    // Tertiary: draw count (higher = more replacement cards)
    const drawBonus = tradeInValue(card) * 0.1;
    return { card, score: scrapsGain * 10 + (isIsolated ? 1 : 0) + drawBonus };
  });

  scored.sort((a, b) => b.score - a.score);
  return [scored[0].card];
}

// ── Decide whether to play Ace or trade ─────────────────────
function shouldPlayAce(aiScraps, opponentScraps, aiScore, opponentScore, phase) {
  if (opponentScraps.length < 2) return false;

  const oppStrength = scrapsStrength(opponentScraps);
  const myStrength = scrapsStrength(aiScraps);
  const scoreDiff = aiScore - opponentScore; // positive = AI winning

  // Compute how much damage the Ace does
  const targets = chooseAceTargets(opponentScraps);
  const afterRemoval = opponentScraps.filter(c => !targets.find(t => t.id === c.id));
  const strengthAfter = afterRemoval.length > 0 ? scrapsStrength(afterRemoval) : -1;
  const damage = oppStrength - strengthAfter; // rank drop

  // Don't play Ace if no structural damage (opponent scraps is weak already)
  if (oppStrength <= 1 && damage < 2) return false;

  // Urgency: endgame (both near win score)
  const endgame = aiScore >= 9 || opponentScore >= 9;

  // Play Ace if: significant structural damage achievable
  if (damage >= 2) return true;

  // Play Ace if: we're behind and there's any damage
  if (scoreDiff <= -3 && damage >= 1) return true;

  // Play Ace if: endgame and damage >= 1
  if (endgame && damage >= 1) return true;

  // Don't play Ace last turn before signal — wastes trade action
  const isLastTurn = phase === 'ai-turn-1b' || phase === 'ai-turn-2b';
  if (isLastTurn && damage < 3) return false;

  return false;
}

// ── Decide whether to counter opponent's Ace ─────────────────
export function shouldCounterAce(aiScraps, opponentScraps, aiScore, opponentScore) {
  if (aiScraps.length < 2) return false;
  const myStrength = scrapsStrength(aiScraps);
  const oppStrength = scrapsStrength(opponentScraps);

  // Always counter if opponent Scraps is strong — cost of NOT countering is high
  if (oppStrength >= 4) return true;

  // Counter if we're ahead and don't want to cede ground
  if (aiScore > opponentScore && myStrength >= 3) return true;

  // Counter if endgame
  if (aiScore >= 9 || opponentScore >= 9) return true;

  // Don't counter if our Scraps is weak — not worth the Ace
  if (myStrength <= 1) return false;

  return myStrength >= 2;
}

// ── Main AI decision function ─────────────────────────────────

export function aiDecide(aiHand, aiScraps, opponentScraps, deck, difficulty, phase, aiScore = 0, opponentScore = 0) {
  const HAND_LIMIT = 7;
  const SCRAPS_LIMIT = 7;
  const aces = aiHand.filter(c => c.rank === 'A');
  const scoreDiff = aiScore - opponentScore;

  // ── EASY ───────────────────────────────────────────────────
  if (difficulty === 'easy') {
    // Never plays Aces, conservative trades, holds pairs
    const nonAceTradeable = aiHand.filter(c => {
      if (c.rank === 'A') return false;
      const gain = tradeInValue(c);
      return (aiHand.length - 1 + gain <= HAND_LIMIT) && (aiScraps.length + 1 <= SCRAPS_LIMIT);
    });
    const rankCounts = {};
    for (const c of aiHand) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
    // Prefer trading isolated (non-paired) low cards
    const singles = nonAceTradeable
      .filter(c => rankCounts[c.rank] === 1)
      .sort((a, b) => a.value - b.value);
    if (singles.length > 0) return { type: 'trade', cards: [singles[0]] };
    if (nonAceTradeable.length > 0) {
      return { type: 'trade', cards: [nonAceTradeable.sort((a, b) => a.value - b.value)[0]] };
    }
    return { type: 'trade', cards: aiHand.length > 0 ? [aiHand[0]] : [] };
  }

  // ── MEDIUM ─────────────────────────────────────────────────
  if (difficulty === 'medium') {
    // Plays Aces occasionally and somewhat strategically.
    // Targets high-value opponent cards but misses structural analysis.
    // Considers score differential loosely.

    // Ace decision: play ~60% of the time when opponent scraps is decent
    if (aces.length > 0 && opponentScraps.length >= 2) {
      const oppStrength = scrapsStrength(opponentScraps);
      // Medium plays Ace if opponent scraps is developing+ and random check passes
      const aceThreshold = scoreDiff <= -2 ? 0.35 : 0.55; // more aggressive when behind
      if (oppStrength >= 2 && Math.random() > aceThreshold) {
        // Target: picks highest-value cards (not structural analysis)
        const targets = [...opponentScraps]
          .sort((a, b) => b.value - a.value)
          .slice(0, 2);
        return { type: 'ace', targetCards: targets };
      }
    }

    // Trade: use basic scraps improvement logic, one card at a time
    const rankCounts = {};
    for (const c of aiHand) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
    const candidates = aiHand.filter(c => {
      if (c.rank === 'A') return false;
      const gain = tradeInValue(c);
      return (aiHand.length - 1 + gain <= HAND_LIMIT) && (aiScraps.length + 1 <= SCRAPS_LIMIT);
    });
    if (candidates.length === 0) return { type: 'trade', cards: aiHand.length > 0 ? [aiHand[0]] : [] };

    // Medium: prefer trading cards that add a new rank to scraps (basic improvement)
    // but doesn't compute full hypothetical hand strength
    const scrapsRanks = new Set(aiScraps.map(c => c.rank));
    // Prefer cards whose rank is already in scraps (building pairs/trips)
    const reinforcing = candidates.filter(c => scrapsRanks.has(c.rank));
    if (reinforcing.length > 0) {
      // Trade the lowest reinforcing card (keep the higher one)
      return { type: 'trade', cards: [reinforcing.sort((a, b) => a.value - b.value)[0]] };
    }
    // Otherwise trade the lowest isolated card
    const singles = candidates
      .filter(c => rankCounts[c.rank] === 1)
      .sort((a, b) => a.value - b.value);
    if (singles.length > 0) return { type: 'trade', cards: [singles[0]] };
    return { type: 'trade', cards: [candidates.sort((a, b) => a.value - b.value)[0]] };
  }

  // ── HARD ───────────────────────────────────────────────────
  if (difficulty === 'hard') {
    // Full strategic framework per design spec.

    const myStrength  = scrapsStrength(aiScraps);
    const oppStrength = scrapsStrength(opponentScraps);
    const endgame     = aiScore >= 9 || opponentScore >= 9;
    const isHand2     = phase === 'ai-turn-2a' || phase === 'ai-turn-2b';
    const isLastTurn  = phase === 'ai-turn-1b' || phase === 'ai-turn-2b';

    // ── ACE DECISION ──────────────────────────────────────────
    if (aces.length > 0 && opponentScraps.length >= 2) {
      // Don't play Ace on last turn (wastes trade action benefit)
      const dontWasteAce = isLastTurn && oppStrength <= 2 && !endgame;
      if (!dontWasteAce && shouldPlayAce(aiScraps, opponentScraps, aiScore, opponentScore, phase)) {
        const targets = chooseAceTargets(opponentScraps);
        if (targets.length === 2) return { type: 'ace', targetCards: targets };
      }
    }

    // ── TRADE DECISION ────────────────────────────────────────

    // Mode selection based on score differential and strength comparison
    let mode = 'build'; // default: build own scraps
    if (oppStrength >= myStrength + 2) {
      // Opponent is significantly ahead in scraps — switch to disruption
      // (but we can't disrupt without Ace, so just trade toward catch-up)
      mode = 'catchup';
    }
    if (scoreDiff >= 3) {
      // AI is winning comfortably — play conservatively
      mode = 'conserve';
    }
    if (scoreDiff <= -3) {
      // AI is behind — trade aggressively for variance
      mode = 'aggressive';
    }
    if (endgame && scoreDiff < 0) {
      mode = 'aggressive';
    }

    const rankCounts = {};
    for (const c of aiHand) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;

    // Tradeable non-Ace cards
    const candidates = aiHand.filter(c => {
      if (c.rank === 'A') return false;
      const gain = tradeInValue(c);
      return (aiHand.length - 1 + gain <= HAND_LIMIT) && (aiScraps.length + 1 <= SCRAPS_LIMIT);
    });

    if (candidates.length === 0) {
      // Must trade an Ace if nothing else available
      const ace = aces[0];
      if (ace) {
        const gain = tradeInValue(ace);
        if (aiHand.length - 1 + gain <= HAND_LIMIT && aiScraps.length + 1 <= SCRAPS_LIMIT) {
          return { type: 'trade', cards: [ace] };
        }
      }
      return { type: 'trade', cards: aiHand.length > 0 ? [aiHand[0]] : [] };
    }

    if (mode === 'conserve') {
      // Conservative: only trade if it actively improves Scraps by 1+ rank
      const scored = candidates.map(card => {
        const hypo = [...aiScraps, card];
        const gain = scrapsStrength(hypo) - myStrength;
        return { card, gain };
      }).sort((a, b) => b.gain - a.gain);
      if (scored[0].gain > 0) return { type: 'trade', cards: [scored[0].card] };
      // No improvement — trade lowest isolated card to stay under limit
      const singles = candidates.filter(c => rankCounts[c.rank] === 1).sort((a, b) => a.value - b.value);
      return { type: 'trade', cards: singles.length > 0 ? [singles[0]] : [candidates[0]] };
    }

    if (mode === 'aggressive') {
      // Aggressive: prefer high-draw-value cards (10–K for 2 draws) to maximize card churn
      const highDraw = candidates.filter(c => tradeInValue(c) >= 2).sort((a, b) => a.value - b.value);
      if (highDraw.length > 0) return { type: 'trade', cards: [highDraw[0]] };
      return { type: 'trade', cards: chooseTrade(aiHand, aiScraps, opponentScraps) };
    }

    // Default: 'build' or 'catchup' — strategic scraps improvement
    // Score each candidate by hypothetical scraps strength gain
    const scored = candidates.map(card => {
      const hypo = [...aiScraps, card];
      const gain = scrapsStrength(hypo) - myStrength;
      const isIsolated = rankCounts[card.rank] === 1;
      const drawBonus = tradeInValue(card) * 0.15;
      return { card, score: gain * 10 + (isIsolated ? 1 : 0) + drawBonus };
    }).sort((a, b) => b.score - a.score);

    // Hard AI: in Hand 2 last turn, try to push Scraps to 7 cards if possible
    if (isHand2 && isLastTurn && aiScraps.length < 6) {
      // Trade the best-scoring card
      return { type: 'trade', cards: [scored[0].card] };
    }

    return { type: 'trade', cards: [scored[0].card] };
  }

  // Fallback
  return { type: 'trade', cards: aiHand.length > 0 ? [aiHand[0]] : [] };
}

// ── AI signal selection ───────────────────────────────────────

export function aiChooseSignal(hand, opponentSignal, difficulty, aiScore = 0, opponentScore = 0) {
  const validSignals = getValidSignals(hand);
  if (validSignals.length === 0) return 1;

  const best = validSignals[validSignals.length - 1];
  const worst = validSignals[0];
  const mid = validSignals[Math.floor(validSignals.length / 2)];
  const endgame = aiScore >= 9 || opponentScore >= 9;

  if (difficulty === 'easy') {
    return worst; // always lowest valid — conservative, bad
  }

  if (difficulty === 'medium') {
    if (!opponentSignal) return mid; // signals first: middle ground
    // Signals second: try to match or beat opponent signal
    if (opponentSignal <= 2 && best >= 2) return best;
    return mid;
  }

  if (difficulty === 'hard') {
    // Endgame: always play best hand, no games
    if (endgame) return best;

    // Signaling FIRST (no opponentSignal yet)
    if (!opponentSignal) {
      // Default: play best hand
      // Bait-low: signal 2 (pair) if we have a high pair and might catch opponent off guard
      // Only do this if we have a pair of 9s or better and hand is not strong enough to signal 3+
      if (best === 2 && hand.some(c => c.rank !== 'A')) {
        // Just signal our best — no deception at this level since signal is honest
        return best;
      }
      return best;
    }

    // Signaling SECOND (we see opponent's signal)
    if (opponentSignal === 1) return best; // trivial win
    if (opponentSignal === 2) {
      // Opponent has a pair — beat it if we can
      if (best >= 2) return best;
      return worst; // concede gracefully
    }
    if (opponentSignal === 3) {
      if (best >= 3) return best; // trips or better
      if (best >= 2) {
        // We have pair vs their trips — marginal: concede if Scraps is strong
        const scrapsIsStrong = aiScore > opponentScore; // proxy
        return scrapsIsStrong ? worst : best; // concede small hand if Scraps is in good shape
      }
      return worst;
    }
    if (opponentSignal === 4) {
      if (best >= 4) return best; // match or beat
      return worst; // concede small hand, focus on Scraps
    }
    if (opponentSignal === 5) {
      if (best >= 5) return best;
      return worst; // concede — their hand is too strong
    }
    return best;
  }

  return best;
}

// ── Initial deal ──────────────────────────────────────────────

export function dealRound(deck) {
  let d = [...deck];
  const take = (n) => { const cards = d.slice(0, n); d = d.slice(n); return cards; };
  return {
    playerHand: take(5),
    aiHand: take(5),
    playerScraps: take(2),
    aiScraps: take(2),
    remainingDeck: d,
  };
}
