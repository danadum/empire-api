const crypto = require('crypto');

const MAX_GENERATION = 5;
// The client itself treats a ban of 4 weeks or more as a long one (generic_login_banned); shorter ones are waited out.
const LONG_BAN = 28 * 24 * 60 * 60;
// Accounts created from one IP are what gets registration IP-banned (from the 3rd account on a server, 2024).
const MAX_REGISTRATIONS_PER_DAY = 2;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const registrations = [];

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

// One registration attempt, if fewer than MAX_REGISTRATIONS_PER_DAY were made by this process in the last 24 h.
function takeRegistration() {
    const now = Date.now();
    while (registrations.length && now - registrations[0] > 24 * 60 * 60 * 1000) registrations.shift();
    if (registrations.length >= MAX_REGISTRATIONS_PER_DAY) return false;
    registrations.push(now);
    return true;
}

module.exports = { accountFor, takeRegistration, MAX_GENERATION, LONG_BAN, MAX_REGISTRATIONS_PER_DAY };
