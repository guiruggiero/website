const instruction = document.querySelector(".instruction");
const destination = document.querySelector(".destination");
const redirect = document.querySelector(".redirect");

document.addEventListener("DOMContentLoaded", () => {
    destination.addEventListener("pointerup", () => {
        setTimeout(() => {
            redirect.style.opacity = "1";
            redirect.style.pointerEvents = "auto";
            instruction.style.opacity = "0.5";
            destination.style.opacity = "0.5";
        }, 500);
    });
});