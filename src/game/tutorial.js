// ============================================================
// SCRAPS — Tutorial Script v4
// Scripted for: opponent starts with two 5s, trades in two more 5s
// (giving them four-of-a-kind). Player is forced to play Ace on turn 2b.
// ============================================================

export const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    phase: 'any',
    title: 'Welcome to SCRAPS',
    instruction: 'SCRAPS has two games running at once: your private small hand (only you can see it) and the Scraps pile (face-up, visible to everyone). Each round has two small hands and then a Scraps hand. First to 11 points — win by 2.',
    waitForOk: true,
  },
  {
    id: 'deal-explained',
    phase: 'any',
    title: 'The Deal',
    instruction: "You've been dealt 5 cards into your private hand, and 2 cards face-up into your Scraps pile. The Scraps pile is public — both players can always see it. Notice your Ace — you'll use it soon.",
    waitForOk: true,
  },
  {
    id: 'trade-in-explained',
    phase: 'any',
    title: 'Trading In',
    instruction: 'On your turn, select one or more cards from your hand to trade in. They move face-up into your Scraps pile. You draw fresh replacement cards: 2–9 earns 1, 10–K earns 2, an Ace earns 3. Both piles cap at 7 cards.',
    waitForOk: true,
  },
  {
    id: 'do-trade-1',
    phase: 'player-turn-1a',
    title: 'Make Your First Trade',
    instruction: 'Select one or more cards from your hand to trade in — but keep your Ace! Click each card to select it, then click "Trade In."',
    waitForOk: false,
    autoAdvanceOn: 'trade-complete',
  },
  {
    id: 'ai-turn-1',
    phase: 'ai-turn-1a',
    title: "Opponent's Turn",
    instruction: "Your opponent takes their turn. Watch their Scraps pile — they just traded in two 5s. They already had two 5s. They now have four 5s: Four of a Kind.",
    waitForOk: false,
    autoAdvanceOn: 'ai-turn-complete',
  },
  {
    id: 'do-trade-2',
    phase: 'player-turn-1b',
    title: 'Make Your Second Trade',
    instruction: 'Trade more cards to build your Scraps pile. Keep your Ace — you\'ll want it next turn.',
    waitForOk: false,
    autoAdvanceOn: 'trade-complete',
  },
  {
    id: 'ai-turn-2',
    phase: 'ai-turn-1b',
    title: "Opponent's Second Turn",
    instruction: 'Opponent takes their second turn. Their Four of a Kind is sitting there — ripe for an Ace attack.',
    waitForOk: false,
    autoAdvanceOn: 'ai-turn-complete',
  },
  {
    id: 'signal-1',
    phase: 'signal-player',
    title: 'Select the Hand You Plan to Play',
    instruction: 'Toggle the cards you want to play — they must form a valid poker hand. Hit SIGNAL. Your opponent sees how many cards you plan to play, not which ones.',
    waitForOk: false,
    autoAdvanceOn: 'signal-complete',
  },
  {
    id: 'reveal-1',
    phase: 'reveal-1',
    title: 'The Reveal',
    instruction: 'Both hands revealed. Best poker hand wins 1 point.',
    waitForOk: true,
  },
  {
    id: 'replenish',
    phase: 'replenish',
    title: 'Replenish',
    instruction: 'Hands are refilled to 5. Your Scraps pile carries over. Second small hand begins now.',
    waitForOk: true,
  },
  {
    id: 'do-trade-3',
    phase: 'player-turn-2a',
    title: 'Make Your First Trade (Hand 2)',
    instruction: 'Trade some cards — but hold on to your Ace. You\'ll be using it next turn.',
    waitForOk: false,
    autoAdvanceOn: 'trade-complete',
  },
  {
    id: 'ai-turn-3',
    phase: 'ai-turn-2a',
    title: "Opponent's Turn",
    instruction: "Opponent takes their turn. Their Four of a Kind is still sitting in their Scraps pile. Time to strike.",
    waitForOk: false,
    autoAdvanceOn: 'ai-turn-complete',
  },
  {
    id: 'ace-force',
    phase: 'player-turn-2b',
    title: 'Play Your Ace!',
    instruction: '⚡ You have an Ace. Instead of trading, click "Play Ace ⚡" to discard it and remove any 2 cards from your opponent\'s Scraps pile. Their Four of a Kind is your target — take it apart.',
    waitForOk: false,
    autoAdvanceOn: 'ace-played',
    forceAce: true,
  },
  {
    id: 'signal-2',
    phase: 'signal-player-2',
    title: 'Select the Hand You Plan to Play',
    instruction: 'Toggle your best hand and hit SIGNAL.',
    waitForOk: false,
    autoAdvanceOn: 'signal-complete',
  },
  {
    id: 'scraps-hand',
    phase: 'scraps-reveal',
    title: 'The Scraps Hand',
    instruction: 'Both players now play their best 5-card hand from their Scraps pile. Worth 2 points. Flushes are never allowed. Win all three hands in a round for a FULL SCRAP — 5 points total.',
    waitForOk: true,
  },
  {
    id: 'round-end',
    phase: 'round-end',
    title: 'Round Complete',
    instruction: "All cards reshuffled. Dealer alternates. You now know how to play SCRAPS. Keep going — first to 11, win by 2!",
    waitForOk: true,
  },
];

// Scripted AI moves for tutorial
// The opponent starts with two 5s (dealt by startNewRound manipulation)
// and trades in two more 5s on ai-turn-1a to achieve four-of-a-kind.
// The opponent does NOT counter the player's Ace.
export const TUTORIAL_AI_SCRIPT = {
  'ai-turn-1a': { type: 'trade-fives', message: 'Opponent trades in two 5s.' },
  'ai-turn-1b': { type: 'trade-low',   message: 'Opponent makes a second trade.' },
  'ai-turn-2a': { type: 'trade-low',   message: 'Opponent trades.' },
  'ai-turn-2b': { type: 'trade-low',   message: 'Opponent trades.' },
  counter: false, // AI never counters player Ace in tutorial
};
