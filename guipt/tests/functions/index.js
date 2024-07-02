import * as functions from "firebase-functions";

export const helloWorld = functions.https.onRequest((request, response) => {
  let name = request.query.name;
  if (!name) {
    name = "undefined";
  }

  console.log("name passed is " + name);
  response.send("Hello from GuiPT, " + name + "!");
});
