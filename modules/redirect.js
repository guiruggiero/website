const instruction = document.querySelector(".instruction");
const destination = document.querySelector(".destination");
const redirect = document.querySelector(".redirect");

destination.addEventListener("pointerup", () => {
    setTimeout(() => {
        redirect.style.opacity = "1";
        redirect.style.pointerEvents = "auto";
        instruction.style.opacity = "0.3";
        destination.style.opacity = "0.3";
    }, 500);
});