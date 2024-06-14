import { firebaseConfig } from "../../../secrets/guiruggiero.mjs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, doc, setDoc, Timestamp } from 'firebase/firestore/lite';
import prompt from "prompt-sync";

// Initializations
// console.log(firebaseConfig);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const prompt_user = new prompt();

const mode = "dev";
// const mode = "mvp";
// const mode = "v1";
// console.log("Mode: ", mode);

async function test() {
    console.log("Starting fake chat ('quit' to exit)");

    // Initializations
    let turn_count = 1;
    let user = prompt_user("User-" + turn_count + ": ");
    // console.log(user);

    const start = Timestamp.now();
    // console.log(start);
    // console.log(start.seconds);
    // console.log(start.toDate())

    let model = "";
    let end = Timestamp.now();

    let chat_data = {
        start: start.toDate(),
        // start_timestamp: start.seconds,
    };
    let turn_data = {};

    // Creates the chat document on Firestore
    const chat_ref = await addDoc(collection(db, mode), chat_data);
    // console.log("Document created with ID: ", chat_ref.id);

    while (user != "quit") {
        model = prompt_user("GuiPT-" + turn_count + ": ");
        // console.log(model);

        turn_data = {
            turn: turn_count,
            user: user,
            model: model,
        };
        // console.log(turn_data);

        // Creates the turn document on Firestore with a specific ID
        const turn_ref = doc(collection(db, mode, chat_ref.id, "turns"), `turn_${turn_count}`); // Set specific ID
        await setDoc(turn_ref, turn_data); 

        turn_count++;

        user = prompt_user("User-" + turn_count + ": ");
        // console.log(user);
        end = Timestamp.now(); // Here, the only way of exiting is quitting
    }

    chat_data = {
        end: end.toDate(),
        // end_timestamp: end.seconds,
        turn_count: turn_count - 1,
    };
    // console.log(chat_data);

    // Updates the chat document on Firestore
    await updateDoc(chat_ref, chat_data);

    console.log("Fake chat terminated");

}

test();