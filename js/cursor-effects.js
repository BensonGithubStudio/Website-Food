/* =============================================================
   cursor-effects.js — 滑鼠煙霧尾迹特效
   內容：FOOD_EMOJIS、initSmokeCursor()、spawnSmokeParticle()
============================================================= */

/* =============================== 滑鼠煙霧尾迹 ================================ */
const FOOD_EMOJIS = ["🍜","🍣","🍕","🍔","🍰","🍩","🍤","🥐","🍎","🍇","🍙","🧋"];

function initSmokeCursor(){
    // 只在「有滑鼠」的裝置上啟用（觸控裝置滑動屬於捲動，不需要這個效果），
    // 且尊重使用者的「減少動態效果」系統設定
    const hasFinePointer = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(!hasFinePointer || prefersReducedMotion) return;

    let lastX = null;
    let lastY = null;
    let lastSpawn = 0;
    let activeParticles = 0;
    const MAX_PARTICLES = 40;     // 同時存在的煙霧數量上限，避免效能問題
    const MIN_INTERVAL = 35;      // 兩次產生煙霧之間至少間隔的毫秒數
    const MIN_DISTANCE = 6;       // 滑鼠至少移動這麼多像素才產生新煙霧

    document.addEventListener("mousemove", function(e){
        const now = performance.now();
        if(lastX !== null){
            const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY);
            if(dist < MIN_DISTANCE || now - lastSpawn < MIN_INTERVAL) return;
        }
        lastX = e.clientX;
        lastY = e.clientY;
        lastSpawn = now;

        if(activeParticles >= MAX_PARTICLES) return;
        activeParticles++;
        spawnSmokeParticle(e.clientX, e.clientY, function(){
            activeParticles--;
        });
    }, { passive:true });
}

function spawnSmokeParticle(x, y, onDone){
    const particle = document.createElement("div");
    particle.className = "smoke-particle";
    particle.textContent = FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)];

    const size = 14 + Math.random() * 10;
    const offsetX = (Math.random() - 0.5) * 10;
    const offsetY = (Math.random() - 0.5) * 10;
    const drift = (Math.random() - 0.5) * 26; // 上升過程中的左右飄移幅度
    const rotate = (Math.random() - 0.5) * 50; // 上升過程中的旋轉角度

    particle.style.fontSize = size + "px";
    particle.style.setProperty("--sx", (x - size / 2 + offsetX) + "px");
    particle.style.setProperty("--sy", (y - size / 2 + offsetY) + "px");
    particle.style.setProperty("--dx", drift + "px");
    particle.style.setProperty("--rot", rotate + "deg");

    document.body.appendChild(particle);
    particle.addEventListener("animationend", function(){
        particle.remove();
        if(onDone) onDone();
    }, { once:true });
}
