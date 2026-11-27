const crypto = require('crypto');

const MAX_GENERATION = 5;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function encode(bytes, alphabet, length) {
    return Array.from(bytes.subarray(0, length), (byte) => alphabet[byte % alphabet.length]).join('');
}

// Generation 0 is the configured account. A zone where it is banned moves to generation 1, 2…: random-looking
// accounts derived from the configured password, the zone and the generation, so they survive restarts without storage.
function accountFor(zone, generation, username, password) {
    if (generation === 0) return { username, password };
    const digest = (label) => crypto.createHmac('sha256', password).update(`${label}:${zone}:${generation}`).digest();
    return {
        username: encode(digest('name'), ALPHABET.slice(0, 26), 1) + encode(digest('name').subarray(1), ALPHABET.slice(0, 26) + ALPHABET.slice(52), 11),
        password: encode(digest('password'), ALPHABET, 16),
    };
}

module.exports = { accountFor, MAX_GENERATION };
