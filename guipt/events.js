// Click to submit icon
submitButton.addEventListener("click", GuiPT);

// Enter key
inputElement.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
        GuiPT();
    }
});