const instructions = document.querySelectorAll(".instruction");
const destination = document.querySelector(".destination");
const redirect = document.querySelector(".redirect");

destination.addEventListener("pointerup", () => {
    setTimeout(() => {
        redirect.style.opacity = "1";
        redirect.style.pointerEvents = "auto";
        instructions.forEach(instruction => {
            instruction.style.opacity = "0.3";
        });
        destination.style.opacity = "0.3";
    }, 500);
});