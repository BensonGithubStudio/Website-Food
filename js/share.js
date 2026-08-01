/* =============================================================
   share.js — 分享功能
   內容：系統分享 API、分享面板、複製到剪貼簿
============================================================= */

/* =============================== 分享功能 ================================ */

/* 組成分享用的文字內容 */
function buildShareText(item){
    const lines = [];
    lines.push("🍽️ " + (item.name || "美食"));
    if(item.type) lines.push("🏷️ " + item.type);
    if(item.rating){
        let score = Number(item.rating);
        score = Math.min(Math.max(score,1),5);
        lines.push("⭐ " + "★".repeat(score) + "☆".repeat(5-score));
    }
    if(item.address){
        lines.push("📍 " + item.address);
        const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.address);
        lines.push("🗺️ 地圖連結：" + mapUrl);
    }
    if(item.note) lines.push("📝 " + item.note);
    if(item.link) lines.push("🔗 相關網頁：" + item.link);
    lines.push("");
    lines.push("— 來自美食口袋名單");
    return lines.join("\n");
}

/* 判斷是否為手機裝置（觸控為主的裝置），用來決定分享行為 */
function isMobileDevice(){
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
    const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    return uaMobile || coarsePointer;
}

/* 觸發瀏覽器原生的系統分享介面 */
function shareViaSystemAPI(item){
    if(!navigator.share) return Promise.reject(new Error("unsupported"));
    const shareData = { title: item.name || "美食口袋名單", text: buildShareText(item) };
    return navigator.share(shareData);
}

/* 分享按鈕點擊：手機先播放按鈕動畫、延遲 0.5 秒後開啟系統分享；電腦則開啟含連結的分享面板 */
function handleShareClick(item, btn){
    if(isMobileDevice()){
        if(btn) btn.classList.add("share-btn--active");
        if(navigator.share){
            setTimeout(function(){
                shareViaSystemAPI(item)
                    .catch(()=>{ /* 使用者取消分享時安靜地忽略 */ })
                    .finally(()=>{ if(btn) btn.classList.remove("share-btn--active"); });
            }, 500);
        } else {
            /* 極少數不支援 Web Share API 的手機瀏覽器，安靜複製一份完整資訊 */
            copyToClipboard(buildShareText(item), true);
            setTimeout(()=>{ if(btn) btn.classList.remove("share-btn--active"); }, 500);
        }
        return;
    }
    /* 電腦版：不喚起系統分享，直接顯示分享面板（複製所有資訊／地圖連結／相關網頁連結） */
    openShareModal(item);
}

/* 保險機制：當頁面從系統分享介面切回可見狀態時，確保分享按鈕都恢復原本樣式 */
document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible"){
        document.querySelectorAll(".share-btn--active").forEach(function(btn){
            btn.classList.remove("share-btn--active");
        });
    }
});

/* 建立並顯示電腦版分享面板（複製所有資訊／地圖連結／相關網頁連結） */
function openShareModal(item){
    closeShareModal();

    const overlay = document.createElement("div");
    overlay.className = "share-modal-overlay";
    overlay.id = "shareModalOverlay";
    overlay.onclick = function(e){
        if(e.target === overlay) closeShareModal();
    };

    const modal = document.createElement("div");
    modal.className = "share-modal";

    const header = document.createElement("div");
    header.className = "share-modal-header";
    header.innerHTML = `<span>分享「${escapeHtml(item.name || "美食")}」</span>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "share-modal-close";
    closeBtn.innerHTML = "✕";
    closeBtn.onclick = closeShareModal;
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = document.createElement("div");
    body.className = "share-modal-body";

    body.appendChild(buildShareLinkRow("📋", "所有美食資訊", buildShareText(item)));

    if(item.address){
        const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.address);
        body.appendChild(buildShareLinkRow("📍", "地圖連結", mapUrl));
    }

    if(item.link){
        body.appendChild(buildShareLinkRow("🔗", "相關網頁連結", item.link));
    }

    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add("open"));
}

/* 建立一列可複製的連結（圖示、標籤、連結文字、複製按鈕） */
function buildShareLinkRow(icon, label, url){
    const row = document.createElement("div");
    row.className = "share-link-row";

    const info = document.createElement("div");
    info.className = "share-link-info";
    info.innerHTML = `<span class="share-link-icon">${icon}</span>
        <span class="share-link-text">
            <span class="share-link-label">${label}</span>
            <span class="share-link-url">${escapeHtml(url)}</span>
        </span>`;
    row.appendChild(info);

    const copyBtn = document.createElement("button");
    copyBtn.className = "share-link-copy";
    copyBtn.textContent = "複製";
    copyBtn.onclick = function(){
        copyToClipboard(url, true);
        showCopiedFeedback(copyBtn);
    };
    row.appendChild(copyBtn);

    return row;
}

/* 在複製按鈕上直接顯示「已複製」文字回饋（面板背景模糊，toast 不易被看到，改用按鈕本身提示） */
function showCopiedFeedback(btn){
    clearTimeout(btn._copiedTimer);
    if(!btn.dataset.originalText){
        btn.dataset.originalText = btn.textContent;
    }
    btn.textContent = "已複製 ✓";
    btn.classList.add("copied");
    btn.disabled = true;
    btn._copiedTimer = setTimeout(function(){
        btn.textContent = btn.dataset.originalText;
        btn.classList.remove("copied");
        btn.disabled = false;
    }, 1600);
}

/* 關閉電腦版分享面板 */
function closeShareModal(){
    const overlay = document.getElementById("shareModalOverlay");
    if(!overlay) return;
    overlay.classList.remove("open");
    setTimeout(()=>overlay.remove(), 200);
}

/* Esc 鍵關閉分享面板 */
document.addEventListener("keydown", function(e){
    if(e.key === "Escape") closeShareModal();
});

/* 複製文字到剪貼簿（含舊瀏覽器 fallback）。silent 為 true 時不彈出提示（手機分享時使用） */
function copyToClipboard(text, silent){
    if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text)
            .then(()=>{ if(!silent) showToast("已複製到剪貼簿 📋"); })
            .catch(()=>fallbackCopyToClipboard(text, silent));
    } else {
        fallbackCopyToClipboard(text, silent);
    }
}
function fallbackCopyToClipboard(text, silent){
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try{
        document.execCommand("copy");
        if(!silent) showToast("已複製到剪貼簿 📋");
    } catch(e){
        if(!silent) showToast("複製失敗，請手動複製");
    }
    document.body.removeChild(ta);
}
