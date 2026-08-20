/* =============================================================
   note-handwriting.js — 店家卡片「備註」逐字淡入效果
   ---------------------------------------------------------------
   卡片顯示（進場動畫播完）之後，備註欄位會一個字一個字淡入出現，
   純前端效果，不依賴任何外部資源或 CDN。
   若瀏覽器開啟「減少動態效果」，則直接完整顯示備註文字，不強迫播放動畫。
============================================================= */
(function (global) {
    "use strict";

    /* =============================== 可調參數 ================================ */
    const CONFIG = {
        // 每個字之間的間隔（ms）
        DELAY_BETWEEN_CHARS: 45,
        // 單一字淡入動畫本身的時間（ms）
        FADE_DURATION: 160
    };

    function prefersReducedMotion() {
        return typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    /* 把備註內容登記到 note 元素上，先清空顯示內容，等真正要播放時（play）才逐字顯示 */
    function setup(noteEl, text) {
        if (!noteEl) return;
        noteEl.textContent = "";
        noteEl.dataset.fullText = text || "";
        noteEl.dataset.played = "";
    }

    function appendChar(noteEl, ch, onStepDone) {
        if (ch === "\n") {
            noteEl.appendChild(document.createElement("br"));
            onStepDone();
            return;
        }
        const span = document.createElement("span");
        span.textContent = ch;
        span.style.opacity = "0";
        span.style.transition = "opacity " + CONFIG.FADE_DURATION + "ms ease-out";
        noteEl.appendChild(span);
        // 強制 reflow 一次，讓 transition 從 0 開始算，而不是被瀏覽器合併成直接顯示
        void span.offsetWidth;
        span.style.opacity = "1";
        setTimeout(onStepDone, CONFIG.DELAY_BETWEEN_CHARS);
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
        let i = 0;
        function next() {
            if (i >= chars.length) return;
            const ch = chars[i++];
            appendChar(noteEl, ch, next);
        }
        next();
    }

    global.NoteHandwriting = { setup: setup, play: play };
})(window);
