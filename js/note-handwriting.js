/* =============================================================
   note-handwriting.js — 店家卡片「備註」逐字淡入效果
   ---------------------------------------------------------------
   卡片顯示（進場動畫播完）之後，備註欄位會一個字一個字淡入出現，
   純前端效果，不依賴任何外部資源或 CDN。

   為了避免逐字顯示的過程中，欄位高度隨著文字變多慢慢被撐開（畫面跳動），
   開始播放前會先把完整文字「隱形」畫一次量出最終高度，鎖定成 min-height，
   再清空、逐字淡入；全部顯示完畢後才把鎖定的高度拿掉，讓欄位恢復自然排版
   （例如手機轉方向、視窗改變寬度時，還是能正常隨內容自動調整高度）。

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

    /* 把文字（可能含換行）直接、完整地畫進去，不做任何動畫。
       換行字元轉成 <br>，用來源自 textContent／createTextNode，不會有 XSS 疑慮 */
    function renderPlain(noteEl, text) {
        noteEl.textContent = "";
        const lines = text.split("\n");
        lines.forEach(function (line, idx) {
            if (idx > 0) noteEl.appendChild(document.createElement("br"));
            if (line) noteEl.appendChild(document.createTextNode(line));
        });
    }

    /* 量出最終高度並鎖定成 min-height（內容維持清空狀態）。
       只會實際量測一次：只要卡片一插入畫面就呼叫這個，讓瀏覽器「第一次畫出來」
       就已經是最終高度，之後才逐字淡入文字，就不會有第一幀跳動的感覺。
       play() 播放時也會呼叫一次，是保底：如果外部沒有主動呼叫過，這裡才補量。 */
    function reserveHeight(noteEl) {
        if (!noteEl || noteEl.dataset.heightReserved === "1") return;
        const text = noteEl.dataset.fullText || "";
        if (!text) return;
        noteEl.style.minHeight = "";
        renderPlain(noteEl, text);
        const height = noteEl.getBoundingClientRect().height;
        noteEl.style.minHeight = height + "px";
        noteEl.textContent = "";
        noteEl.dataset.heightReserved = "1";
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
            renderPlain(noteEl, text);
            return;
        }

        reserveHeight(noteEl);

        const chars = Array.from(text);
        let i = 0;
        function next() {
            if (i >= chars.length) {
                // 全部顯示完畢，拿掉鎖定的高度，讓欄位之後能隨版面寬度變化自然重排
                noteEl.style.minHeight = "";
                return;
            }
            const ch = chars[i++];
            appendChar(noteEl, ch, next);
        }
        next();
    }

    global.NoteHandwriting = { setup: setup, reserveHeight: reserveHeight, play: play };
})(window);
