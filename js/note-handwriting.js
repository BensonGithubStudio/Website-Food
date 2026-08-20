/* =============================================================
   note-handwriting.js — 店家卡片「備註」手寫動畫
   ---------------------------------------------------------------
   卡片顯示（進場動畫播完）之後，備註欄位會一個字一個字「寫」出來：
     - 中文字：用 HanziWriter 依真實筆順一筆一劃畫出來
     - 非中文（英數、標點、空白、換行）：用淡入的方式一個個接上去，
       因為這些字沒有筆順資料，硬套筆劃動畫也沒意義
   如果備註很長，逐筆畫播放會等太久，超過 LONG_NOTE_CHAR_LIMIT 時
   會自動切換成「全部淡入」模式，同時仍保留逐字的節奏感。
   若瀏覽器開啟「減少動態效果」，或 HanziWriter 資源載入失敗，
   則直接完整顯示備註文字，不強迫播放動畫。
============================================================= */
(function (global) {
    "use strict";

    /* =============================== 可調參數 ================================ */
    const CONFIG = {
        // 單一中文字的畫布大小（px）。備註字級是 15px，稍微放大一點筆劃動畫才看得清楚，
        // 用 vertical-align 讓它跟旁邊的文字對齊。
        CHAR_BOX: 22,
        // 筆劃畫出的速度倍率（HanziWriter 用語：數字越大畫得越快）
        STROKE_SPEED: 2.2,
        // 同一個字裡，每一筆畫之間的停頓（ms）
        DELAY_BETWEEN_STROKES: 60,
        // 寫完一個中文字之後，停頓多久才開始下一個字（ms）
        DELAY_BETWEEN_HANZI: 90,
        // 非中文字元（英數、標點）淡入間隔（ms），比中文快一些，念起來比較像打字
        DELAY_BETWEEN_PLAIN: 38,
        // 淡入動畫本身的時間（ms）
        PLAIN_FADE_DURATION: 140,
        // 備註超過這個字數，改用「快速全淡入」模式，避免逐筆畫播放要等太久
        LONG_NOTE_CHAR_LIMIT: 60,
        // 快速模式下，每個字的淡入間隔（ms）
        FAST_DELAY_BETWEEN_CHARS: 22
    };

    // 涵蓋常用中文字（含繁體、部分擴充區）的判斷範圍
    const CJK_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

    let hanziWriterLoadPromise = null;
    function loadHanziWriter() {
        if (global.HanziWriter) return Promise.resolve(global.HanziWriter);
        if (hanziWriterLoadPromise) return hanziWriterLoadPromise;

        hanziWriterLoadPromise = new Promise(function (resolve, reject) {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js";
            script.async = true;
            script.onload = function () {
                if (global.HanziWriter) resolve(global.HanziWriter);
                else reject(new Error("HanziWriter 載入後仍抓不到全域物件"));
            };
            script.onerror = function () {
                reject(new Error("HanziWriter 資源載入失敗（可能是網路被擋或 CDN 無法連線）"));
            };
            document.head.appendChild(script);
        });
        return hanziWriterLoadPromise;
    }

    function prefersReducedMotion() {
        return typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    /* 把備註內容登記到 note 元素上，先不畫出來，等真正要播放時（play）才處理，
       避免一次把還沒捲到畫面的卡片全部拿去載入筆順資料，浪費效能 */
    function setup(noteEl, text) {
        if (!noteEl) return;
        noteEl.textContent = "";
        noteEl.dataset.fullText = text || "";
        noteEl.dataset.played = "";
    }

    /* 依序處理字元佇列的小工具：next() 呼叫下一個，全部處理完呼叫 onDone */
    function runQueue(chars, stepFn, onDone) {
        let i = 0;
        function next() {
            if (i >= chars.length) {
                onDone && onDone();
                return;
            }
            const ch = chars[i++];
            stepFn(ch, next);
        }
        next();
    }

    function appendPlainChar(noteEl, ch, onStepDone) {
        if (ch === "\n") {
            noteEl.appendChild(document.createElement("br"));
            onStepDone();
            return;
        }
        const span = document.createElement("span");
        span.textContent = ch;
        span.style.opacity = "0";
        span.style.transition = "opacity " + CONFIG.PLAIN_FADE_DURATION + "ms ease-out";
        noteEl.appendChild(span);
        // 強制 reflow 一次，讓 transition 從 0 開始算，而不是被瀏覽器合併成直接顯示
        void span.offsetWidth;
        span.style.opacity = "1";
        setTimeout(onStepDone, CONFIG.DELAY_BETWEEN_PLAIN);
    }

    function appendFastChar(noteEl, ch, onStepDone) {
        if (ch === "\n") {
            noteEl.appendChild(document.createElement("br"));
            onStepDone();
            return;
        }
        const span = document.createElement("span");
        span.textContent = ch;
        span.style.opacity = "0";
        span.style.transition = "opacity " + CONFIG.PLAIN_FADE_DURATION + "ms ease-out";
        noteEl.appendChild(span);
        void span.offsetWidth;
        span.style.opacity = "1";
        setTimeout(onStepDone, CONFIG.FAST_DELAY_BETWEEN_CHARS);
    }

    function appendHanziChar(noteEl, ch, strokeColor, onStepDone) {
        const box = document.createElement("span");
        box.className = "note-hw-char";
        box.style.display = "inline-block";
        box.style.width = CONFIG.CHAR_BOX + "px";
        box.style.height = CONFIG.CHAR_BOX + "px";
        box.style.verticalAlign = "-5px";
        noteEl.appendChild(box);

        let writer;
        try {
            writer = new global.HanziWriter(box, ch, {
                width: CONFIG.CHAR_BOX,
                height: CONFIG.CHAR_BOX,
                padding: 1,
                showOutline: false,
                strokeColor: strokeColor,
                strokeAnimationSpeed: CONFIG.STROKE_SPEED,
                delayBetweenStrokes: CONFIG.DELAY_BETWEEN_STROKES
            });
        } catch (err) {
            // 這個字沒有筆順資料庫可用（極少見的罕用字），退回淡入顯示
            box.remove();
            appendPlainChar(noteEl, ch, onStepDone);
            return;
        }

        let settled = false;
        const finish = function () {
            if (settled) return;
            settled = true;
            setTimeout(onStepDone, CONFIG.DELAY_BETWEEN_HANZI);
        };

        writer.animateCharacter({
            onComplete: finish
        });
        // 保險：如果該字元的筆順資料抓不到（例如網路不穩），HanziWriter 有時不會呼叫
        // onComplete，這裡加一個逾時保底，確保動畫不會卡住不繼續
        setTimeout(finish, 2600);
    }

    function playFadeMode(noteEl, chars) {
        runQueue(chars, function (ch, next) {
            appendFastChar(noteEl, ch, next);
        });
    }

    function playStrokeMode(noteEl, chars) {
        const strokeColor = getComputedStyle(noteEl).color || "#6b5c4a";
        runQueue(chars, function (ch, next) {
            if (CJK_REGEX.test(ch)) {
                appendHanziChar(noteEl, ch, strokeColor, next);
            } else {
                appendPlainChar(noteEl, ch, next);
            }
        });
    }

    /* 真正開始播放。同一個 note 元素只會播放一次（避免卡片重複觸發） */
    function play(noteEl) {
        if (!noteEl || noteEl.dataset.played === "1") return;
        const text = noteEl.dataset.fullText || "";
        if (!text) return;
        noteEl.dataset.played = "1";

        if (prefersReducedMotion()) {
            noteEl.textContent = text;
            return;
        }

        const chars = Array.from(text);

        if (chars.length > CONFIG.LONG_NOTE_CHAR_LIMIT) {
            playFadeMode(noteEl, chars);
            return;
        }

        loadHanziWriter()
            .then(function () {
                playStrokeMode(noteEl, chars);
            })
            .catch(function (err) {
                console.warn("備註筆劃動畫改用淡入顯示：", err);
                playFadeMode(noteEl, chars);
            });
    }

    global.NoteHandwriting = { setup: setup, play: play };
})(window);
