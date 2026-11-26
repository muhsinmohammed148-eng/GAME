(() => {
  'use strict';

  const WIDTH = 640;
  const HEIGHT = 760;
  const SPIT_SPEED = 14;
  const SPIT_HIT_RADIUS = 34;
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const startButton = document.querySelector('#start-button');
  const swatButton = document.querySelector('#swat-button');
  const muteButton = document.querySelector('#mute-button');
  const shareButton = document.querySelector('#share-button');
  const shareStatus = document.querySelector('#share-status');
  const center = { x: WIDTH / 2, y: HEIGHT / 2 + 40 };
  const normalImage = { value: null };
  const spitImage = { value: null };

  let state = 'START';
  let score = 0;
  let bestScore = readBestScore();
  let hp = 100;
  let combo = 0;
  let muted = false;
  let danishShake = 0;
  let danishScale = 1;
  let spitAnimTimer = 0;
  let spawnTimer = 0;
  let lastFrameTime = 0;
  let pointer = { x: center.x, y: center.y, inside: false };
  let spits = [];
  let mosquitoes = [];
  let splats = [];
  let popups = [];
  let splashRings = [];

  const randomBetween = (min, max) => min + Math.random() * (max - min);

  function readBestScore() {
    try {
      return Number(localStorage.getItem('danish-mosquito-best')) || 0;
    } catch {
      return 0;
    }
  }

  function saveBestScore() {
    try {
      localStorage.setItem('danish-mosquito-best', String(bestScore));
    } catch {
      // The game still works when browser storage is unavailable.
    }
  }

  async function loadSticker(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    const bytes = await response.arrayBuffer();
    // The supplied sticker files have JPEG data despite their .png filenames.
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const source = document.createElement('canvas');
    source.width = image.width;
    source.height = image.height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0);
    image.close();

    const pixels = sourceContext.getImageData(0, 0, source.width, source.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i] >= 238 && pixels.data[i + 1] >= 238 && pixels.data[i + 2] >= 238) {
        pixels.data[i + 3] = 0;
      }
    }
    sourceContext.putImageData(pixels, 0, 0);

    const sticker = document.createElement('canvas');
    sticker.width = 136;
    sticker.height = 136;
    sticker.getContext('2d').drawImage(source, 0, 0, sticker.width, sticker.height);
    return sticker;
  }

  function loadImages() {
    loadSticker('sree.png').then((image) => { normalImage.value = image; }).catch(() => {});
    loadSticker('sree.png').then((image) => { spitImage.value = image; }).catch(() => {});
  }

  function playSound(path, volume = 1) {
    if (muted) return;
    const sound = new Audio(path);
    sound.volume = volume;
    sound.play().catch(() => {});
  }

  function updateButtons() {
    startButton.hidden = state === 'PLAYING';
    startButton.textContent = state === 'START' ? 'Start game' : 'Play again';
    muteButton.textContent = muted ? 'Sound: Off' : 'Sound: On';
    muteButton.setAttribute('aria-pressed', String(muted));
  }

  function resetGame() {
    score = 0;
    hp = 100;
    combo = 0;
    danishShake = 0;
    danishScale = 1;
    spitAnimTimer = 0;
    spawnTimer = 0;
    spits = [];
    mosquitoes = [];
    splats = [];
    popups = [];
    splashRings = [];
    state = 'PLAYING';
    updateButtons();
  }

  function startGame() {
    if (state !== 'PLAYING') resetGame();
  }

  function fireSpit(targetX, targetY) {
    const angle = Math.atan2(targetY - (center.y + 12), targetX - center.x);
    const startX = center.x + Math.cos(angle) * 28;
    const startY = center.y + 12 + Math.sin(angle) * 24;
    const distance = Math.hypot(targetX - startX, targetY - startY) || 1;
    spits.push({
      x: startX,
      y: startY,
      vx: ((targetX - startX) / distance) * SPIT_SPEED,
      vy: ((targetY - startY) / distance) * SPIT_SPEED,
      angle,
      trail: [],
    });
    danishScale = 1.14;
    spitAnimTimer = 0.28;
    playSound('odada.mp3');
  }

  function addScore(points) {
    score += points;
    if (score > bestScore) {
      bestScore = score;
      saveBestScore();
    }
  }

  function triggerSwat(x, y) {
    if (state !== 'PLAYING') return;
    splashRings.push({ x, y, radius: 68, alpha: 210, color: '#ffdc3c' });
    danishScale = 1.12;
    let killed = 0;
    mosquitoes = mosquitoes.filter((mosquito) => {
      if (Math.hypot(mosquito.x - x, mosquito.y - y) <= 68 + mosquito.radius) {
        killed += 1;
        splats.push({ x: mosquito.x, y: mosquito.y, alpha: 210, radius: randomBetween(14, 22) });
        return false;
      }
      return true;
    });

    if (killed) {
      combo += killed;
      const points = killed * (10 + Math.min(combo * 2, 30));
      addScore(points);
      popups.push({ x, y: y - 10, text: combo < 2 ? `+${points}!` : `+${points} (x${combo} COMBO!)`, alpha: 255 });
    } else {
      combo = 0;
    }
  }

  function spawnMosquito(difficulty) {
    const side = Math.floor(Math.random() * 4);
    let x;
    let y;
    if (side === 0) { x = randomBetween(30, WIDTH - 30); y = -25; }
    else if (side === 1) { x = -25; y = randomBetween(60, HEIGHT - 60); }
    else if (side === 2) { x = WIDTH + 25; y = randomBetween(60, HEIGHT - 60); }
    else { x = randomBetween(30, WIDTH - 30); y = HEIGHT + 25; }
    mosquitoes.push({
      x,
      y,
      speed: randomBetween(1.4, 2.5) * difficulty,
      phase: randomBetween(0, Math.PI * 2),
      radius: 18,
    });
  }

  function update(dt) {
    const step = Math.min(dt * 60, 3);
    danishShake = Math.max(0, danishShake - dt * 35);
    danishScale += (1 - danishScale) * Math.min(1, dt * 12);
    spitAnimTimer = Math.max(0, spitAnimTimer - dt);

    if (state === 'PLAYING') {
      const difficulty = 1 + Math.min(score / 450, 1.6);
      const spawnInterval = Math.max(0.28, 1.05 / difficulty);
      spawnTimer += dt;
      if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        const count = score > 250 && Math.random() < 0.35 ? 2 : 1;
        for (let i = 0; i < count; i += 1) spawnMosquito(difficulty);
      }

      for (let i = spits.length - 1; i >= 0; i -= 1) {
        const spit = spits[i];
        spit.trail.push({ x: spit.x, y: spit.y });
        if (spit.trail.length > 5) spit.trail.shift();
        spit.x += spit.vx * step;
        spit.y += spit.vy * step;
        const hitIndex = mosquitoes.findIndex((mosquito) => Math.hypot(mosquito.x - spit.x, mosquito.y - spit.y) <= SPIT_HIT_RADIUS + mosquito.radius);
        if (hitIndex !== -1) {
          const [mosquito] = mosquitoes.splice(hitIndex, 1);
          spits.splice(i, 1);
          combo += 1;
          const points = 10 + Math.min(combo * 2, 30);
          addScore(points);
          splats.push({ x: mosquito.x, y: mosquito.y, alpha: 210, radius: randomBetween(14, 22) });
          splashRings.push({ x: mosquito.x, y: mosquito.y, radius: 14, alpha: 220, color: '#87e173' });
          popups.push({ x: mosquito.x, y: mosquito.y - 12, text: combo < 2 ? `SPIT +${points}!` : `SPIT +${points} (x${combo}!)`, alpha: 255 });
        } else if (spit.x < -40 || spit.x > WIDTH + 40 || spit.y < -40 || spit.y > HEIGHT + 40) {
          spits.splice(i, 1);
        }
      }

      for (let i = mosquitoes.length - 1; i >= 0; i -= 1) {
        const mosquito = mosquitoes[i];
        mosquito.phase += dt * 16;
        const dx = center.x - mosquito.x;
        const dy = center.y - mosquito.y;
        const distance = Math.hypot(dx, dy) || 1;
        const nx = dx / distance;
        const ny = dy / distance;
        const weave = Math.sin(mosquito.phase * 0.45) * 1.35;
        mosquito.x += (nx * mosquito.speed + -ny * weave * 0.45) * step;
        mosquito.y += (ny * mosquito.speed + nx * weave * 0.45) * step;
        if (Math.hypot(mosquito.x - center.x, mosquito.y - center.y) < 42) {
          mosquitoes.splice(i, 1);
          hp = Math.max(0, hp - 12);
          combo = 0;
          danishShake = 9;
          playSound('ayyo.mp3');
          popups.push({ x: center.x, y: center.y - 50, text: 'AYYO! -12 HP', alpha: 255 });
          if (hp <= 0) {
            state = 'GAMEOVER';
            updateButtons();
          }
        }
      }
    }

    splats = splats.filter((splat) => { splat.alpha -= 2.2 * step; return splat.alpha > 0; });
    splashRings = splashRings.filter((ring) => {
      ring.radius += 3.8 * step;
      ring.alpha -= 15 * step;
      return ring.alpha > 0;
    });
    popups = popups.filter((popup) => {
      popup.y -= 1.2 * step;
      popup.alpha -= 5 * step;
      return popup.alpha > 0;
    });
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, '#f5f0e1');
    gradient.addColorStop(1, '#dad0b8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = 'rgba(150, 135, 105, .28)';
    ctx.lineWidth = 1;
    for (let x = 0; x < WIDTH; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < HEIGHT; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
    }
  }

  function drawDanish(time) {
    const image = spitAnimTimer > 0 ? (spitImage.value || normalImage.value) : normalImage.value;
    const hoverY = center.y + (state === 'START' ? Math.sin(time * 0.006) * 5 : 0);
    const shakeX = randomBetween(-danishShake, danishShake);
    const shakeY = randomBetween(-danishShake, danishShake);
    const size = 136 * danishScale;
    if (image) {
      ctx.drawImage(image, center.x - size / 2 + shakeX, hoverY - size / 2 + shakeY, size, size);
      return;
    }
    ctx.fillStyle = '#dcb48c';
    ctx.strokeStyle = '#19191c';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(center.x + shakeX, hoverY + shakeY, 62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '58px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('😬', center.x + shakeX, hoverY + shakeY);
  }

  function drawMosquito(mosquito) {
    const flap = Math.sin(mosquito.phase * 2.2) * 4;
    ctx.fillStyle = 'rgba(220, 240, 255, .8)';
    ctx.beginPath(); ctx.ellipse(mosquito.x - 12, mosquito.y - 11 - flap * .3, 10, 5, -.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(mosquito.x + 5, mosquito.y - 12 - flap * .3, 10, 5, .4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#19191c'; ctx.lineWidth = 1.5;
    for (const leg of [-5, 0, 5]) {
      ctx.beginPath(); ctx.moveTo(mosquito.x + leg, mosquito.y + 4); ctx.lineTo(mosquito.x + leg - 5, mosquito.y + 13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mosquito.x + leg, mosquito.y - 4); ctx.lineTo(mosquito.x + leg + 5, mosquito.y - 12); ctx.stroke();
    }
    ctx.fillStyle = '#2d282a';
    ctx.beginPath(); ctx.ellipse(mosquito.x - 1, mosquito.y, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mosquito.x + 10, mosquito.y - 2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mosquito.x + 14, mosquito.y - 2); ctx.lineTo(mosquito.x + 23, mosquito.y + 1); ctx.stroke();
  }

  function drawHud() {
    ctx.fillStyle = '#1e2026';
    ctx.fillRect(18, 16, 210, 26);
    const hpColor = hp > 50 ? '#37af4b' : hp > 25 ? '#f5be23' : '#e1372d';
    if (hp > 0) {
      ctx.fillStyle = hpColor;
      ctx.fillRect(22, 20, 202 * (hp / 100), 18);
    }
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.fillText(`HP: ${hp}/100`, 28, 29);
    ctx.fillStyle = '#19191c'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Sound: ${muted ? 'OFF' : 'ON'} [M]`, 20, 62);
    ctx.textAlign = 'right';
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText(String(score), WIDTH - 24, 48);
  }

  function drawStartScreen() {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e1372d';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText('DANISH SPIT VS MOSQUITOES', WIDTH / 2, 82);
    ctx.fillStyle = '#19191c';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.fillText('Protect Danish from the swarm!', WIDTH / 2, HEIGHT - 112);
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText('Click or tap to spit · Right-click or use Swat to clear mosquitoes', WIDTH / 2, HEIGHT - 78);
    ctx.fillText('Survive as long as you can and build your combo!', WIDTH / 2, HEIGHT - 52);
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(255, 255, 255, .95)';
    ctx.strokeStyle = '#19191c';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(90, 200, WIDTH - 180, 270, 16); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e1372d';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText('SWARM OVERWHELMED!', WIDTH / 2, 255);
    ctx.fillStyle = '#19191c';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.fillText(`Score: ${score}   |   Best: ${bestScore}`, WIDTH / 2, 320);
    ctx.fillStyle = '#37af4b';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText('Click, tap, or press Play Again', WIDTH / 2, 390);
  }

  function draw(time) {
    drawBackground();
    for (const splat of splats) {
      ctx.globalAlpha = Math.max(0, splat.alpha / 255);
      ctx.fillStyle = '#8b2020';
      ctx.beginPath(); ctx.arc(splat.x, splat.y, splat.radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#af2323';
      ctx.beginPath(); ctx.arc(splat.x + 6, splat.y - 4, splat.radius / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawDanish(time);

    for (const spit of spits) {
      spit.trail.forEach((point, index) => {
        ctx.fillStyle = '#87e173';
        ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(2, (index + 1) * 1.4), 0, Math.PI * 2); ctx.fill();
      });
      ctx.save();
      ctx.translate(spit.x, spit.y);
      ctx.rotate(spit.angle);
      ctx.fillStyle = '#87e173'; ctx.strokeStyle = '#2a7330'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    mosquitoes.forEach(drawMosquito);
    for (const ring of splashRings) {
      ctx.globalAlpha = Math.max(0, ring.alpha / 255);
      ctx.strokeStyle = ring.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const popup of popups) {
      ctx.globalAlpha = Math.max(0, popup.alpha / 255);
      ctx.fillStyle = popup.text.includes('AYYO') ? '#e1372d' : '#19191c';
      ctx.font = 'bold 15px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(popup.text, popup.x, popup.y);
    }
    ctx.globalAlpha = 1;
    drawHud();

    if (state === 'PLAYING' && pointer.inside) {
      ctx.strokeStyle = '#2a7330'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#87e173'; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (state === 'START') drawStartScreen();
    if (state === 'GAMEOVER') drawGameOver();
  }

  function frame(time) {
    const dt = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.05) : 0;
    lastFrameTime = time;
    update(dt);
    draw(time);
    requestAnimationFrame(frame);
  }

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * WIDTH / bounds.width,
      y: (event.clientY - bounds.top) * HEIGHT / bounds.height,
    };
  }

  canvas.addEventListener('pointermove', (event) => {
    pointer = { ...canvasPoint(event), inside: true };
  });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const point = canvasPoint(event);
    pointer = { ...point, inside: true };
    if (state !== 'PLAYING') {
      startGame();
    } else if (event.button === 2) {
      triggerSwat(point.x, point.y);
    } else {
      fireSpit(point.x, point.y);
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  startButton.addEventListener('click', startGame);
  swatButton.addEventListener('click', () => triggerSwat(center.x, center.y));
  muteButton.addEventListener('click', () => {
    muted = !muted;
    updateButtons();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'm') {
      muted = !muted;
      updateButtons();
    } else if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      if (state !== 'PLAYING') startGame();
      else fireSpit(pointer.inside ? pointer.x : center.x, pointer.inside ? pointer.y : center.y);
    }
  });

  shareButton.addEventListener('click', async () => {
    const shareData = { title: document.title, text: 'Play Danish Spit vs Mosquitoes!', url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        shareStatus.textContent = 'Game link copied — send it to your friends!';
      } else {
        shareStatus.textContent = 'Copy this page address from your browser to share the game.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') shareStatus.textContent = 'Could not open sharing; copy the page address to share it.';
    }
  });

  loadImages();
  updateButtons();
  requestAnimationFrame(frame);
})();