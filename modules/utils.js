// modules/utils.js
function getScriptPath(baseName) {
  const isNgrok = window.location.href.includes("ngrok");
  if (isNgrok) {
    return `modules/${baseName}.js`;
  } else {
    return `modules/${baseName}.min.js`;
  }
}
