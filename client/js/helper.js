const helpers = {
  storage: {
    set: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
    get: (key) => JSON.parse(sessionStorage.getItem(key)),
    remove: (key) => sessionStorage.removeItem(key),
    clear: () => sessionStorage.clear(),
  },
  log: (title, ...contents) => {
    console.log(`********* [${title}] *********`);
    contents.forEach(c => console.log(c));
    console.log(`********* [${title}] *********`);
  }
}

Object.keys(helpers).forEach(k => window[k] = helpers[k]);