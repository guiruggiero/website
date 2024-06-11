// const fs = require("node:fs");

import fs from "node:fs";

fs.readFile("../prompt.txt", "utf8", (err, data) => {
  if (err) {
    console.error(err);
    return;
  }
  
  console.log(data);
});