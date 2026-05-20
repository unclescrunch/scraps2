import { useState, useEffect, useCallback, useRef } from "react";
import {
  createDeck, shuffle, dealRound, tradeInValue,
  evaluateBestHand, getBestCardsForSignal, getActiveHandCards,
  compareHands, aiDecide, aiChooseSignal, shouldCounterAce
} from "./game/engine.js";
import { TUTORIAL_STEPS, TUTORIAL_AI_SCRIPT } from "./game/tutorial.js";

// ─────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────
const DS = {
  ink:       '#1A1A2E',
  frost:     '#F5F5FA',
  ember:     '#FF3D5A',
  voltage:   '#C8FF00',
  slate:     '#8A8FA8',
  dusk:      '#1C1C28',
  duskLight: '#24243a',
  duskMid:   '#2a2a40',
  slateLight:'#c8cce0',
  inkLight:  '#2e2e4a',
};
const F = {
  display: "'Bebas Neue', sans-serif",
  card:    "'Righteous', sans-serif",
  ui:      "'Space Grotesk', sans-serif",
  mono:    "'Space Mono', monospace",
};
const WIN_SCORE = 11;

function isRed(suit){ return suit==='♥'||suit==='♦'; }

// ── Inject hover CSS into document.head ONCE, before any React render ──
// This runs at module evaluation time, not inside React's render cycle.
// That's why it's instant — no hydration delay, no style recalculation on render.
(function injectGlobalStyles() {
  if(typeof document === 'undefined') return;
  const id = 'scraps-global-hover';
  if(document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = `
    .menu-opt {
      cursor: pointer;
      border: 2px solid #8A8FA844;
      border-radius: 10px;
      padding: 20px 24px;
      background: transparent;
    }
    .menu-opt:hover {
      border-color: #C8FF00 !important;
      background: #C8FF0018 !important;
      box-shadow: 0 0 24px #C8FF0066 !important;
    }
    .diff-opt {
      cursor: pointer;
      border: 2px solid #8A8FA844;
      border-radius: 10px;
      padding: 18px 22px;
      background: transparent;
    }
    .diff-opt:hover {
      border-color: #C8FF00 !important;
      background: #C8FF0018 !important;
      box-shadow: 0 0 24px #C8FF0066 !important;
    }
  `;
  document.head.appendChild(el);
})();

function cardInk(suit,isScrap){ return isScrap?(isRed(suit)?DS.ember:DS.voltage):(isRed(suit)?DS.ember:DS.ink); }
function sortByValue(cards){ return [...cards].sort((a,b)=>a.value-b.value); }

function isValidSignal(cards) {
  if(!cards||cards.length===0) return false;
  if(cards.length===1) return true;
  if(cards.length>5) return false;
  const rc={};
  for(const c of cards) rc[c.rank]=(rc[c.rank]||0)+1;
  const counts=Object.values(rc).sort((a,b)=>b-a);
  const max=counts[0], pairs=counts.filter(n=>n>=2).length;
  if(cards.length===2) return max===2;
  if(cards.length===3) return max===3;
  if(cards.length===4) return max===4||pairs>=2;
  if(cards.length===5){ const h=evaluateBestHand(cards,true); return !!(h&&h.rank>=4&&h.rank!==5); } // rank 5 = flush, not allowed
  return false;
}
// ─────────────────────────────────────────────────────────────
// FlyingCard — animates a card traveling from source to dest rect
// source/dest are {x,y,width,height} in viewport coords
// ─────────────────────────────────────────────────────────────
function FlyingCard({ card, fromRect, toRect, toIsScrap=false, onDone }) {
  const startRef = useRef(performance.now());
  const rafRef   = useRef();
  const elRef    = useRef();
  const DURATION = 900; // ms — smooth, half-speed

  useEffect(() => {
    function animate() {
      const el = elRef.current;
      if(!el) return;
      const elapsed = performance.now() - startRef.current;
      const t = Math.min(elapsed / DURATION, 1);
      // Ease in-out cubic
      const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
      const x = fromRect.x + (toRect.x - fromRect.x) * e;
      const y = fromRect.y + (toRect.y - fromRect.y) * e;
      // Transition from frost → ink background as it approaches scraps
      const scrapFrac = toIsScrap ? e : 0;
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
      el.style.opacity = t > 0.85 ? String(1 - (t-0.85)*6.67) : '1';
      // Color transition
      if(toIsScrap) {
        const r1=[245,245,250], r2=[26,26,46];
        const bg = r1.map((v,i)=>Math.round(v+(r2[i]-v)*scrapFrac));
        el.style.background = `rgb(${bg.join(',')})`;
        const borderColor = card&&(card.suit==='♥'||card.suit==='♦') ? '#FF3D5A' : '#C8FF00';
        el.style.borderColor = scrapFrac > 0.5 ? borderColor : '#1A1A2E';
      }
      if(t < 1) { rafRef.current = requestAnimationFrame(animate); }
      else { onDone(); }
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const ink  = card ? ((card.suit==='♥'||card.suit==='♦') ? '#FF3D5A' : '#1A1A2E') : '#1A1A2E';
  const isTD = card && card.rank==='10';
  const rk   = isTD ? 22 : 26;

  return (
    <div ref={elRef} style={{
      position:'fixed',
      left: fromRect.x, top: fromRect.y,
      width: fromRect.width, height: fromRect.height,
      zIndex:1000, pointerEvents:'none',
      borderRadius:10, overflow:'hidden',
      background:'#F5F5FA',
      border:`6px solid #1A1A2E`,
      display:'flex', flexDirection:'column',
      justifyContent:'space-between',
      padding:'8px 9px', boxSizing:'border-box',
      boxShadow:'0 8px 32px rgba(0,0,0,.6)',
      transition:'none',
    }}>
      {card && (
        <>
          <div style={{display:'flex',alignItems:'center',gap:1}}>
            <span style={{fontFamily:"'Righteous',sans-serif",fontSize:rk,color:ink,lineHeight:1}}>{card.rank}</span>
            <span style={{fontFamily:"'Righteous',sans-serif",fontSize:rk+2,color:ink,lineHeight:1,marginTop:-2}}>{card.suit}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:1,alignSelf:'flex-end',transform:'rotate(180deg)'}}>
            <span style={{fontFamily:"'Righteous',sans-serif",fontSize:rk,color:ink,lineHeight:1}}>{card.rank}</span>
            <span style={{fontFamily:"'Righteous',sans-serif",fontSize:rk+2,color:ink,lineHeight:1,marginTop:-2}}>{card.suit}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// useFlyingCards — manages a queue of in-flight card animations
// ─────────────────────────────────────────────────────────────
function useFlyingCards() {
  const [flights, setFlights] = useState([]); // [{id,card,fromRect,toRect,toIsScrap}]
  const nextId = useRef(0);

  const launchFlight = useCallback((card, fromRect, toRect, toIsScrap=false) => {
    const id = nextId.current++;
    setFlights(prev => [...prev, {id, card, fromRect, toRect, toIsScrap}]);
    return id;
  }, []);

  const removeFlight = useCallback((id) => {
    setFlights(prev => prev.filter(f => f.id !== id));
  }, []);

  const FlightsOverlay = useCallback(() => (
    <>
      {flights.map(f => (
        <FlyingCard key={f.id}
          card={f.card}
          fromRect={f.fromRect}
          toRect={f.toRect}
          toIsScrap={f.toIsScrap}
          onDone={() => removeFlight(f.id)}
        />
      ))}
    </>
  ), [flights, removeFlight]);

  return { launchFlight, FlightsOverlay };
}



// Win-by-two check: any player past WIN_SCORE needs 2-point lead
function checkWin(pScore, aScore) {
  const maxScore = Math.max(pScore, aScore);
  if(maxScore < WIN_SCORE) return null;
  if(Math.abs(pScore - aScore) >= 2) {
    return pScore > aScore ? 'player' : 'ai';
  }
  return null; // no winner yet — need more points
}

// ─────────────────────────────────────────────────────────────
// CardBackSVG — official SCRAPS design: Ink bg, ember+voltage diamonds
// ─────────────────────────────────────────────────────────────
function CardBackSVG({ w, h }) {
  return (
    <svg width={w} height={h} viewBox="0 0 120 178" preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      style={{position:'absolute',inset:0,borderRadius:12,display:'block'}}>
      <rect width="120" height="178" fill="#1A1A2E"/>
      <rect x="-5"  y="-6"  width="10" height="10" rx="1" transform="rotate(45 0 -1)"    fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="-6"  width="10" height="10" rx="1" transform="rotate(45 20 -1)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="-6"  width="10" height="10" rx="1" transform="rotate(45 40 -1)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="-6"  width="10" height="10" rx="1" transform="rotate(45 60 -1)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="-6"  width="10" height="10" rx="1" transform="rotate(45 80 -1)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="-6"  width="10" height="10" rx="1" transform="rotate(45 100 -1)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="-6"  width="10" height="10" rx="1" transform="rotate(45 120 -1)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="6"   width="10" height="10" rx="1" transform="rotate(45 10 11)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="6"   width="10" height="10" rx="1" transform="rotate(45 30 11)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="6"   width="10" height="10" rx="1" transform="rotate(45 50 11)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="6"   width="10" height="10" rx="1" transform="rotate(45 70 11)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="6"   width="10" height="10" rx="1" transform="rotate(45 90 11)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="6"   width="10" height="10" rx="1" transform="rotate(45 110 11)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="18"  width="10" height="10" rx="1" transform="rotate(45 0 23)"    fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="18"  width="10" height="10" rx="1" transform="rotate(45 20 23)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="18"  width="10" height="10" rx="1" transform="rotate(45 40 23)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="18"  width="10" height="10" rx="1" transform="rotate(45 60 23)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="18"  width="10" height="10" rx="1" transform="rotate(45 80 23)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="18"  width="10" height="10" rx="1" transform="rotate(45 100 23)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="18"  width="10" height="10" rx="1" transform="rotate(45 120 23)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="30"  width="10" height="10" rx="1" transform="rotate(45 10 35)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="30"  width="10" height="10" rx="1" transform="rotate(45 30 35)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="30"  width="10" height="10" rx="1" transform="rotate(45 50 35)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="30"  width="10" height="10" rx="1" transform="rotate(45 70 35)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="30"  width="10" height="10" rx="1" transform="rotate(45 90 35)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="30"  width="10" height="10" rx="1" transform="rotate(45 110 35)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="42"  width="10" height="10" rx="1" transform="rotate(45 0 47)"    fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="42"  width="10" height="10" rx="1" transform="rotate(45 20 47)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="42"  width="10" height="10" rx="1" transform="rotate(45 40 47)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="42"  width="10" height="10" rx="1" transform="rotate(45 60 47)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="42"  width="10" height="10" rx="1" transform="rotate(45 80 47)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="42"  width="10" height="10" rx="1" transform="rotate(45 100 47)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="42"  width="10" height="10" rx="1" transform="rotate(45 120 47)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="54"  width="10" height="10" rx="1" transform="rotate(45 10 59)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="54"  width="10" height="10" rx="1" transform="rotate(45 30 59)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="54"  width="10" height="10" rx="1" transform="rotate(45 50 59)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="54"  width="10" height="10" rx="1" transform="rotate(45 70 59)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="54"  width="10" height="10" rx="1" transform="rotate(45 90 59)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="54"  width="10" height="10" rx="1" transform="rotate(45 110 59)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="66"  width="10" height="10" rx="1" transform="rotate(45 0 71)"    fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="66"  width="10" height="10" rx="1" transform="rotate(45 20 71)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="66"  width="10" height="10" rx="1" transform="rotate(45 40 71)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="66"  width="10" height="10" rx="1" transform="rotate(45 60 71)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="66"  width="10" height="10" rx="1" transform="rotate(45 80 71)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="66"  width="10" height="10" rx="1" transform="rotate(45 100 71)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="66"  width="10" height="10" rx="1" transform="rotate(45 120 71)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="78"  width="10" height="10" rx="1" transform="rotate(45 10 83)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="78"  width="10" height="10" rx="1" transform="rotate(45 30 83)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="78"  width="10" height="10" rx="1" transform="rotate(45 50 83)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="78"  width="10" height="10" rx="1" transform="rotate(45 70 83)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="78"  width="10" height="10" rx="1" transform="rotate(45 90 83)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="78"  width="10" height="10" rx="1" transform="rotate(45 110 83)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="90"  width="10" height="10" rx="1" transform="rotate(45 0 95)"    fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="90"  width="10" height="10" rx="1" transform="rotate(45 20 95)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="90"  width="10" height="10" rx="1" transform="rotate(45 40 95)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="90"  width="10" height="10" rx="1" transform="rotate(45 60 95)"   fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="90"  width="10" height="10" rx="1" transform="rotate(45 80 95)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="90"  width="10" height="10" rx="1" transform="rotate(45 100 95)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="90"  width="10" height="10" rx="1" transform="rotate(45 120 95)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="102" width="10" height="10" rx="1" transform="rotate(45 10 107)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="102" width="10" height="10" rx="1" transform="rotate(45 30 107)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="102" width="10" height="10" rx="1" transform="rotate(45 50 107)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="102" width="10" height="10" rx="1" transform="rotate(45 70 107)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="102" width="10" height="10" rx="1" transform="rotate(45 90 107)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="102" width="10" height="10" rx="1" transform="rotate(45 110 107)" fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="114" width="10" height="10" rx="1" transform="rotate(45 0 119)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="114" width="10" height="10" rx="1" transform="rotate(45 20 119)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="114" width="10" height="10" rx="1" transform="rotate(45 40 119)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="114" width="10" height="10" rx="1" transform="rotate(45 60 119)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="114" width="10" height="10" rx="1" transform="rotate(45 80 119)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="114" width="10" height="10" rx="1" transform="rotate(45 100 119)" fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="114" width="10" height="10" rx="1" transform="rotate(45 120 119)" fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="126" width="10" height="10" rx="1" transform="rotate(45 10 131)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="126" width="10" height="10" rx="1" transform="rotate(45 30 131)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="126" width="10" height="10" rx="1" transform="rotate(45 50 131)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="126" width="10" height="10" rx="1" transform="rotate(45 70 131)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="126" width="10" height="10" rx="1" transform="rotate(45 90 131)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="126" width="10" height="10" rx="1" transform="rotate(45 110 131)" fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="138" width="10" height="10" rx="1" transform="rotate(45 0 143)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="138" width="10" height="10" rx="1" transform="rotate(45 20 143)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="138" width="10" height="10" rx="1" transform="rotate(45 40 143)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="138" width="10" height="10" rx="1" transform="rotate(45 60 143)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="138" width="10" height="10" rx="1" transform="rotate(45 80 143)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="138" width="10" height="10" rx="1" transform="rotate(45 100 143)" fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="138" width="10" height="10" rx="1" transform="rotate(45 120 143)" fill="#FF3D5A" opacity="0.55"/>
      <rect x="5"   y="150" width="10" height="10" rx="1" transform="rotate(45 10 155)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="25"  y="150" width="10" height="10" rx="1" transform="rotate(45 30 155)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="45"  y="150" width="10" height="10" rx="1" transform="rotate(45 50 155)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="65"  y="150" width="10" height="10" rx="1" transform="rotate(45 70 155)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="85"  y="150" width="10" height="10" rx="1" transform="rotate(45 90 155)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="105" y="150" width="10" height="10" rx="1" transform="rotate(45 110 155)" fill="#FF3D5A" opacity="0.55"/>
      <rect x="-5"  y="162" width="10" height="10" rx="1" transform="rotate(45 0 167)"   fill="#FF3D5A" opacity="0.55"/>
      <rect x="15"  y="162" width="10" height="10" rx="1" transform="rotate(45 20 167)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="35"  y="162" width="10" height="10" rx="1" transform="rotate(45 40 167)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="55"  y="162" width="10" height="10" rx="1" transform="rotate(45 60 167)"  fill="#C8FF00" opacity="0.45"/>
      <rect x="75"  y="162" width="10" height="10" rx="1" transform="rotate(45 80 167)"  fill="#FF3D5A" opacity="0.55"/>
      <rect x="95"  y="162" width="10" height="10" rx="1" transform="rotate(45 100 167)" fill="#C8FF00" opacity="0.45"/>
      <rect x="115" y="162" width="10" height="10" rx="1" transform="rotate(45 120 167)" fill="#FF3D5A" opacity="0.55"/>
      <text x="60" y="92" textAnchor="middle" dominantBaseline="middle"
        fontFamily="'Bebas Neue', sans-serif" fontSize="56"
        fill="#F5F5FA" opacity="0.07" letterSpacing="2">S</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// PlayingCard
// ─────────────────────────────────────────────────────────────
function PlayingCard({ card, faceDown=false, isScrap=false, selected=false,
  selectable=false, dimmed=false, onClick, size='normal',
  extraStyle={}, wiggle=false, shake=false, fading=false, fadingIn=false }) {

  const dims={
    tiny:  {w:60, h:84,  rank:17,suit:18,pad:5},
    small: {w:80, h:112, rank:22,suit:24,pad:7},
    normal:{w:104,h:146, rank:28,suit:30,pad:9},
    large: {w:124,h:174, rank:34,suit:36,pad:11},
  };
  const d=dims[size]||dims.normal;
  const ink=card?cardInk(card.suit,isScrap):DS.ink;
  const isTwoDigit=card&&card.rank==='10';
  const rankFs=isTwoDigit?d.rank*.82:d.rank;
  const notch=Math.round(d.w*.2);

  let bg,border,shadow;
  if(faceDown){
    bg='transparent';
    // Voltage outline, triple thickness
    border=`4px solid ${DS.voltage}`;
    shadow='0 4px 18px rgba(0,0,0,.5)';
  } else if(isScrap){
    bg=DS.ink;
    border=selected?`6px solid ${DS.voltage}`:`4px solid ${isRed(card?.suit)?DS.ember:DS.voltage}`;
    shadow=selected?`0 0 0 3px ${DS.voltage}66,0 -18px 28px ${DS.voltage}44`:'0 4px 18px rgba(0,0,0,.5)';
  } else {
    bg=DS.frost;
    border=selected?`6px solid ${DS.voltage}`:`6px solid ${DS.ink}`;
    shadow=selected?`0 0 0 3px ${DS.voltage}66,0 -18px 28px ${DS.voltage}44`:'0 4px 18px rgba(0,0,0,.45)';
  }

  const animName = shake?'cardShake':wiggle?'cardWiggle':undefined;

  return (
    <div onClick={onClick} style={{
      width:d.w,height:d.h,borderRadius:12,
      background:faceDown?'transparent':bg,
      border,boxShadow:shadow,
      transform:selected?'translateY(-22px) scale(1.07)':'none',
      transition:'transform 0.44s cubic-bezier(.34,1.4,.64,1),box-shadow 0.4s,border-color 0.3s,opacity 0.6s',
      opacity:fading?0:fadingIn?0.15:dimmed?.28:1,
      animation:fadingIn?'cardFadeIn 0.5s ease forwards':animName?`${animName} 0.5s ease-in-out infinite alternate`:undefined,

      display:'flex',flexDirection:'column',justifyContent:'space-between',
      padding:`${d.pad}px ${d.pad+1}px`,
      position:'relative',overflow:'hidden',
      flexShrink:0,userSelect:'none',
      cursor:(selectable||onClick)?'pointer':'default',
      boxSizing:'border-box',
      ...extraStyle,
    }}>
      {faceDown&&<CardBackSVG w={d.w} h={d.h}/>}
      {!faceDown&&isScrap&&card&&(
        <div style={{position:'absolute',top:0,right:0,
          width:notch,height:notch,
          clipPath:'polygon(100% 0,0 0,100% 100%)',
          background:ink,zIndex:2}}/>
      )}
      {!faceDown&&card&&(
        <>
          <div style={{display:'flex',alignItems:'center',gap:1,lineHeight:1,zIndex:1}}>
            <span style={{fontFamily:F.card,fontSize:rankFs,color:ink,lineHeight:1}}>{card.rank}</span>
            <span style={{fontFamily:F.card,fontSize:d.suit,color:ink,lineHeight:1,marginTop:-2}}>{card.suit}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:1,lineHeight:1,
            alignSelf:'flex-end',transform:'rotate(180deg)',zIndex:1}}>
            <span style={{fontFamily:F.card,fontSize:rankFs,color:ink,lineHeight:1}}>{card.rank}</span>
            <span style={{fontFamily:F.card,fontSize:d.suit,color:ink,lineHeight:1,marginTop:-2}}>{card.suit}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GlowPulse
// ─────────────────────────────────────────────────────────────
function GlowPulse({ active, color=DS.voltage, children, style:extStyle={} }) {
  return (
    <div style={{borderRadius:16,
      boxShadow:active?`0 0 0 3px ${color}88,0 0 22px ${color}55`:'none',
      animation:active?'zonePulse 1.6s ease-in-out infinite':'none',
      transition:'box-shadow 0.3s',...extStyle}}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FannedHand
// ─────────────────────────────────────────────────────────────
function FannedHand({ cards, selectedIds=new Set(), tradeSelectedIds=new Set(),
  onCardClick, faceDown=false, selectable=false,
  wiggleIds=new Set(), glowZone=false, activeWiggle=false, aiSignaledIds=new Set(),
  shakeIds=new Set(), fadingIds=new Set(), fadingInIds=new Set() }) {

  const sorted=faceDown?cards:sortByValue(cards);
  const count=sorted.length;
  const spread=Math.min(42,Math.max(22,240/Math.max(count,1)));
  const W=104; const H=160;

  return (
    <div style={{padding:0}}>
      <div style={{position:'relative',height:H+32,
        width:Math.max(count*spread*2+W,W+40),
        display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
        {count===0&&(
          <div style={{border:`2px dashed ${DS.slate}44`,borderRadius:12,width:W,height:H,
            display:'flex',alignItems:'center',justifyContent:'center',
            color:DS.slate+'66',fontSize:16,fontFamily:F.mono}}>empty</div>
        )}
        {sorted.map((card,i)=>{
          const offset=count===1?0:(i-(count-1)/2);
          const rot=offset*(count<=3?4:2.8);
          const tx=offset*spread*2;
          const ty=Math.abs(offset)*3;
          const isSel=selectedIds.has(card.id);
          const isTradeSel=tradeSelectedIds.has(card.id);
          const isAiSig=aiSignaledIds.has(card.id);
          return (
            <div key={card.id} style={{
              position:'absolute',bottom:0,left:'50%',
              transform:isSel||isAiSig
                ?`translateX(calc(-50% + ${tx}px)) translateY(${ty-28}px) rotate(${rot}deg) scale(1.05)`
                :`translateX(calc(-50% + ${tx}px)) translateY(${ty}px) rotate(${rot}deg)`,
              transition:'all 0.56s cubic-bezier(.34,1.2,.64,1)',
              zIndex:i,
            }} onClick={()=>onCardClick&&onCardClick(card)}>
              <PlayingCard card={card} faceDown={faceDown} isScrap={false}
                selected={isSel} selectable={selectable&&!faceDown}
                fadingIn={fadingInIds&&fadingInIds.has(card.id)}
                wiggle={wiggleIds.has(card.id)||(activeWiggle&&!isSel&&!faceDown)}
                shake={shakeIds.has(card.id)}
                fading={fadingIds.has(card.id)}
                extraStyle={isTradeSel?{border:`6px solid ${DS.voltage}`,
                  boxShadow:`0 0 0 3px ${DS.voltage}55`}:{}}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DiscardPile — labeled, messy stack
// ─────────────────────────────────────────────────────────────
function DiscardPile({ count }) {
  const layers=Math.min(count,4);
  const rots=[-11,6,-4,1];
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,opacity:0.55}}>
      <div style={{position:'relative',width:80,height:112}}>
        {count===0?(
          <div style={{width:80,height:112,borderRadius:10,
            border:`2px dashed ${DS.slate}22`,
            display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span style={{fontFamily:F.mono,fontSize:11,color:DS.slate+'33'}}>—</span>
          </div>
        ):(
          Array.from({length:layers},(_,i)=>(
            <div key={i} style={{position:'absolute',top:0,left:0,
              transform:`rotate(${rots[i]||0}deg) translate(${i*1.5-2}px,${i-1}px)`,
              zIndex:i}}>
              <PlayingCard card={null} faceDown={true} size="small"/>
            </div>
          ))
        )}
      </div>
      <span style={{fontFamily:F.mono,fontSize:11,color:DS.slate+'88',
        letterSpacing:'0.12em'}}>DISCARD</span>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// RoundInterstitial — "BEGIN ROUND N" full-screen flash
// ─────────────────────────────────────────────────────────────
function RoundInterstitial({ roundNum, onDone }) {
  const [phase, setPhase] = useState('in'); // in | hold | out
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 400);
    const t2 = setTimeout(() => setPhase('out'),  1400);
    const t3 = setTimeout(() => onDone(), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:500,
      background: phase==='out' ? 'transparent' : `rgba(10,10,20,${phase==='hold'?0.92:0.6})`,
      display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:16,
      transition: phase==='out' ? 'background 0.5s ease, opacity 0.5s ease' : 'background 0.35s ease',
      opacity: phase==='out' ? 0 : 1,
      pointerEvents: phase==='out' ? 'none' : 'all',
    }}>
      <div style={{
        fontFamily:"'Bebas Neue', sans-serif",
        fontSize:'clamp(52px,12vw,96px)',
        color:'#C8FF00',
        letterSpacing:'0.08em',
        textShadow:`0 0 40px #C8FF0099, 0 0 80px #C8FF0055`,
        opacity: phase==='in' ? 0 : 1,
        transform: phase==='in' ? 'scale(0.7) translateY(20px)' : 'scale(1) translateY(0)',
        transition:'opacity 0.35s ease, transform 0.35s cubic-bezier(.34,1.4,.64,1)',
        whiteSpace:'nowrap',
      }}>
        BEGIN ROUND {roundNum}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ScrapsZone
// ─────────────────────────────────────────────────────────────
function ScrapsZone({ cards, label, selectable=false, selectedIds=new Set(),
  onCardClick, discardMode=false, isOpponent=false, glowZone=false,
  shakeIds=new Set(), fadingIds=new Set(), slideRight=false }) {
  const sorted=sortByValue(cards);
  const borderCol=discardMode?DS.voltage:isOpponent?DS.ember:DS.voltage;
  const glowColor=isOpponent?DS.ember:DS.voltage;
  return (
    <GlowPulse active={glowZone} color={glowColor}>
      <div style={{display:'flex',flexDirection:'column',gap:8,
        background:DS.inkLight,border:`3px solid ${borderCol}`,
        borderRadius:14,padding:'10px 8px',width:130,
        transition:'border-color 0.2s',
        boxShadow:discardMode?`0 0 22px ${DS.voltage}66`
          :isOpponent?`0 0 14px ${DS.ember}44`:`0 0 14px ${DS.voltage}22`}}>
        <div style={{fontFamily:F.ui,fontSize:13,fontWeight:700,
          color:discardMode?DS.voltage:isOpponent?DS.ember:DS.voltage,
          letterSpacing:'0.12em',textTransform:'uppercase',textAlign:'center',lineHeight:1.4}}>
          {label}<br/>
          <span style={{color:DS.slate,fontSize:13,fontFamily:F.mono,fontWeight:400}}>
            {cards.length}/7
          </span>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'center',position:'relative'}}>
          {cards.length===0&&(
            <div style={{border:`2px dashed ${DS.slate}44`,borderRadius:8,width:80,height:112,
              display:'flex',alignItems:'center',justifyContent:'center',
              color:DS.slate+'44',fontSize:13,fontFamily:F.mono}}>—</div>
          )}
          {sorted.map((card,i)=>{
            const isElig=selectable&&card.eligibleForDiscard;
            const isSel=selectedIds.has(card.id);
            return (
              <div key={card.id} style={{marginTop:i>0?-76:0,
                zIndex:i,
                position:'relative',
                transform:isSel?(slideRight?'translateX(26px)':'translateX(-26px)'):'translateX(0)',
                transition:'transform 0.44s cubic-bezier(.34,1.2,.64,1)'}}>
                <PlayingCard card={card} size="small" isScrap={true}
                  selectable={isElig} selected={isSel}
                  dimmed={selectable&&!isElig}
                  shake={shakeIds.has(card.id)}
                  fading={fadingIds.has(card.id)}
                  wiggle={glowZone&&!isSel}
                  onClick={()=>isElig&&onCardClick&&onCardClick(card)}/>
              </div>
            );
          })}
        </div>
      </div>
    </GlowPulse>
  );
}

// ─────────────────────────────────────────────────────────────
// BestHandBadge
// ─────────────────────────────────────────────────────────────
function BestHandBadge({ cards, allowFlush=false }) {
  // Never show Flush as best hand — flushes are never allowed in Scraps
  // For small hand, still no flush display (confusing since signals/plays can't use them)
  const best=cards.length>0?evaluateBestHand(cards,false):null;
  return (
    <div style={{fontFamily:F.mono,fontSize:14,fontWeight:700,color:DS.slate,
      letterSpacing:'0.08em',textAlign:'center',
      background:DS.duskMid,borderRadius:6,
      padding:'4px 12px',minWidth:130,minHeight:24,
      border:`1px solid ${DS.slate}22`}}>
      {best?`▸ ${best.name.toUpperCase()}`:''}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RoundProgressIndicator
// ─────────────────────────────────────────────────────────────
function RoundProgressIndicator({ phase }) {
  const h1=['player-turn-1a','ai-turn-1a','player-turn-1b','ai-turn-1b','signal-player','reveal-1','replenish'];
  const h2=['player-turn-2a','ai-turn-2a','player-turn-2b','ai-turn-2b','signal-player-2','reveal-2'];
  const sc=['scraps-reveal','round-end'];
  const steps=[
    {label:'HAND 1',active:h1.includes(phase),done:h2.includes(phase)||sc.includes(phase)},
    {label:'HAND 2',active:h2.includes(phase),done:sc.includes(phase)},
    {label:'SCRAPS',active:sc.includes(phase),done:false},
  ];
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4,
      background:DS.duskMid,border:`2px solid ${DS.slate}33`,
      borderRadius:10,padding:'8px 12px',minWidth:112,
      boxShadow:'0 2px 12px rgba(0,0,0,.4)'}}>
      <div style={{fontFamily:F.mono,fontSize:11,color:DS.slate,
        letterSpacing:'0.18em',fontWeight:700,textAlign:'center',marginBottom:2}}>ROUND</div>
      {steps.map((s,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:7,
          padding:'5px 8px',borderRadius:6,
          background:s.active?DS.voltage+'22':s.done?DS.slate+'11':'transparent',
          border:`2px solid ${s.active?DS.voltage:s.done?DS.slate+'44':DS.slate+'22'}`,
          transition:'all 0.3s',boxShadow:s.active?`0 0 10px ${DS.voltage}55`:'none'}}>
          <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,
            background:s.active?DS.voltage:s.done?DS.slate:DS.slate+'33',
            boxShadow:s.active?`0 0 6px ${DS.voltage}`:'none'}}/>
          <span style={{fontFamily:F.ui,fontSize:14,fontWeight:700,
            color:s.active?DS.voltage:s.done?DS.slate:DS.slate+'55',
            letterSpacing:'0.05em'}}>{s.label}</span>
          {s.done&&<span style={{marginLeft:'auto',fontSize:13,color:DS.slate}}>✓</span>}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ScoreBar
// ─────────────────────────────────────────────────────────────
// ScoreBar removed — scores shown inline in status bar
function ScoreCorners({ playerScore, aiScore }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',
      padding:'8px 22px 4px',background:DS.dusk,
      borderBottom:`1px solid ${DS.slate}22`,flexShrink:0}}>
      <div style={{display:'flex',flexDirection:'column',lineHeight:1}}>
        <span style={{fontFamily:F.ui,fontSize:13,color:DS.slate,letterSpacing:'0.18em',fontWeight:700}}>YOU</span>
        <span style={{fontFamily:F.display,fontSize:48,color:DS.voltage,lineHeight:1.05}}>{playerScore}</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',paddingTop:4}}>
        <span style={{fontFamily:F.mono,fontSize:12,color:DS.slate+'88',letterSpacing:'0.12em'}}>FIRST TO {WIN_SCORE}</span>
        <span style={{fontFamily:F.mono,fontSize:11,color:DS.slate+'55',letterSpacing:'0.08em'}}>WIN BY 2</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',lineHeight:1}}>
        <span style={{fontFamily:F.ui,fontSize:13,color:DS.slate,letterSpacing:'0.18em',fontWeight:700}}>OPP</span>
        <span style={{fontFamily:F.display,fontSize:48,color:DS.ember,lineHeight:1.05}}>{aiScore}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RevealOverlay
// ─────────────────────────────────────────────────────────────
function RevealOverlay({ playerCards, aiCards, playerHandName, aiHandName, winner, points, onDismiss, playerBestIds=null, aiBestIds=null }) {
  const [vis,setVis]=useState(false);
  useEffect(()=>{setTimeout(()=>setVis(true),50);},[]);
  return (
    <div style={{position:'fixed',inset:0,zIndex:80,background:'rgba(26,26,46,0.94)',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      gap:20,padding:20,opacity:vis?1:0,transition:'opacity 0.3s',overflowY:'auto'}}>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
        <div style={{fontFamily:F.ui,fontSize:17,color:DS.slate,letterSpacing:'0.14em',fontWeight:700}}>OPPONENT</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
          {(aiCards||[]).map((c,i)=>(
            <div key={c.id} style={{animation:`slideDown 0.3s ease ${i*.07}s both`,
              filter:aiBestIds&&!aiBestIds.has(c.id)?'brightness(0.35) saturate(0.3)':'',
              transition:'filter 0.4s'}}>
              <PlayingCard card={c} size="normal" isScrap={false}/>
            </div>
          ))}
        </div>
        <div style={{fontFamily:F.display,fontSize:26,color:winner==='ai'?DS.ember:DS.slate,letterSpacing:'0.06em'}}>{aiHandName}</div>
      </div>
      <div style={{padding:'16px 40px',borderRadius:12,textAlign:'center',
        background:winner==='player'?DS.voltage+'18':winner==='ai'?DS.ember+'18':DS.slate+'18',
        border:`3px solid ${winner==='player'?DS.voltage:winner==='ai'?DS.ember:DS.slate}`,
        boxShadow:winner==='player'?`0 0 32px ${DS.voltage}66`:winner==='ai'?`0 0 32px ${DS.ember}55`:'none',
        animation:'popIn 0.4s cubic-bezier(.34,1.6,.64,1)'}}>
        <div style={{fontFamily:F.display,fontSize:42,letterSpacing:'0.04em',
          color:winner==='player'?DS.voltage:winner==='ai'?DS.ember:DS.slate}}>
          {winner==='player'?'YOU WIN!':winner==='ai'?'OPPONENT WINS.':'TIE'}
        </div>
        {points>0&&<div style={{fontFamily:F.mono,fontSize:20,color:DS.frost,marginTop:4}}>
          +{points} POINT{points>1?'S':''}
        </div>}
      </div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
          {(playerCards||[]).map((c,i)=>(
            <div key={c.id} style={{animation:`slideUp 0.3s ease ${i*.07}s both`,
              filter:playerBestIds&&!playerBestIds.has(c.id)?'brightness(0.35) saturate(0.3)':'',
              transition:'filter 0.4s'}}>
              <PlayingCard card={c} size="normal" isScrap={false} wiggle={winner==='player'&&(!playerBestIds||playerBestIds.has(c.id))}/>
            </div>
          ))}
        </div>
        <div style={{fontFamily:F.display,fontSize:26,color:winner==='player'?DS.voltage:DS.slate,letterSpacing:'0.06em'}}>{playerHandName}</div>
        <div style={{fontFamily:F.ui,fontSize:17,color:DS.slate,letterSpacing:'0.14em',fontWeight:700}}>YOU</div>
      </div>
      <button onClick={onDismiss} style={{background:DS.voltage,color:DS.ink,border:'none',
        padding:'13px 40px',borderRadius:8,cursor:'pointer',fontFamily:F.ui,
        fontWeight:700,fontSize:17,letterSpacing:'0.1em',textTransform:'uppercase',
        boxShadow:`0 0 20px ${DS.voltage}88`}}>Continue →</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FullScrapLightbox — elaborate celebration
// ─────────────────────────────────────────────────────────────
function FullScrapLightbox({ onDone }) {
  const canvasRef=useRef();
  const [phase,setPhase]=useState(0); // 0=fireworks, 1=text
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d');
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    const pts=[]; const cols=[DS.voltage,DS.ember,DS.frost,DS.slateLight,'#fff','#ff99cc','#ccff66'];
    function burst(x,y,n=100){
      for(let i=0;i<n;i++){
        const a=(Math.PI*2/n)*i+Math.random()*.4,s=3+Math.random()*9;
        pts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-3,
          color:cols[Math.floor(Math.random()*cols.length)],
          life:1,decay:.006+Math.random()*.006,size:3+Math.random()*5});
      }
    }
    const positions=[[.25,.25],[.75,.2],[.5,.15],[.15,.5],[.85,.45],[.4,.6],[.65,.55],[.5,.35]];
    positions.forEach(([x,y],i)=>setTimeout(()=>burst(canvas.width*x,canvas.height*y,120),i*250));
    setTimeout(()=>setPhase(1),600);
    let raf;
    function draw(){
      ctx.fillStyle='rgba(28,28,40,0.1)';ctx.fillRect(0,0,canvas.width,canvas.height);
      for(let i=pts.length-1;i>=0;i--){
        const p=pts[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.08;p.life-=p.decay;
        if(p.life<=0){pts.splice(i,1);continue;}
        ctx.globalAlpha=p.life;ctx.fillStyle=p.color;
        ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1;
      raf=requestAnimationFrame(draw);
    }
    raf=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(raf);
  },[]);

  return (
    <div style={{position:'fixed',inset:0,zIndex:200}}>
      <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
      {phase===1&&(
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
          justifyContent:'center',flexDirection:'column',gap:20,padding:24}}>
          <div style={{
            fontFamily:F.display,
            fontSize:'clamp(56px,13vw,112px)',
            color:DS.voltage,
            textShadow:`0 0 40px ${DS.voltage},0 0 80px ${DS.voltage}88`,
            animation:'fullScrapPop 0.5s cubic-bezier(.34,1.8,.64,1)',
            letterSpacing:'0.04em',whiteSpace:'nowrap',textAlign:'center',
          }}>FULL SCRAP!</div>
          <div style={{
            background:DS.inkLight,border:`3px solid ${DS.voltage}`,
            borderRadius:16,padding:'24px 40px',textAlign:'center',
            boxShadow:`0 0 40px ${DS.voltage}55`,
            animation:'slideUp 0.4s ease 0.2s both',
          }}>
            <div style={{fontFamily:F.ui,color:DS.frost,fontSize:22,fontWeight:700,lineHeight:1.6}}>
              You won both small hands<br/>and the Scraps hand!
            </div>
            <div style={{fontFamily:F.display,color:DS.voltage,fontSize:36,
              letterSpacing:'0.08em',marginTop:12}}>
              ENJOY THIS BONUS POINT!
            </div>
            <div style={{fontFamily:F.mono,color:DS.voltage,fontSize:28,marginTop:6}}>
              +5 TOTAL
            </div>
          </div>
          <button onClick={onDone} style={{
            background:DS.voltage,color:DS.ink,border:'none',
            padding:'16px 52px',borderRadius:10,cursor:'pointer',
            fontFamily:F.ui,fontWeight:700,fontSize:19,
            letterSpacing:'0.1em',textTransform:'uppercase',
            boxShadow:`0 0 28px ${DS.voltage}88`,
            animation:'slideUp 0.4s ease 0.4s both',
          }}>Let's Go! →</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// WinScreen — elaborate fireworks
// ─────────────────────────────────────────────────────────────
function WinScreen({ playerScore, aiScore, onNewGame }) {
  const canvasRef=useRef();
  const [textPhase,setTextPhase]=useState(0);
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d');
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    const pts=[]; const cols=[DS.voltage,DS.ember,DS.frost,DS.slateLight,'#fff','#ff99cc','#ccff66','#99ccff'];
    function burst(x,y,n=120){
      for(let i=0;i<n;i++){
        const a=(Math.PI*2/n)*i+Math.random()*.4,s=3+Math.random()*10;
        pts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-3,
          color:cols[Math.floor(Math.random()*cols.length)],
          life:1,decay:.004+Math.random()*.005,size:3+Math.random()*6});
      }
    }
    // Continuous bursts
    let burstInterval=setInterval(()=>{
      burst(Math.random()*canvas.width, Math.random()*canvas.height*.7);
    },400);
    setTimeout(()=>clearInterval(burstInterval),8000);
    // Initial burst wave
    [[.5,.3],[.2,.4],[.8,.35],[.35,.25],[.65,.28]].forEach(([x,y],i)=>
      setTimeout(()=>burst(canvas.width*x,canvas.height*y),i*200));
    setTimeout(()=>setTextPhase(1),500);
    let raf;
    function draw(){
      ctx.fillStyle='rgba(28,28,40,0.08)';ctx.fillRect(0,0,canvas.width,canvas.height);
      for(let i=pts.length-1;i>=0;i--){
        const p=pts[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.06;p.life-=p.decay;
        if(p.life<=0){pts.splice(i,1);continue;}
        ctx.globalAlpha=p.life;ctx.fillStyle=p.color;
        ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1;
      raf=requestAnimationFrame(draw);
    }
    raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);clearInterval(burstInterval);};
  },[]);

  const lines=['YOU WIN!','YOU WIN!','WOW.','HOLY COW.','YOU DID IT!'];

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:DS.dusk}}>
      <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
        justifyContent:'center',flexDirection:'column',gap:16,padding:24}}>
        {textPhase>=1&&(
          <>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              {lines.map((l,i)=>(
                <div key={i} style={{
                  fontFamily:F.display,
                  fontSize:i<=1?'clamp(52px,12vw,100px)':i===2?'clamp(40px,9vw,80px)':'clamp(36px,8vw,72px)',
                  color:i===0||i===1?DS.voltage:i===2?DS.ember:DS.frost,
                  textShadow:`0 0 30px ${i<=1?DS.voltage:DS.ember}`,
                  letterSpacing:'0.04em',lineHeight:1,
                  animation:`letterAppear 0.5s cubic-bezier(.34,1.6,.64,1) ${i*.12}s both`,
                }}>{l}</div>
              ))}
            </div>
            <div style={{fontFamily:F.mono,color:DS.slate,fontSize:20,
              animation:'slideUp 0.4s ease 0.7s both'}}>
              {playerScore} — {aiScore}
            </div>
            <div style={{display:'flex',gap:16,animation:'slideUp 0.4s ease 0.9s both'}}>
              <button onClick={onNewGame} style={{
                background:DS.voltage,color:DS.ink,border:'none',
                padding:'16px 48px',borderRadius:10,cursor:'pointer',
                fontFamily:F.ui,fontWeight:700,fontSize:18,
                letterSpacing:'0.1em',textTransform:'uppercase',
                boxShadow:`0 0 28px ${DS.voltage}88`,
              }}>NEW GAME</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LoseScreen
// ─────────────────────────────────────────────────────────────
function LoseScreen({ playerScore, aiScore, onNewGame }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:DS.dusk,
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:28}}>
      <SwirlBg/>
      <div style={{position:'relative',zIndex:1,textAlign:'center'}}>
        <div style={{fontFamily:F.display,fontSize:'clamp(56px,12vw,96px)',
          color:DS.ember,marginBottom:12,letterSpacing:'0.04em'}}>YOU LOSE.</div>
        <div style={{fontFamily:F.mono,color:DS.slate,fontSize:24,marginBottom:40}}>
          {playerScore} — {aiScore}
        </div>
        <button onClick={onNewGame} style={{background:DS.voltage,color:DS.ink,border:'none',
          padding:'15px 44px',borderRadius:10,cursor:'pointer',fontFamily:F.ui,
          fontWeight:700,fontSize:17,letterSpacing:'0.1em',textTransform:'uppercase',
          boxShadow:`0 0 24px ${DS.voltage}88`}}>NEW GAME</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AceCounterModal — prompt player to counter opponent's ace
// ─────────────────────────────────────────────────────────────
function AceCounterModal({ onCounter, onAllow }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:90,background:'rgba(26,26,46,.88)',
      display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{background:DS.duskMid,border:`3px solid ${DS.ember}`,
        borderRadius:16,padding:32,maxWidth:440,width:'100%',textAlign:'center',
        boxShadow:`0 0 40px ${DS.ember}66`}}>
        <div style={{fontFamily:F.display,fontSize:36,color:DS.ember,
          letterSpacing:'0.06em',marginBottom:14}}>OPPONENT PLAYS ACE!</div>
        <p style={{fontFamily:F.ui,color:DS.slateLight,fontSize:18,lineHeight:1.6,marginBottom:18}}>
          They will be able to discard any two cards from your Scraps pile.
        </p>
        <p style={{fontFamily:F.ui,color:DS.voltage,fontSize:18,fontWeight:700,
          marginBottom:28}}>You have an Ace. Do you want to counter?</p>
        <div style={{display:'flex',gap:16,justifyContent:'center'}}>
          <Btn variant="danger" onClick={onCounter}>Counter Their Ace ⚡</Btn>
          <Btn variant="ghost" onClick={onAllow}>Let It Happen</Btn>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NearWinBanner — shown when someone hits WIN_SCORE but needs +2
// ─────────────────────────────────────────────────────────────
function NearWinBanner({ playerScore, aiScore }) {
  const bothOver = playerScore >= WIN_SCORE && aiScore >= WIN_SCORE;
  const playerOver = playerScore >= WIN_SCORE && aiScore < WIN_SCORE;
  const aiOver = aiScore >= WIN_SCORE && playerScore < WIN_SCORE;
  if(!bothOver && !playerOver && !aiOver) return null;
  let msg;
  if(bothOver) msg=`Both players are at ${WIN_SCORE}+. Win by 2 — keep playing!`;
  else if(playerOver) msg=`You've hit ${WIN_SCORE}! Win by 2 to claim victory.`;
  else msg=`Opponent hit ${WIN_SCORE}. Win by 2 — no letting up!`;
  return (
    <div style={{padding:'6px 20px',background:DS.voltage+'22',
      border:`1px solid ${DS.voltage}66`,textAlign:'center',
      fontFamily:F.ui,fontSize:14,color:DS.voltage,fontWeight:700,
      letterSpacing:'0.06em',flexShrink:0}}>
      {msg}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Btn — JS hover to fix Vercel delay
// ─────────────────────────────────────────────────────────────
function Btn({ children, onClick, variant='primary', disabled=false, small=false }) {
  const [hov,setHov]=useState(false);
  const base={border:'none',cursor:disabled?'not-allowed':'pointer',
    fontFamily:F.ui,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',
    outline:'none',padding:small?'10px 20px':'14px 28px',
    fontSize:small?15:17,borderRadius:8,opacity:disabled?0.35:1};
  const V={
    primary:{background:hov&&!disabled?'#d4ff33':DS.voltage,color:DS.ink,boxShadow:disabled?'none':`0 0 20px ${DS.voltage}55`},
    ghost:{background:hov&&!disabled?DS.slate+'22':'transparent',color:DS.frost,border:`2px solid ${DS.slate}`},
    danger:{background:hov&&!disabled?'#ff6070':DS.ember,color:DS.frost,boxShadow:disabled?'none':`0 0 20px ${DS.ember}55`},
    muted:{background:DS.duskMid,color:DS.slate,border:`1px solid ${DS.slate}44`},
    green:{background:hov&&!disabled?DS.voltage+'22':'transparent',color:DS.voltage,border:`2px solid ${DS.voltage}`,boxShadow:disabled?'none':`0 0 14px ${DS.voltage}33`},
    sky:{background:hov&&!disabled?DS.slateLight:DS.slate,color:DS.ink},
    warning:{background:hov&&!disabled?DS.voltage+'33':'transparent',color:DS.voltage,border:`2px solid ${DS.voltage}88`},
  };
  return <button style={{...base,...V[variant]}}
    onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
    onClick={disabled?undefined:onClick}>{children}</button>;
}

// ─────────────────────────────────────────────────────────────
// GameLog
// ─────────────────────────────────────────────────────────────
function GameLog({ messages }) {
  const ref=useRef();
  useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[messages]);
  return (
    <div ref={ref} style={{height:72,overflowY:'auto',background:DS.dusk,
      borderTop:`1px solid ${DS.slate}22`,padding:'8px 20px',flexShrink:0}}>
      {messages.slice(-4).map((m,i,arr)=>(
        <div key={i} style={{fontFamily:F.mono,fontSize:14,lineHeight:1.5,
          color:i===arr.length-1?DS.frost:DS.slate,
          fontWeight:i===arr.length-1?700:400}}>{m}</div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RulesModal
// ─────────────────────────────────────────────────────────────
function RulesModal({ onClose }) {
  const rules=[
    {icon:'🃏',t:`Scraps is a game of twos: Two decks. Two players. Two games of Poker happening at two speeds. First to ${WIN_SCORE} points — win by 2.`},
    {icon:'✋',t:'Each round consists of two small hands (visible only to you) and one Scraps hand (face up for everyone).'},
    {icon:'🔄',t:'Each turn, trade in cards from your small hand to your Scraps pile, and pick up new cards. 2–9: one card. 10–K: two. Ace: three. Max seven.'},
    {icon:'♠', t:'After two small hands, play your best 5-card Scraps hand for 2 pts. Flushes are never allowed.'},
    {icon:'⚡',t:"Play an Ace to remove two of your opponent's Scraps cards. They can counter with their own Ace."},
    {icon:'🏆',t:'Win both small hands AND the Scraps hand in one round for a FULL SCRAP — 5 points total.'},
  ];
  return (
    <div style={{position:'fixed',inset:0,zIndex:100,background:'rgba(26,26,46,.94)',
      display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:DS.duskMid,
        border:`2px solid ${DS.slate}44`,borderRadius:16,padding:28,
        maxWidth:520,width:'100%',maxHeight:'84vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h2 style={{fontFamily:F.display,color:DS.voltage,fontSize:32,letterSpacing:'0.06em'}}>Rules</h2>
          <Btn small variant="ghost" onClick={onClose}>Close</Btn>
        </div>
        {rules.map((r,i)=>(
          <div key={i} style={{display:'flex',gap:14,alignItems:'flex-start',marginBottom:16}}>
            <span style={{fontSize:22,flexShrink:0,marginTop:2}}>{r.icon}</span>
            <div style={{fontFamily:F.ui,color:DS.slateLight,fontSize:16,lineHeight:1.65}}>{r.t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TutorialOverlay
// ─────────────────────────────────────────────────────────────
function TutorialOverlay({ step, onOk }) {
  if(!step) return null;
  return (
    <div style={{position:'fixed',top:0,left:0,right:0,zIndex:50,
      background:`linear-gradient(${DS.dusk} 82%,transparent)`,
      padding:'10px 18px 26px',pointerEvents:'none'}}>
      <div style={{maxWidth:680,margin:'0 auto',background:DS.duskMid,
        border:`2px solid ${DS.voltage}88`,borderRadius:12,
        padding:'16px 24px',pointerEvents:'all',
        boxShadow:`0 0 28px ${DS.voltage}33`}}>
        <div style={{fontFamily:F.ui,color:DS.voltage,fontSize:13,
          letterSpacing:'0.16em',marginBottom:8,fontWeight:700}}>{step.title.toUpperCase()}</div>
        <p style={{fontFamily:F.ui,color:DS.slateLight,fontSize:16,
          lineHeight:1.65,marginBottom:step.waitForOk?14:0}}>{step.instruction}</p>
        {step.waitForOk&&<Btn small onClick={onOk}>Got it →</Btn>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SwirlBg + AnimatedTitle
// ─────────────────────────────────────────────────────────────
function SwirlBg() {
  return (
    <div style={{position:'absolute',inset:0,overflow:'hidden',zIndex:0,pointerEvents:'none'}}>
      <svg style={{position:'absolute',inset:0,width:'100%',height:'100%'}} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="sg1"><stop offset="0%" stopColor={DS.voltage} stopOpacity=".35"/><stop offset="100%" stopColor={DS.voltage} stopOpacity="0"/></radialGradient>
          <radialGradient id="sg2"><stop offset="0%" stopColor={DS.ember} stopOpacity=".3"/><stop offset="100%" stopColor={DS.ember} stopOpacity="0"/></radialGradient>
          <radialGradient id="sg3"><stop offset="0%" stopColor={DS.slate} stopOpacity=".2"/><stop offset="100%" stopColor={DS.slate} stopOpacity="0"/></radialGradient>
          <filter id="sblur"><feGaussianBlur stdDeviation="50"/></filter>
        </defs>
        <g filter="url(#sblur)">
          <ellipse cx="30%" cy="40%" rx="40%" ry="35%" fill="url(#sg1)"><animate attributeName="cx" values="30%;55%;25%;30%" dur="10s" repeatCount="indefinite"/><animate attributeName="cy" values="40%;28%;58%;40%" dur="13s" repeatCount="indefinite"/></ellipse>
          <ellipse cx="70%" cy="60%" rx="38%" ry="32%" fill="url(#sg2)"><animate attributeName="cx" values="70%;45%;78%;70%" dur="12s" repeatCount="indefinite"/><animate attributeName="cy" values="60%;72%;42%;60%" dur="10s" repeatCount="indefinite"/></ellipse>
          <ellipse cx="50%" cy="20%" rx="32%" ry="30%" fill="url(#sg3)"><animate attributeName="cx" values="50%;32%;68%;50%" dur="14s" repeatCount="indefinite"/></ellipse>
        </g>
      </svg>
    </div>
  );
}
function AnimatedTitle() {
  return (
    <div style={{display:'flex',justifyContent:'center',gap:4,marginBottom:12}}>
      {'SCRAPS'.split('').map((l,i)=>(
        <span key={i} style={{fontFamily:F.display,fontSize:'clamp(80px,17vw,148px)',lineHeight:1,
          display:'inline-block',color:l==='A'?DS.voltage:DS.frost,
          textShadow:l==='A'?`0 0 30px ${DS.voltage}88,0 3px 0 rgba(0,0,0,.4)`:`0 3px 0 rgba(0,0,0,.4)`,
          animation:`letterAppear 0.5s cubic-bezier(.34,1.6,.64,1) ${i*.09}s both,letterBounce 2.8s ease-in-out ${i*.22+0.7}s infinite`}}>
          {l}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SplashScreen
// ─────────────────────────────────────────────────────────────
function SplashScreen({ onStart }) {
  const [page,setPage]=useState(0);
  const ov=[
    {icon:'🃏',text:`Scraps is a game of twos: Two decks. Two players. Two games of Poker happening at two speeds. First to ${WIN_SCORE} — win by 2.`},
    {icon:'✋',text:'Each round: two private small hands and one public Scraps hand.'},
    {icon:'🔄',text:'Trade cards from your small hand to grow your Scraps pile. Draw fresh cards. Trade-in values: 2–9 earns 1, 10–K earns 2, Ace earns 3. Max 7 cards.'},
    {icon:'♠', text:'After two small hands, play your best 5-card Scraps hand for 2 pts. Flushes are never allowed.'},
    {icon:'⚡',text:"Play an Ace to remove two of your opponent's Scraps cards. They can counter."},
    {icon:'🏆',text:'Win both small hands AND the Scraps hand for a FULL SCRAP — 5 points total.'},
  ];
  const SS=`
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Righteous&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes letterAppear{from{opacity:0;transform:translateY(44px) scale(.65) rotate(-4deg)}to{opacity:1;transform:translateY(0) scale(1) rotate(0deg)}}
    @keyframes letterBounce{0%,100%{transform:translateY(0)}35%{transform:translateY(-14px)}65%{transform:translateY(-4px)}}
    @keyframes suitsBounce{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
    *{box-sizing:border-box;margin:0;padding:0} body{background:${DS.dusk}}

  `;
  return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',
      justifyContent:'center',background:DS.dusk,padding:24,position:'relative',overflow:'hidden'}}>
      <SwirlBg/>
      <div style={{position:'relative',zIndex:1,maxWidth:600,width:'100%'}}>
        {page===0&&(
          <div style={{textAlign:'center',animation:'fadeUp .6s ease'}}>
            <div style={{fontFamily:F.display,fontSize:64,color:DS.slate,letterSpacing:'0.18em',
              marginBottom:10,animation:'suitsBounce 2s ease-in-out infinite'}}>♠ ♥ ♦ ♣</div>
            <AnimatedTitle/>
            <Btn onClick={()=>setPage(1)}>Rules</Btn>
          </div>
        )}
        {page===1&&(
          <div style={{animation:'fadeUp .4s ease'}}>
            <h2 style={{fontFamily:F.display,fontSize:44,color:DS.frost,marginBottom:22,
              textAlign:'center',letterSpacing:'0.06em'}}>RULES</h2>
            <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:28}}>
              {ov.map((item,i)=>(
                <div key={i} style={{display:'flex',gap:18,alignItems:'flex-start',
                  background:DS.duskMid,border:`1px solid ${DS.slate}33`,
                  borderRadius:10,padding:'12px 18px',
                  animation:`fadeUp .4s ease ${i*.07}s both`}}>
                  <span style={{fontSize:24,flexShrink:0}}>{item.icon}</span>
                  <span style={{fontFamily:F.ui,fontSize:17,color:DS.slateLight,
                    lineHeight:1.5,fontWeight:500}}>{item.text}</span>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:14,justifyContent:'center'}}>
              <Btn variant="ghost" onClick={()=>setPage(0)}>Back</Btn>
              <Btn onClick={()=>setPage(2)}>Play</Btn>
            </div>
          </div>
        )}
        {page===2&&(
          <div style={{animation:'fadeUp .4s ease',textAlign:'center'}}>
            <h2 style={{fontFamily:F.display,fontSize:44,color:DS.frost,marginBottom:10,letterSpacing:'0.06em'}}>READY?</h2>
            <p style={{fontFamily:F.ui,color:DS.slate,fontSize:18,marginBottom:28,fontWeight:500}}>Choose your path</p>
            <div style={{display:'flex',flexDirection:'column',gap:14,maxWidth:400,margin:'0 auto'}}>
              {[
                {id:'tutorial',label:'TUTORIAL HAND',desc:'Two minutes to learn everything.'},
                {id:'difficulty',label:'JUMP RIGHT IN',desc:'Start playing. Rules via the ? button anytime.'},
              ].map(opt=>(
                <div key={opt.id} className="menu-opt" onClick={()=>onStart(opt.id)}>
                  <div style={{fontFamily:F.ui,color:DS.frost,fontWeight:700,fontSize:17,marginBottom:5,letterSpacing:'0.06em'}}>{opt.label}</div>
                  <div style={{fontFamily:F.ui,color:DS.slate,fontSize:14,fontWeight:500}}>{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <style>{SS}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DifficultyPicker
// ─────────────────────────────────────────────────────────────
function DifficultyPicker({ onChoose, onBack }) {
  const opts=[
    {id:'easy',  label:'EASY',   desc:'Conservative. Never uses Aces. Good for learning.'},
    {id:'medium',label:'MEDIUM', desc:'Balanced. Uses Aces occasionally.'},
    {id:'hard',  label:'HARD',   desc:'Aggressive. Will sacrifice small hands to win Scraps.'},
  ];
  return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',
      justifyContent:'center',background:DS.dusk,padding:24,position:'relative',overflow:'hidden'}}>
      <SwirlBg/>
      <div style={{maxWidth:460,width:'100%',position:'relative',zIndex:1}}>
        <h2 style={{fontFamily:F.display,fontSize:44,color:DS.frost,marginBottom:10,
          textAlign:'center',letterSpacing:'0.06em'}}>DIFFICULTY</h2>
        <p style={{fontFamily:F.ui,color:DS.slate,fontSize:17,textAlign:'center',
          marginBottom:26,fontWeight:500}}>Affects how the opponent thinks — not the rules.</p>
        <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:22}}>
          {opts.map(o=>(
            <div key={o.id} className="diff-opt" onClick={()=>onChoose(o.id)}>
              <div style={{fontFamily:F.ui,color:DS.voltage,fontWeight:700,fontSize:18,marginBottom:5,letterSpacing:'0.06em'}}>{o.label}</div>
              <div style={{fontFamily:F.ui,color:DS.slateLight,fontSize:16,fontWeight:500}}>{o.desc}</div>
            </div>
          ))}
        </div>
        <div style={{textAlign:'center'}}>
          <div className="diff-opt" onClick={onBack}
            style={{display:'inline-block',padding:'10px 22px',
              fontFamily:F.ui,fontWeight:700,fontSize:15,
              letterSpacing:'0.1em',textTransform:'uppercase',color:DS.frost}}>Back</div>
        </div>
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Righteous&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:${DS.dusk}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GameScreen
// ─────────────────────────────────────────────────────────────
function GameScreen({ mode, difficulty, onExit }) {
  // Local wrapper: choose 2 most structurally important opponent scraps cards
  // This mirrors engine.js chooseAceTargets but accessible in component scope
  function chooseHardTargets(scraps) {
    if(scraps.length < 2) return scraps.slice(0,2);
    // Score each card: importance = rank drop if removed
    const scored = scraps.map(card => {
      const without = scraps.filter(c=>c.id!==card.id);
      const before = without.length>0 ? (evaluateBestHand(without,false)||{rank:-1}).rank : -1;
      const full = (evaluateBestHand(scraps,false)||{rank:-1}).rank;
      return { card, importance: Math.max(0,full-before), value: card.value };
    });
    scored.sort((a,b)=>b.importance!==a.importance?b.importance-a.importance:b.value-a.value);
    return [scored[0].card, scored[1].card];
  }

  const [deck,setDeck]                     = useState([]);
  const [playerHand,setPlayerHand]         = useState([]);
  const [aiHand,setAiHand]                 = useState([]);
  const [playerScraps,setPlayerScraps]     = useState([]);
  const [aiScraps,setAiScraps]             = useState([]);
  const [discard,setDiscard]               = useState([]);
  const [playerScore,setPlayerScore]       = useState(0);
  const [aiScore,setAiScore]               = useState(0);
  const [phase,setPhase]                   = useState('init');
  const [selected,setSelected]             = useState([]);
  const [scrapsDiscard,setScrapsDiscard]   = useState([]);
  const [pendingTrade,setPendingTrade]     = useState(null);
  const [scrapsOverflow,setScrapsOverflow] = useState(0);
  const [playerSignal,setPlayerSignal]     = useState(null);
  const [aiSignal,setAiSignal]             = useState(null);
  const [playerPlayed,setPlayerPlayed]     = useState(null);
  const [aiPlayed,setAiPlayed]             = useState(null);
  const [log,setLog]                       = useState(['Welcome to SCRAPS.']);
  const [showRules,setShowRules]           = useState(false);
  const [aceMode,setAceMode]               = useState(false);
  const [aceTargets,setAceTargets]         = useState([]);
  const [roundWins,setRoundWins]           = useState({player:0,ai:0});
  const [gameOver,setGameOver]             = useState(null); // 'player' | 'ai'
  const [signalLocked,setSignalLocked]     = useState(false);
  const [showFullScrap,setShowFullScrap]   = useState(false);
  const [currentTurn,setCurrentTurn]       = useState(0);
  const [revealData,setRevealData]         = useState(null);
  const [tutStep,setTutStep]               = useState(0);
  const [aiSignaledIds,setAiSignaledIds]   = useState(new Set());
  // Refs for card travel animation zones
  const playerHandRef    = useRef(null);
  const playerScrapsRef  = useRef(null);
  const discardRef       = useRef(null);
  const aiHandRef        = useRef(null);
  const aiScrapsRef      = useRef(null);
  const { launchFlight, FlightsOverlay } = useFlyingCards();
  // Ace counter state
  const [pendingAiAce,setPendingAiAce]     = useState(null); // {ace, targets} — waiting for player to counter/allow
  // Shake/fade animation state for ace plays
  const [scrapsShakeIds,setScrapsShakeIds] = useState(new Set());
  const [scrapsFadeIds,setScrapsFadeIds]   = useState(new Set());
  // Near-win banner
  const [showNearWin,setShowNearWin]       = useState(false);

  const [roundNum,setRoundNum]             = useState(1);
  const [showInterstitial,setShowInterstitial] = useState(false);
  const [dealingCards,setDealingCards]     = useState([]);
  const [fadingInIds,setFadingInIds]       = useState(new Set()); // cards currently fading in
  const tutStepData=mode==='tutorial'?TUTORIAL_STEPS[tutStep]:null;
  const addLog=useCallback(msg=>setLog(p=>[...p,msg]),[]);

  // Tutorial: auto-advance to next step matching current phase
  const tutAdvance = useCallback((trigger) => {
    if(mode!=='tutorial') return;
    setTutStep(prev => {
      const next = TUTORIAL_STEPS.findIndex((s,i) => i > prev && s.autoAdvanceOn === trigger);
      if(next !== -1) return next;
      // Also advance if current step has no waitForOk and matches phase
      return prev;
    });
  }, [mode]);

  // Phase-based tutorial step sync: when phase changes, find matching step
  useEffect(() => {
    if(mode!=='tutorial') return;
    setTutStep(prev => {
      // Find the first step whose phase matches current phase, at or after current step
      const next = TUTORIAL_STEPS.findIndex((s,i) => i >= prev && s.phase === phase);
      if(next !== -1 && next !== prev) return next;
      return prev;
    });
  }, [phase, mode]);

  useEffect(()=>{ startNewRound(false); },[]);

  function tagScraps(arr,t){ return arr.map(c=>({...c,eligibleForDiscard:c.turnAdded<t})); }

  function startNewRound(alternate) {
    let d=shuffle(createDeck());
    const deal=dealRound(d);
    let remainingDeck = deal.remainingDeck;
    let playerHand = deal.playerHand;
    let aiHand = deal.aiHand;
    let playerScrapsInit = deal.playerScraps;
    let aiScrapsInit = deal.aiScraps;

    if(mode==='tutorial' && !alternate) {
      // Guarantee player has exactly one Ace in starting hand
      const hasAce = playerHand.some(c=>c.rank==='A');
      if(!hasAce) {
        // Find an Ace in remaining deck or AI hand and swap it in
        const aceInDeck = remainingDeck.findIndex(c=>c.rank==='A');
        if(aceInDeck >= 0) {
          const ace = remainingDeck[aceInDeck];
          const swapOut = playerHand[playerHand.length - 1]; // swap last card out
          remainingDeck = [...remainingDeck.filter((_,i)=>i!==aceInDeck), swapOut];
          playerHand = [...playerHand.slice(0, -1), ace];
        }
      }
      // Set AI starting Scraps to two 5s (scripted for four-of-a-kind setup)
      // Find two 5s anywhere in the pool (remaining deck or AI scraps)
      const allFives = [
        ...remainingDeck.filter(c=>c.rank==='5'),
        ...aiScrapsInit.filter(c=>c.rank==='5'),
      ];
      if(allFives.length >= 2) {
        const fivesToUse = allFives.slice(0, 2);
        const fiveIds = new Set(fivesToUse.map(c=>c.id));
        // Remove these fives from deck/aiScraps, replace with the original aiScraps cards
        const origAiScraps = aiScrapsInit.filter(c=>!fiveIds.has(c.id));
        remainingDeck = remainingDeck.filter(c=>!fiveIds.has(c.id));
        // Put displaced aiScraps cards back into deck
        remainingDeck = [...origAiScraps, ...remainingDeck];
        aiScrapsInit = fivesToUse;
        // Also put 2 more 5s at top of remaining deck so AI can trade them in on turn 1a
        const moreFives = remainingDeck.filter(c=>c.rank==='5').slice(0, 2);
        if(moreFives.length === 2) {
          const moreFiveIds = new Set(moreFives.map(c=>c.id));
          remainingDeck = [
            ...moreFives,
            ...remainingDeck.filter(c=>!moreFiveIds.has(c.id))
          ];
        }
      }
    }

    setDeck(remainingDeck);
    setPlayerHand(playerHand);
    setAiHand(aiHand);
    setPlayerScraps(playerScrapsInit.map(c=>({...c,turnAdded:0,eligibleForDiscard:true})));
    setAiScraps(aiScrapsInit.map(c=>({...c,turnAdded:0,eligibleForDiscard:true})));
    setSelected([]); setScrapsDiscard([]); setPendingTrade(null); setScrapsOverflow(0);
    setPlayerSignal(null); setAiSignal(null); setPlayerPlayed(null); setAiPlayed(null);
    setAceMode(false); setAceTargets([]); setSignalLocked(false); setRevealData(null);
    setAiSignaledIds(new Set()); setPendingAiAce(null);
    setScrapsShakeIds(new Set()); setScrapsFadeIds(new Set());
    setCurrentTurn(1);
    // Show interstitial before dealing
    setShowInterstitial(true);
    // Phase stays at 'dealing' during interstitial — actual play starts after
    setPhase('dealing');
    if(alternate) setRoundNum(r=>r+1);
    else if(roundNum!==1) setRoundNum(r=>r+1);
  }

  // Called when interstitial finishes — start actual play
  function onInterstitialDone() {
    setShowInterstitial(false);
    setPhase('player-turn-1a');
    addLog('New round dealt. Your turn.');
  }

  // ── Win check after score change ──────────────────────────────
  function checkAndSetWin(nP, nA) {
    const winner = checkWin(nP, nA);
    if(winner) { setGameOver(winner); return true; }
    // Show near-win banner if either crossed threshold
    if(nP >= WIN_SCORE || nA >= WIN_SCORE) setShowNearWin(true);
    return false;
  }

  function toggleHandCard(card) {
    setSelected(prev=>prev.find(c=>c.id===card.id)?prev.filter(c=>c.id!==card.id):[...prev,card]);
  }
  function toggleScrapsDiscardCard(card) {
    if(!card.eligibleForDiscard) return;
    setScrapsDiscard(prev=>prev.find(c=>c.id===card.id)?prev.filter(c=>c.id!==card.id):[...prev,card]);
  }

  function doTradeIn() {
    if(selected.length===0) return;
    const drawCount=selected.reduce((s,c)=>s+tradeInValue(c),0);
    const netHand=(playerHand.length-selected.length)+drawCount;
    const newScrapsCount=playerScraps.length+selected.length;
    if(netHand>7){ addLog(`That trade would give you ${netHand} cards — over the 7-card limit.`); return; }
    if(newScrapsCount>7){
      const excess=newScrapsCount-7;
      setScrapsOverflow(excess);
      setPendingTrade({cards:[...selected],drawCount});
      setScrapsDiscard([]);
      setPlayerScraps(prev=>tagScraps(prev,currentTurn));
      addLog(`Select ${excess} card${excess>1?'s':''} to discard from your Scraps, then hit DISCARD.`);
      return;
    }
    executeTrade(selected,drawCount);
  }

  function executeTrade(tradeCards,drawCount) {
    // Launch visual animation (pure visual, no state dependency)
    const handEl   = playerHandRef.current;
    const scrapsEl = playerScrapsRef.current;
    if(handEl && scrapsEl) {
      const handRect   = handEl.getBoundingClientRect();
      const scrapsRect = scrapsEl.getBoundingClientRect();
      const cardW = 104, cardH = 146;
      const fromRect = { x: handRect.left + handRect.width/2 - cardW/2,
                         y: handRect.top  + handRect.height/2 - cardH/2,
                         width: cardW, height: cardH };
      const toRect   = { x: scrapsRect.left + scrapsRect.width/2 - cardW/2,
                         y: scrapsRect.top   + 10,
                         width: cardW, height: cardH };
      tradeCards.forEach((card, i) => {
        setTimeout(() => launchFlight(card, fromRect, toRect, true), i * 100);
      });
    }
    // All state updates at top level — NO nested setState calls
    const selIds = new Set(tradeCards.map(c=>c.id));
    const newScrapsCards = tradeCards.map(c=>({...c, turnAdded:currentTurn, eligibleForDiscard:false}));

    // 1. Remove traded cards from hand immediately
    setPlayerHand(prev => prev.filter(c => !selIds.has(c.id)));

    // 2. Add traded cards to scraps immediately
    setPlayerScraps(prev => [...prev, ...newScrapsCards]);

    // 3. Draw from deck — capture drawn cards synchronously using a ref snapshot
    //    NEVER call setPlayerHand inside setDeck — that causes the stale-closure bug
    setDeck(prev => {
      // Schedule drawn card appearances BEFORE returning — capture prev synchronously
      const drawn = prev.slice(0, drawCount);
      // Use closure-captured drawn array for scheduled appearance
      drawn.forEach((card, i) => {
        const delay = 950 + i * 200; // staggered, after scraps animation lands
        setTimeout(() => {
          // Top-level setState call — not nested inside another updater
          setPlayerHand(h => {
            if(h.some(c => c.id === card.id)) return h;
            return [...h, card];
          });
          setFadingInIds(ids => { const n = new Set(ids); n.add(card.id); return n; });
          setTimeout(() => {
            setFadingInIds(ids => { const n = new Set(ids); n.delete(card.id); return n; });
          }, 700);
        }, delay);
      });
      return prev.slice(drawCount);
    });
    setSelected([]);
    addLog(`Traded ${tradeCards.length} card(s) to Scraps. Drew ${drawCount}.`);
    setCurrentTurn(t=>t+1);
    tutAdvance('trade-complete');
    advancePlayer();
  }

  function confirmScrapsDiscard() {
    if(!pendingTrade||scrapsDiscard.length!==scrapsOverflow) return;
    // Launch visual animation only
    const scrapsEl  = playerScrapsRef.current;
    const discardEl = discardRef.current;
    if(scrapsEl && discardEl) {
      const scrapsRect  = scrapsEl.getBoundingClientRect();
      const discardRect = discardEl.getBoundingClientRect();
      const cardW = 80, cardH = 112;
      const fromRect = { x: scrapsRect.left + scrapsRect.width/2  - cardW/2,
                         y: scrapsRect.top  + scrapsRect.height/2 - cardH/2,
                         width: cardW, height: cardH };
      const toRect   = { x: discardRect.left + discardRect.width/2  - cardW/2,
                         y: discardRect.top  + discardRect.height/2 - cardH/2,
                         width: cardW, height: cardH };
      scrapsDiscard.forEach((card, i) => {
        setTimeout(() => launchFlight(card, fromRect, toRect, false), i * 100);
      });
    }
    // All state updates synchronous
    const discardIds = new Set(scrapsDiscard.map(c=>c.id));
    const {cards, drawCount} = pendingTrade;
    const tradeIds = new Set(cards.map(x=>x.id));
    const capturedDiscard = [...scrapsDiscard];
    setPlayerScraps(prev => [
      ...prev.filter(c => !discardIds.has(c.id)),
      ...cards.map(c=>({...c, turnAdded:currentTurn, eligibleForDiscard:false}))
    ]);
    setDeck(prev => {
      const drawn = prev.slice(0, drawCount);
      setPlayerHand(h => [...h.filter(c=>!tradeIds.has(c.id)), ...drawn]);
      return prev.slice(drawCount);
    });
    setDiscard(prev => [...prev, ...capturedDiscard]);
    setPendingTrade(null); setScrapsDiscard([]); setScrapsOverflow(0); setSelected([]);
    addLog(`Discarded ${capturedDiscard.length} from Scraps. Traded ${cards.length} card(s). Drew ${drawCount}.`);
    setCurrentTurn(t=>t+1);
    advancePlayer();
  }

  function cancelScrapsDiscard() {
    setPendingTrade(null); setScrapsDiscard([]); setScrapsOverflow(0); setSelected([]);
    addLog('Trade cancelled.');
  }

  function doPlayAce() {
    if(aiScraps.length<2){ addLog('Opponent needs at least 2 Scraps cards to target.'); return; }
    setAceMode(true); setAceTargets([]); setSelected([]);
    addLog("Select 2 cards from opponent's Scraps to remove.");
  }
  function toggleAceTarget(card) {
    setAceTargets(prev=>prev.find(c=>c.id===card.id)?prev.filter(c=>c.id!==card.id):prev.length<2?[...prev,card]:prev);
  }

  function confirmAce() {
    if(aceTargets.length!==2) return;
    const ace=playerHand.find(c=>c.rank==='A');
    // Animate the targeted cards before removing
    setScrapsShakeIds(new Set(aceTargets.map(c=>c.id)));
    setTimeout(()=>{
      setScrapsFadeIds(new Set(aceTargets.map(c=>c.id)));
      setTimeout(()=>{
        setPlayerHand(p=>p.filter(c=>c.id!==ace.id));
        setAiScraps(p=>p.filter(c=>!aceTargets.find(t=>t.id===c.id)));
        setDiscard(p=>[...p,ace,...aceTargets]);
        setAceMode(false); setAceTargets([]); setSelected([]);
        setScrapsShakeIds(new Set()); setScrapsFadeIds(new Set());
        addLog(`Ace played! Removed ${aceTargets.map(c=>c.rank+c.suit).join(', ')} from opponent's Scraps.`);
        tutAdvance('ace-played');
        setCurrentTurn(t=>t+1);
        advancePlayer();
      },500);
    },600);
  }

  // ── AI plays ace → show counter prompt if player has ace ────
  function handleAiAce(aiAce, aiHand, targetCards) {
    const playerHasAce = playerHand.some(c=>c.rank==='A');
    // Tutorial: AI never counters player Ace — but also AI doesn't play Ace in tutorial
    // This handles the rare case; in tutorial ai-turn-2a the AI just trades
    if(playerHasAce && playerScraps.length>=2 && mode!=='tutorial') {
      // Pause and ask player — don't reveal targets yet
      setPendingAiAce({ ace: aiAce, targets: targetCards });
    } else {
      // No player ace — animate and execute immediately
      setScrapsShakeIds(new Set(targetCards.map(c=>c.id)));
      addLog(`Opponent Ace! Targeting ${targetCards.map(c=>c.rank+c.suit).join(', ')} from your Scraps.`);
      setTimeout(()=>{
        setScrapsFadeIds(new Set(targetCards.map(c=>c.id)));
        setTimeout(()=>{
          setAiHand(h=>h.filter(c=>c.id!==aiAce.id));
          setPlayerScraps(p=>p.filter(c=>!targetCards.find(t=>t.id===c.id)));
          setDiscard(d=>[...d,aiAce,...targetCards]);
          setScrapsShakeIds(new Set()); setScrapsFadeIds(new Set());
          addLog(`Removed ${targetCards.map(c=>c.rank+c.suit).join(', ')} from your Scraps.`);
        },500);
      },700);
    }
  }

  function onPlayerCounterAce() {
    if(!pendingAiAce) return;
    const {ace: aiAce, targets} = pendingAiAce;
    const playerAce = playerHand.find(c=>c.rank==='A');
    // Player counters: AI's targets are NOT removed; both aces discarded
    // Player then picks 2 from opponent's scraps as counter
    setPlayerHand(p=>p.filter(c=>c.id!==playerAce.id));
    setAiHand(h=>h.filter(c=>c.id!==aiAce.id));
    setDiscard(d=>[...d,playerAce,aiAce]);
    setPendingAiAce(null);
    addLog('You counter the Ace! No Scraps removed. Both Aces discarded.');
    // Now let player pick 2 from opponent scraps
    if(aiScraps.length>=2){
      setAceMode(true); setAceTargets([]);
      addLog("Counter: Select 2 cards from opponent's Scraps to remove.");
    } else {
      setCurrentTurn(t=>t+1);
      advancePlayer(); // after ace chain resolves, advance
    }
  }

  function onPlayerAllowAce() {
    if(!pendingAiAce) return;
    const {ace: aiAce, targets} = pendingAiAce;
    // Execute AI ace
    setScrapsShakeIds(new Set(targets.map(c=>c.id)));
    setTimeout(()=>{
      setScrapsFadeIds(new Set(targets.map(c=>c.id)));
      setTimeout(()=>{
        setAiHand(h=>h.filter(c=>c.id!==aiAce.id));
        setPlayerScraps(p=>p.filter(c=>!targets.find(t=>t.id===c.id)));
        setDiscard(d=>[...d,aiAce,...targets]);
        setScrapsShakeIds(new Set()); setScrapsFadeIds(new Set());
        setPendingAiAce(null);
        addLog(`Allowed. ${targets.map(c=>c.rank+c.suit).join(', ')} removed from your Scraps.`);
      },500);
    },600);
  }

  // ── AI turn ──────────────────────────────────────────────────
  const doAiTurn=useCallback((currentPhase)=>{
    setTimeout(()=>{
      setAiHand(ah=>{ setAiScraps(as=>{ setPlayerScraps(ps=>{ setDeck(d=>{
        const action=aiDecide(ah,as,ps,d,difficulty,currentPhase,aiScore,playerScore);
        if(action.type==='trade'&&action.cards.length>0){
          const tIds=new Set(action.cards.map(c=>c.id));
          const drawN=action.cards.reduce((s,c)=>s+tradeInValue(c),0);
          const drawn=d.slice(0,drawN); const newD=d.slice(drawN);
          const newSC=as.length+action.cards.length;
          // Tutorial script override: on ai-turn-1a, trade the two 5s from top of hand
          if(mode==='tutorial' && (currentPhase==='ai-turn-1a')) {
            // Force trade of first two cards in AI hand (seeded to be 5s)
            const fivesInHand = ah.filter(c=>c.rank==='5').slice(0, 2);
            const fivesToTrade = fivesInHand.length >= 2 ? fivesInHand : action.cards;
            const fIds = new Set(fivesToTrade.map(c=>c.id));
            const fDraw = fivesToTrade.reduce((s,c)=>s+tradeInValue(c), 0);
            const fDrawn = d.slice(0, fDraw);
            const fnewD = d.slice(fDraw);
            setTimeout(()=>{
              setAiSignaledIds(new Set(fivesToTrade.map(c=>c.id)));
              setTimeout(()=>{
                setAiSignaledIds(new Set());
                setAiHand(h=>[...h.filter(c=>!fIds.has(c.id)),...fDrawn]);
                setAiScraps(s=>[...s,...fivesToTrade.map(c=>({...c,turnAdded:currentTurn,eligibleForDiscard:false}))]);
                addLog(`Opponent trades in two 5s — now has Four of a Kind!`);
              }, 800);
              return fnewD;
            }, 0);
            // Need to return the modified deck — use a hack via side effect
            // Actually skip the main trade block below by returning early here
            setTimeout(()=>{
              tutAdvance('ai-turn-complete');
              setPhase(prev=>{
                const m={'ai-turn-1a':'player-turn-1b'};
                return m[prev]||prev;
              });
            }, 1600);
            return d; // return original deck — the setTimeout above handles fnewD
          }
          // Animate AI selection: lift cards, then fly to scraps
          setAiSignaledIds(new Set(action.cards.map(c=>c.id)));
          // Launch flight animations after selection pause
          setTimeout(()=>{
            const aiHandEl   = aiHandRef.current;
            const aiScrapsEl = aiScrapsRef.current;
            if(aiHandEl && aiScrapsEl) {
              const handR   = aiHandEl.getBoundingClientRect();
              const scrapsR = aiScrapsEl.getBoundingClientRect();
              const cw=104, ch=146;
              const from = {x:handR.left+handR.width/2-cw/2, y:handR.top+handR.height/2-ch/2, width:cw, height:ch};
              const to   = {x:scrapsR.left+scrapsR.width/2-cw/2, y:scrapsR.top+10, width:cw, height:ch};
              action.cards.forEach((card,i) => setTimeout(()=>launchFlight(card,from,to,true), i*100));
            }
          }, 600);
          setTimeout(()=>{
            setAiSignaledIds(new Set());
            setAiHand(h=>[...h.filter(c=>!tIds.has(c.id)),...drawn]);
            if(newSC>7){
              setAiScraps(s=>{
                const el=s.filter(c=>c.eligibleForDiscard);
                const ex=newSC-7; const td=el.slice(0,ex);
                const dIds=new Set(td.map(c=>c.id));
                setDiscard(dsc=>[...dsc,...td]);
                return [...s.filter(c=>!dIds.has(c.id)),...action.cards.map(c=>({...c,turnAdded:currentTurn,eligibleForDiscard:false}))];
              });
            } else {
              setAiScraps(s=>[...s,...action.cards.map(c=>({...c,turnAdded:currentTurn,eligibleForDiscard:false}))]);
            }
            addLog(`Opponent traded ${action.cards.length} card(s) to Scraps.`);
          },800);
          return newD;
        } else if(action.type==='ace'){
          const ace=ah.find(c=>c.rank==='A');
          if(ace&&action.targetCards.length>=2){
            const tgts=action.targetCards.slice(0,2);
            setTimeout(()=>{ handleAiAce(ace, ah, tgts); },300);
          }
          return d;
        }
        return d;
      }); return ps; }); return as; }); return ah; });
      setTimeout(()=>{
        tutAdvance('ai-turn-complete');
        setPhase(prev=>{
          const m={'ai-turn-1a':'player-turn-1b','ai-turn-1b':'signal-player',
                   'ai-turn-2a':'player-turn-2b','ai-turn-2b':'signal-player-2'};
          return m[prev]||prev;
        });
      },1400);
    },800);
  },[difficulty,addLog,currentTurn,playerHand,playerScraps,aiScraps]);

  useEffect(()=>{
    if(['ai-turn-1a','ai-turn-1b','ai-turn-2a','ai-turn-2b'].includes(phase)) doAiTurn(phase);
  },[phase]);

  function advancePlayer() {
    setPhase(prev=>{
      const m={'player-turn-1a':'ai-turn-1a','player-turn-1b':'ai-turn-1b',
               'player-turn-2a':'ai-turn-2a','player-turn-2b':'ai-turn-2b'};
      return m[prev]||prev;
    });
  }

  function doSignal() {
    setSelected(cur=>{
      if(!isValidSignal(cur)) return cur;
      const sig=cur.length;
      setPlayerSignal(sig); setPlayerPlayed([...cur]); setSignalLocked(true);
      setTimeout(()=>{
        setAiHand(ah=>{
          const aiSig=aiChooseSignal(ah,sig,difficulty,aiScore,playerScore);
          const aiCards=getBestCardsForSignal(ah,aiSig)||[];
          setAiSignaledIds(new Set(aiCards.map(c=>c.id)));
          // Keep aiSignaledIds set — cards stay toggled until hand is revealed
          setTimeout(()=>{
            setAiSignal(aiSig); setAiPlayed(aiCards);
            addLog(`You signal ${sig}. Opponent signals ${aiSig}.`);
            tutAdvance('signal-complete');
            setPhase(prev=>prev==='signal-player'?'reveal-1':'reveal-2');
          },1000);
          return ah;
        });
      },700);
      return cur;
    });
  }

  function resolveSmallHand() {
    if(!playerPlayed||!aiPlayed) return;
    const pH=evaluateBestHand(playerPlayed,true);
    const aH=evaluateBestHand(aiPlayed,true);
    const res=compareHands(pH,aH);
    const rw={...roundWins};
    let winner='tie',pts=0;
    if(res>0){winner='player';pts=1;rw.player++;}
    else if(res<0){winner='ai';pts=1;rw.ai++;}
    const curPhase=phase;
    setRevealData({
      playerCards:[...playerPlayed],aiCards:[...aiPlayed],
      playerHandName:pH?.name||'',aiHandName:aH?.name||'',
      winner,points:pts,
      onContinue:()=>{
        setRevealData(null);
        const nP=playerScore+(winner==='player'?pts:0);
        const nA=aiScore+(winner==='ai'?pts:0);
        setPlayerScore(nP); setAiScore(nA);
        addLog(winner==='player'?`You win! ${pH.name}. +1 pt`:winner==='ai'?`Opponent wins. ${aH.name}. +1 pt`:'Tie.');
        setPlayerHand(p=>p.filter(c=>!playerPlayed.find(x=>x.id===c.id)));
        setAiHand(a=>a.filter(c=>!aiPlayed.find(x=>x.id===c.id)));
        setDiscard(d=>[...d,...playerPlayed,...aiPlayed]);
        setRoundWins(rw); setPlayerSignal(null); setAiSignal(null);
        setPlayerPlayed(null); setAiPlayed(null); setSelected([]); setSignalLocked(false);
        setAiSignaledIds(new Set()); // clear toggled AI cards after reveal
        // Check win after small hand
        if(checkAndSetWin(nP,nA)) return;
        setPhase(curPhase==='reveal-1'?'replenish':'scraps-reveal');
      }
    });
  }

  function doReplenish() {
    setPlayerHand(ph=>{ setAiHand(ah=>{ setDeck(d=>{
      const pN=Math.max(0,5-ph.length),aN=Math.max(0,5-ah.length);
      const drawn=d.slice(0,pN+aN);
      setTimeout(()=>{
        setPlayerHand(p=>[...p,...drawn.slice(0,pN)]);
        setAiHand(a=>[...a,...drawn.slice(pN,pN+aN)]);
        setPlayerScraps(s=>s.map(c=>({...c,eligibleForDiscard:true})));
        setAiScraps(s=>s.map(c=>({...c,eligibleForDiscard:true})));
      },0);
      addLog('Hands replenished. Second small hand begins.');
      setPhase('player-turn-2a'); setCurrentTurn(t=>t+1); setSelected([]);
      return d.slice(pN+aN);
    }); return ah; }); return ph; });
  }

  function resolveScrap() {
    const pB=evaluateBestHand(playerScraps,false);
    const aB=evaluateBestHand(aiScraps,false);
    if(!pB||!aB){ addLog('Not enough cards in Scraps.'); return; }
    const res=compareHands(pB,aB);
    let pPts=0,aPts=0; const rw={...roundWins}; let winner='tie';
    if(res>0){pPts=2;rw.player++;winner='player';}
    else if(res<0){aPts=2;rw.ai++;winner='ai';}
    const fullScrap=rw.player===3; const aiSweep=rw.ai===3;
    if(fullScrap) pPts++; if(aiSweep) aPts++;

    if(fullScrap){
      // Show Scraps reveal first, THEN Full Scrap lightbox
      const pBestIdsFS = new Set(getActiveHandCards(pB).map(c=>c.id));
      const aBestIdsFS = new Set(getActiveHandCards(aB).map(c=>c.id));
      setRevealData({
        playerCards:[...playerScraps].slice(0,7),aiCards:[...aiScraps].slice(0,7),
        playerHandName:pB.name,aiHandName:aB.name,
        winner:'player',points:2,
        playerBestIds:pBestIdsFS, aiBestIds:aBestIdsFS,
        onContinue:()=>{
          setRevealData(null);
          const nP=playerScore+pPts; const nA=aiScore+aPts;
          setPlayerScore(nP); setAiScore(nA); setRoundWins({player:0,ai:0});
          addLog(`FULL SCRAP! ${pB.name}. +${pPts} pts`);
          setShowFullScrap(true);
          setTimeout(()=>{ if(checkAndSetWin(nP,nA)){ return; } setPhase('round-end'); },100);
        }
      });
      return;
    }

    // Use getActiveHandCards to highlight ONLY the cards that form the best hand
    const pBestIds = new Set(getActiveHandCards(pB).map(c=>c.id));
    const aBestIds = new Set(getActiveHandCards(aB).map(c=>c.id));
    setRevealData({
      playerCards:[...playerScraps].slice(0,7),aiCards:[...aiScraps].slice(0,7),
      playerHandName:pB.name+(aiSweep?'':''),
      aiHandName:aB.name+(aiSweep?' 🏆 SWEEP':''),
      winner,points:winner==='player'?pPts:winner==='ai'?aPts:0,
      playerBestIds:pBestIds, aiBestIds:aBestIds,
      onContinue:()=>{
        setRevealData(null);
        const nP=playerScore+pPts,nA=aiScore+aPts;
        setPlayerScore(nP); setAiScore(nA); setRoundWins({player:0,ai:0});
        addLog(winner==='player'?`You win Scraps! ${pB.name}. +${pPts} pts`:winner==='ai'?`Opponent wins Scraps. +${aPts} pts`:'Scraps tied.');
        if(aiSweep) addLog('Opponent sweeps the round! +1 bonus pt.');
        if(checkAndSetWin(nP,nA)) return;
        setPhase('round-end');
      }
    });
  }

  // ── Derived ──────────────────────────────────────────────────
  const isPlayerTurn=['player-turn-1a','player-turn-1b','player-turn-2a','player-turn-2b'].includes(phase);
  const isSignal=phase==='signal-player'||phase==='signal-player-2';
  const isReveal=phase==='reveal-1'||phase==='reveal-2';
  const isAiThinking=['ai-turn-1a','ai-turn-1b','ai-turn-2a','ai-turn-2b'].includes(phase);
  const isScrapsDiscardMode=pendingTrade!==null;
  const selectedInHand=selected.filter(c=>playerHand.find(h=>h.id===c.id));
  const selIds=new Set(selectedInHand.map(c=>c.id));
  const aceTargetIds=new Set(aceTargets.map(c=>c.id));
  const scrapsDiscardIds=new Set(scrapsDiscard.map(c=>c.id));
  const selValid=isSignal&&!signalLocked&&isValidSignal(selectedInHand);
  const playerHasAce=playerHand.some(c=>c.rank==='A');
  const glowHand=(isPlayerTurn&&!aceMode&&!isScrapsDiscardMode)||(isSignal&&!signalLocked);
  const glowPlayerScraps=isScrapsDiscardMode;
  const glowOppScraps=aceMode;

  let hint='';
  if(pendingAiAce) hint='Opponent played an Ace. Counter or let it happen?';
  else if(isScrapsDiscardMode) hint=`Select ${scrapsOverflow} card${scrapsOverflow>1?'s':''} to discard from your Scraps, then hit DISCARD.`;
  else if(aceMode) hint=`Select 2 cards from opponent's Scraps to remove. (${aceTargets.length}/2 selected)`;
  else if(isPlayerTurn) hint=playerHasAce&&aiScraps.length>=2?'Select cards from your hand to trade in. Or play an Ace.':'Select cards from your hand to trade in.';
  else if(isSignal&&!signalLocked) hint='Toggle the cards you want to play — must be a valid poker hand. Hit SIGNAL.';
  else if(isSignal&&signalLocked) hint='Signal locked. Waiting for opponent...';
  else if(isReveal) hint='Both signals in. Reveal hands?';
  else if(isAiThinking) hint='Opponent is thinking...';
  else if(phase==='replenish') hint='Small hand scored. Deal the second hand?';
  else if(phase==='scraps-reveal') hint='Time to play the Scraps hand — best 5-card hand wins. Flushes never count.';
  else if(phase==='round-end') hint='Round complete. Ready for the next round?';

  const GS=`
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Righteous&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:${DS.dusk}}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${DS.slate}44}
    @keyframes glow{0%,100%{opacity:.45}50%{opacity:1}}
    @keyframes pulse{0%,100%{opacity:.65}50%{opacity:1}}
    @keyframes zonePulse{0%,100%{box-shadow:0 0 0 3px ${DS.voltage}44,0 0 16px ${DS.voltage}33}50%{box-shadow:0 0 0 5px ${DS.voltage}99,0 0 30px ${DS.voltage}66}}
    @keyframes fullScrapPop{from{opacity:0;transform:scale(.3) translateY(40px)}to{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes cardWiggle{0%{transform:rotate(-4deg) scale(1.04)}100%{transform:rotate(4deg) scale(1.06)}}
    @keyframes cardFadeIn{0%{opacity:0.1;transform:translateY(-12px) scale(0.92)}60%{opacity:0.9}100%{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes cardShake{0%{transform:translateX(-4px) rotate(-2deg)}50%{transform:translateX(4px) rotate(2deg)}100%{transform:translateX(-4px) rotate(-2deg)}}
    @keyframes slideDown{from{opacity:0;transform:translateY(-30px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
    @keyframes popIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
    @keyframes letterAppear{from{opacity:0;transform:translateY(44px) scale(.65) rotate(-4deg)}to{opacity:1;transform:translateY(0) scale(1) rotate(0deg)}}
    @keyframes letterBounce{0%,100%{transform:translateY(0)}35%{transform:translateY(-14px)}65%{transform:translateY(-4px)}}
    @keyframes suitsBounce{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
  `;

  if(gameOver) return (
    <>
      <style>{GS}</style>
      {gameOver==='player'
        ? <WinScreen playerScore={playerScore} aiScore={aiScore} onNewGame={()=>{ setGameOver(null); setPlayerScore(0); setAiScore(0); setRoundWins({player:0,ai:0}); setShowNearWin(false); onExit('difficulty'); }}/>
        : <LoseScreen playerScore={playerScore} aiScore={aiScore} onNewGame={()=>{ setGameOver(null); setPlayerScore(0); setAiScore(0); setRoundWins({player:0,ai:0}); setShowNearWin(false); onExit('difficulty'); }}/>
      }
    </>
  );

  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',
      background:DS.dusk,userSelect:'none',overflow:'auto'}}>
      <style>{GS}</style>
      <ScoreCorners playerScore={playerScore} aiScore={aiScore}/>
      {showNearWin&&<NearWinBanner playerScore={playerScore} aiScore={aiScore}/>}

      {/* Table */}
      <div style={{flex:1,display:'flex',flexDirection:'column',position:'relative',
        minHeight:0,overflow:'hidden',background:`radial-gradient(ellipse at 50% 40%,${DS.duskLight} 0%,${DS.dusk} 100%)`}}>

        {/* OPP Scraps — upper left */}
        <div ref={aiScrapsRef} style={{position:'absolute',top:12,left:12,zIndex:20,
          display:'flex',flexDirection:'column',gap:5,alignItems:'center'}}>
          <ScrapsZone cards={aiScraps} label="OPP" selectable={aceMode}
            selectedIds={aceTargetIds} onCardClick={toggleAceTarget}
            isOpponent={true} glowZone={glowOppScraps}
            shakeIds={new Set()} fadingIds={new Set()}
            slideRight={true}/>
          <BestHandBadge cards={aiScraps} allowFlush={false}/>
        </div>

        {/* Main table content */}
        <div style={{position:'relative',zIndex:1,flex:1,
          display:'flex',flexDirection:'column',alignItems:'center',
          padding:'10px 155px 100px 155px',gap:4,justifyContent:'space-around',
          minHeight:0,overflow:'hidden'}}>

          {/* Opponent hand */}
          <div ref={aiHandRef} style={{display:'flex',justifyContent:'center'}}>
            <FannedHand cards={aiHand} faceDown aiSignaledIds={aiSignaledIds}/>
          </div>

          {/* Discard pile — centered between the two hands */}
          <div ref={discardRef} style={{display:'flex',alignItems:'center',justifyContent:'center',
            flex:'0 0 auto',margin:'0 auto'}}>
            <DiscardPile count={discard.length}/>
          </div>

          {/* Player hand */}
          <div ref={playerHandRef} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
            <FannedHand
              cards={playerHand}
              selectedIds={selIds}
              fadingInIds={fadingInIds}
              tradeSelectedIds={isScrapsDiscardMode?selIds:new Set()}
              onCardClick={card=>{
                if(isScrapsDiscardMode||pendingAiAce) return;
                if((isPlayerTurn&&!aceMode)||(isSignal&&!signalLocked)) toggleHandCard(card);
              }}
              selectable={(isPlayerTurn&&!aceMode&&!isScrapsDiscardMode&&!pendingAiAce)||(isSignal&&!signalLocked)}
              activeWiggle={glowHand&&!pendingAiAce}
            />
            <BestHandBadge cards={playerHand} allowFlush={true}/>
          </div>
        </div>

        {/* Player Scraps — lower right, flush to wall */}
        <div ref={playerScrapsRef} style={{position:'absolute',bottom:12,right:0,zIndex:20,
          display:'flex',flexDirection:'column',gap:5,alignItems:'center',paddingRight:12}}>
          <BestHandBadge cards={playerScraps} allowFlush={false}/>
          <ScrapsZone
            cards={playerScraps.map(c=>({...c,eligibleForDiscard:isScrapsDiscardMode&&c.eligibleForDiscard}))}
            label="YOU"
            selectable={isScrapsDiscardMode}
            selectedIds={scrapsDiscardIds}
            onCardClick={toggleScrapsDiscardCard}
            discardMode={isScrapsDiscardMode}
            glowZone={glowPlayerScraps}
            shakeIds={new Set()} fadingIds={scrapsFadeIds}/>
        </div>

        {/* Round HUD + ? — bottom right of table */}
        <div style={{position:'absolute',bottom:12,right:160,zIndex:30,
          display:'flex',flexDirection:'row',alignItems:'flex-end',gap:8}}>
          <RoundProgressIndicator phase={phase}/>
          {mode==='jump'&&(
            <button onClick={()=>setShowRules(true)} style={{
              background:DS.voltage,border:'none',color:DS.ink,
              borderRadius:'50%',width:30,height:30,cursor:'pointer',
              fontFamily:F.ui,fontSize:15,fontWeight:900,
              boxShadow:`0 0 12px ${DS.voltage}88`,flexShrink:0,
              animation:'glow 3s ease-in-out infinite'}}>?</button>
          )}
        </div>
      </div>

      {/* Action panel — pushed down, full width */}
      <div style={{background:DS.duskMid,borderTop:`1px solid ${DS.slate}22`,
        padding:'12px 20px',display:'flex',flexDirection:'column',gap:8,
        boxShadow:'0 -2px 12px rgba(0,0,0,.4)',flexShrink:0}}>
        {/* Phase + hint */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
          <div style={{fontFamily:F.mono,fontSize:13,color:isAiThinking?DS.voltage:DS.slate,
            letterSpacing:'0.12em',fontWeight:700,flexShrink:0,
            animation:isAiThinking?'pulse 1s ease infinite':undefined}}>
            {phase.replace(/-/g,' ').toUpperCase()}
          </div>
          <div style={{fontFamily:F.ui,fontSize:16,
            color:isScrapsDiscardMode?DS.voltage:pendingAiAce?DS.ember:DS.slateLight,
            fontWeight:isScrapsDiscardMode||pendingAiAce?700:500,flex:1,textAlign:'center'}}>
            {hint}
          </div>
          <div style={{display:'flex',gap:12,alignItems:'center',flexShrink:0}}>
            {playerSignal&&<span style={{fontFamily:F.mono,color:DS.voltage,fontSize:13}}>SIGNAL: {playerSignal}</span>}
            {aiSignal&&<span style={{fontFamily:F.mono,color:DS.ember,fontSize:13}}>OPP: {aiSignal}</span>}
          </div>
        </div>
        {/* Buttons */}
        <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>
          {isScrapsDiscardMode&&(
            <>
              <Btn variant="warning" onClick={confirmScrapsDiscard} disabled={scrapsDiscard.length!==scrapsOverflow}>
                Discard ({scrapsDiscard.length}/{scrapsOverflow})
              </Btn>
              <Btn variant="ghost" onClick={cancelScrapsDiscard}>Cancel</Btn>
            </>
          )}
          {isPlayerTurn&&!aceMode&&!isScrapsDiscardMode&&!pendingAiAce&&(
            <>
              {/* In tutorial ace-force step, hide Trade In and only show Play Ace */}
              {!(tutStepData&&tutStepData.forceAce)&&(
                <Btn onClick={doTradeIn} disabled={selected.length===0} variant="primary">
                  Trade In{selected.length>0?` (${selected.length})`:''}
                </Btn>
              )}
              {playerHasAce&&aiScraps.length>=2&&(
                <Btn variant="danger" onClick={doPlayAce}>Play Ace ⚡</Btn>
              )}
              {tutStepData&&tutStepData.forceAce&&!playerHasAce&&(
                <span style={{fontFamily:'Space Grotesk',color:'#FF3D5A',fontSize:16,fontWeight:700}}>
                  No Ace in hand — trade-in active
                </span>
              )}
            </>
          )}
          {aceMode&&(
            <>
              <Btn variant="danger" onClick={confirmAce} disabled={aceTargets.length!==2}>
                Remove ({aceTargets.length}/2)
              </Btn>
              <Btn variant="ghost" onClick={()=>{setAceMode(false);setAceTargets([]);}}>Cancel</Btn>
            </>
          )}
          {isSignal&&!signalLocked&&(
            <Btn onClick={doSignal} disabled={!selValid} variant="green">
              Signal{selValid?` — ${selectedInHand.length} card${selectedInHand.length>1?'s':''}`:' (select a valid hand)'}
            </Btn>
          )}
          {isReveal&&<Btn onClick={resolveSmallHand} variant="sky">Reveal Hands</Btn>}
          {phase==='replenish'&&<Btn onClick={doReplenish} variant="primary">Deal Second Hand</Btn>}
          {phase==='scraps-reveal'&&<Btn onClick={resolveScrap} variant="primary">Play Scraps Hand</Btn>}
          {phase==='round-end'&&<Btn onClick={()=>startNewRound(true)} variant="primary">Next Round →</Btn>}
        </div>
      </div>

      <GameLog messages={log}/>

      {showRules&&<RulesModal onClose={()=>setShowRules(false)}/>}
      {mode==='tutorial'&&tutStepData&&<TutorialOverlay step={tutStepData} onOk={()=>setTutStep(i=>i+1)}/>}
      {revealData&&<RevealOverlay {...revealData} onDismiss={revealData.onContinue}
        playerBestIds={revealData.playerBestIds||null}
        aiBestIds={revealData.aiBestIds||null}/>}
      {showFullScrap&&<FullScrapLightbox onDone={()=>setShowFullScrap(false)}/>}
      <FlightsOverlay/>
      {showInterstitial&&<RoundInterstitial roundNum={roundNum} onDone={onInterstitialDone}/>}
      {pendingAiAce&&(
        <AceCounterModal
          onCounter={onPlayerCounterAce}
          onAllow={onPlayerAllowAce}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [screen,setScreen]=useState('splash');
  const [mode,setMode]=useState(null);
  const [difficulty,setDifficulty]=useState('medium');
  function handleStart(choice){
    if(choice==='tutorial'){setMode('tutorial');setScreen('game');}
    else setScreen('difficulty');
  }
  if(screen==='splash')     return <SplashScreen onStart={handleStart}/>;
  if(screen==='difficulty') return <DifficultyPicker onChoose={d=>{setDifficulty(d);setMode('jump');setScreen('game');}} onBack={()=>setScreen('splash')}/>;
  if(screen==='game')       return <GameScreen mode={mode} difficulty={difficulty} onExit={(dest)=>setScreen(dest==='difficulty'?'difficulty':'splash')}/>;
  return null;
}
