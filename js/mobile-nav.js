/* 手機底部工具列：保留既有功能，僅改變它們在手機上的入口。 */
function toggleMobileSearch(){
    const searchArea = document.querySelector(".search-area");
    const themePicker = document.querySelector(".theme-picker-bar");
    if(!searchArea) return;

    themePicker?.classList.remove("mobile-panel-open");
    searchArea.classList.toggle("mobile-search-open");
    document.getElementById("mobileThemeBtn")?.setAttribute("aria-expanded", "false");

    if(searchArea.classList.contains("mobile-search-open")){
        window.setTimeout(function(){ document.getElementById("searchInp")?.focus(); }, 120);
    }
}

function toggleMobileThemePanel(){
    const themePicker = document.querySelector(".theme-picker-bar");
    const searchArea = document.querySelector(".search-area");
    if(!themePicker) return;

    searchArea?.classList.remove("mobile-search-open");
    themePicker.classList.toggle("mobile-panel-open");
    document.getElementById("mobileThemeBtn")?.setAttribute(
        "aria-expanded", String(themePicker.classList.contains("mobile-panel-open"))
    );
}

function openMobileMap(){
    document.querySelector(".search-area")?.classList.remove("mobile-search-open");
    document.querySelector(".theme-picker-bar")?.classList.remove("mobile-panel-open");
    document.getElementById("mobileThemeBtn")?.setAttribute("aria-expanded", "false");
    openMapView();
}

function syncMobileFavoriteButton(){
    const button = document.getElementById("mobileFavBtn");
    if(!button) return;
    button.classList.toggle("is-active", showFavoritesOnly);
    button.setAttribute("aria-pressed", String(showFavoritesOnly));
    const icon = button.querySelector("i");
    if(icon) icon.className = showFavoritesOnly ? "bi bi-star-fill" : "bi bi-star";
}

document.addEventListener("DOMContentLoaded", function(){
    syncMobileFavoriteButton();
    document.querySelectorAll(".theme-swatch").forEach(function(swatch){
        swatch.addEventListener("click", function(){
            if(window.matchMedia("(max-width: 767px)").matches){
                document.querySelector(".theme-picker-bar")?.classList.remove("mobile-panel-open");
                document.getElementById("mobileThemeBtn")?.setAttribute("aria-expanded", "false");
            }
        });
    });
});
