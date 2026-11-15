// The DOM HUD: health, ammo, money, round timer, score, alive counts, killfeed,
// crosshair, hit marker, damage flash, bomb bar and the buy menu. It never touches
// the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, BUY_ORDER } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    health: $('health-num'), healthBar: $('health-bar'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    money: $('money'), timer: $('timer'), score: $('score'), alive: $('alive'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), killfeed: $('killfeed'),
    damage: $('damage'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    bombBar: $('bomb-bar'), bombFill: $('bomb-fill'), bombLabel: $('bomb-label'),
    plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    buy: $('buy-menu'), buyMoney: $('buy-money'), buyList: $('buy-list'),
    weaponName: $('weapon-name'), grenades: $('grenades'), hint: $('hint'),
  };
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  const COPY = {
    start: { title: 'MERIDIAN YARD', copy: 'Round-based tactical FPS. Plant the spike at A or B, or eliminate Ember. Click to play.', action: 'Click to play' },
    paused: { title: 'MERIDIAN YARD', copy: 'Paused. Click to resume.', action: 'Click to resume' },
    matchEnd: { title: 'MATCH OVER', copy: '', action: 'Play again' },
  };

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp) {
      setText(els.health, 'hp', String(Math.max(0, Math.ceil(hp))));
      els.healthBar.style.width = `${Math.max(0, hp)}%`;
      els.healthBar.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, name) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', `/ ${reserve}`);
      setText(els.weaponName, 'wn', name);
      els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(m) { setText(els.money, 'money', `$${m}`); },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(els.timer, 't', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      els.timer.classList.toggle('danger', s <= 10);
      els.timer.classList.toggle('planted', !!planted);
    },
    setScore(v, e, round) {
      setText(els.score, 'score', `VANGUARD ${v} — ${e} EMBER · ROUND ${round}`);
    },
    setAlive(v, e) { setText(els.alive, 'alive', `▲ ${v}  ·  ▼ ${e}`); },
    setGrenades(n) { setText(els.grenades, 'g', `FRAG ×${n}`); },
    setCrosshairGap(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 120);
    },
    damageFlash() {
      els.damage.classList.add('on');
      setTimeout(() => els.damage.classList.remove('on'), 180);
    },
    addKill(killer, victim, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = `${killer} ${headshot ? '◉' : '✕'} ${victim}`;
      els.killfeed.prepend(line);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    },
    banner(title, sub, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { els.banner.hidden = true; }, ms);
    },
    hideBanner() { els.banner.hidden = true; },
    showBomb(seconds) {
      els.bombBar.hidden = false;
      els.bombFill.style.width = `${Math.max(0, (seconds / 35) * 100)}%`;
      setText(els.bombLabel, 'bomb', `SPIKE ${seconds.toFixed(1)}s`);
    },
    hideBomb() { els.bombBar.hidden = true; },
    showPlant(progress) {
      els.plantBar.hidden = false;
      els.plantFill.style.width = `${Math.min(100, progress * 100)}%`;
    },
    hidePlant() { els.plantBar.hidden = true; },
    setHint(text) { setText(els.hint, 'hint', text); },
    showOverlay(mode, extra = '') {
      const text = COPY[mode];
      els.title.textContent = text.title;
      els.copy.textContent = mode === 'matchEnd' ? extra : text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() { els.overlay.hidden = true; },
    onPlay(handler) { els.play.addEventListener('click', handler); },
    // Buy menu: rebuilt each time it opens; onBuy(id) returns true when bought.
    openBuy(money, owned, onBuy) {
      els.buyMoney.textContent = `$${money}`;
      els.buyList.innerHTML = '';
      for (const id of BUY_ORDER) {
        const w = WEAPONS[id];
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = owned.includes(id) || money < w.price;
        row.innerHTML = `<span class="buy-key">${BUY_ORDER.indexOf(id) + 1}</span><span class="buy-name">${w.name}</span><span class="buy-stat">${w.damage} dmg · ${w.mag} rnd</span><span class="buy-price">${w.price === 0 ? 'OWNED' : '$' + w.price}</span>`;
        row.addEventListener('click', () => onBuy(id));
        els.buyList.appendChild(row);
      }
      const grenadeRow = document.createElement('button');
      grenadeRow.type = 'button';
      grenadeRow.className = 'buy-row';
      grenadeRow.disabled = money < 300;
      grenadeRow.innerHTML = `<span class="buy-key">G</span><span class="buy-name">Frag Grenade</span><span class="buy-stat">blast damage</span><span class="buy-price">$300</span>`;
      grenadeRow.addEventListener('click', () => onBuy('grenade'));
      els.buyList.appendChild(grenadeRow);
      els.buy.hidden = false;
    },
    closeBuy() { els.buy.hidden = true; },
    refreshBuy(money, owned, onBuy) { this.openBuy(money, owned, onBuy); },
  };
}
