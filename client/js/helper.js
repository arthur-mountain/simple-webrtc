const helpers = {
  storage: {
    set: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
    get: (key) => JSON.parse(sessionStorage.getItem(key)),
    remove: (key) => sessionStorage.removeItem(key),
    clear: () => sessionStorage.clear(),
  },
  log: (title, content) => {
    console.log(`*** ${title} ***`);
    console.log(content);
    console.log(`*** ${title} ***`, '\n');
  }
}

Object.keys(helpers).forEach(k => window[k] = helpers[k]);