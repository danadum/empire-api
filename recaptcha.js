const puppeteer = require('puppeteer-core');

const CHROME_PATH = process.env.CHROME_PATH;
const SITE_KEY = process.env.SITE_KEY;

async function launchBrowser() {
    try {
        const browser = await puppeteer.launch({executablePath: CHROME_PATH, headless: "new", args: ['--no-sandbox']});
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.resourceType() === 'image' ||
            request.resourceType() === 'font' ||
                request.resourceType() === 'media' ||
                request.url().includes('empire-html5.goodgamestudios.com/default/assets') ||
                request.url().includes('empire-html5.goodgamestudios.com/default/cldr') ||
                request.url().includes('empire-html5.goodgamestudios.com/default/items') ||
                request.url().includes('media.goodgamestudios.com') ||
                request.url().includes('fonts.goodgamestudios.com') ||
                request.url().includes('langserv.public.ggs-ep.com') ||
                request.url().includes('notify.bugsnag.com') ||
                request.url().includes('sessions.bugsnag.com') ||
                request.url().includes('facebook')
            ) {
                request.abort();
            } else {
                request.continue();
            }
        });

        await page.goto('https://empire.goodgamestudios.com');
        await page.waitForSelector('#game');
        const iframeHandle = await page.$('#game');
        const frame = await iframeHandle.contentFrame();
        await frame.waitForSelector('.grecaptcha-badge');
        return {browser: browser, frame: frame};
    }
    catch (error){
        console.log("Error starting puppeteer browser: " + error);
        return null;
    }
}

async function generateRecaptchaToken(frame) {
    try {
        const token = await frame.evaluate(async (siteKey) => {
            return new Promise((resolve) => {
                window.grecaptcha.ready(() => {
                    window.grecaptcha.execute(siteKey, { action: 'submit' }).then(resolve);
                });
            });
        }, SITE_KEY);

        return token;    
    }
    catch (error) {
        console.log("Error generating recaptcha token: " + error);
        return null;
    }
}

async function solveRecaptcha() {
    const {browser, frame} = await launchBrowser();
    const token = await generateRecaptchaToken(frame);
    await browser.close();
    console.log("Recaptcha token:\n" + token);
    return token;
}

// solveRecaptcha();

module.exports = {
    launchBrowser,
    generateRecaptchaToken
}