const crypto = require('crypto');

const DEVICE_ID = '1674256959939529708';
const DAY = 24 * 60 * 60 * 1000;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Registration was IP-banned per server from the 3rd account created in a short time (2024): accounts are paced, not capped.
const limits = {
    // Seconds. A longer ban moves the zone to its next account; a shorter one is waited out, plus banMarginMs.
    newAccountBan: 24 * 60 * 60,
    banMarginMs: 60 * 1000,
    // In memory, per process: one registration attempt per zone per zoneSpacingMs, perDay attempts per 24 h for the
    // whole process, none before startupDelayMs of uptime (a crash-looping API never registers).
    zoneSpacingMs: DAY,
    perDay: 2,
    startupDelayMs: 10 * 60 * 1000,
    // Pause between two logins while looking for a zone's newest account, and how far that search gallops.
    probePauseMs: 2000,
    searchSpan: 2 ** 16,
    // A search cut by a network failure or a timeout resumes on the same object after this delay.
    searchRetryMs: 10 * 60 * 1000,
};

const registrations = [];
const lastRegistration = new Map();

function encode(bytes, alphabet, length) {
    return Array.from(bytes.subarray(0, length), (byte) => alphabet[byte % alphabet.length]).join('');
}

// Generation 0 is the configured account. A zone where it is banned moves to generation 1, 2…: random-looking
// accounts and device ids derived from the configured password, the zone and the generation, so they survive restarts
// without storage, and a new account is not linked to the banned ones by its device id.
function accountFor(zone, generation, username, password) {
    if (generation === 0) return { username, password, aid: DEVICE_ID };
    const digest = (label) => crypto.createHmac('sha256', password).update(`${label}:${zone}:${generation}`).digest();
    const aid = digest('aid');
    return {
        username: encode(digest('name'), ALPHABET.slice(0, 26), 1) + encode(digest('name').subarray(1), ALPHABET.slice(0, 26) + ALPHABET.slice(52), 11),
        password: encode(digest('password'), ALPHABET, 16),
        aid: String(1 + aid[0] % 9) + encode(aid.subarray(1), ALPHABET.slice(52), 18),
    };
}

// Milliseconds before `zone` may attempt a registration, 0 if it may now.
function registrationWait(zone) {
    const now = Date.now();
    while (registrations.length && now - registrations[0] >= DAY) registrations.shift();
    const opens = [now + limits.startupDelayMs - process.uptime() * 1000];
    if (lastRegistration.has(zone)) opens.push(lastRegistration.get(zone) + limits.zoneSpacingMs);
    if (registrations.length >= limits.perDay) opens.push(registrations[registrations.length - limits.perDay] + DAY);
    return Math.max(0, Math.ceil(Math.max(...opens) - now));
}

function takeRegistration(zone) {
    const now = Date.now();
    registrations.push(now);
    lastRegistration.set(zone, now);
}

module.exports = { accountFor, registrationWait, takeRegistration, limits, DEVICE_ID };
