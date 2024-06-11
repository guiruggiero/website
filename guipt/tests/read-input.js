// const prompt = require("prompt-sync")({ sigint: true });

import prompt from "prompt-sync";
const prompt_user = new prompt();

let input = "";

while (input != "quit") {
    input = prompt_user("Enter a command ('quit' to exit): ");
    console.log("You wrote: " + input + "\n");
}