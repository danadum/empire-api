// Preloaded into server.js by server.test.js: the 10-minute loop runs every 50 ms, and the network config is
// served once (one E4K zone on a closed local port, GGE skips EmpireEx_23), then every fetch fails.
const realSetInterval = global.setInterval;
global.setInterval = (callback, ms, ...args) => realSetInterval(callback, ms === 10 * 60 * 1000 ? 50 : ms, ...args);
let served = 0;
global.fetch = async () => {
    if (served++ >= 11) throw new Error('fetch failed');
    const instance = '<instance value="1"><server>127.0.0.1:1</server><zone>EmpireEx_23</zone></instance>';
    return { text: async () => `<network><instances>${instance}</instances></network>` };
};
