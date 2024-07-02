// import * as functions from "firebase-functions";
const {onRequest} = require("firebase-functions/v2/https");

exports.helloWorld2gen = onRequest({cors: true}, (request, response) => {
  let name = request.query.name;
  if (!name) {
    name = "undefined";
  }

  console.log("name passed is " + name);
  response.send("Hello from GuiPT, " + name + "!");
});
