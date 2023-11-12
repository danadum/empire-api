const { executablePath } = require("puppeteer"); 
const puppeteerExtra = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(Stealth());
const SITE_KEY = process.env.SITE_KEY;

async function launchBrowser() {
    try {
        const browser = await puppeteerExtra.launch({ executablePath: executablePath(), headless: "new" });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        await page.goto('https://empire.goodgamestudios.com');
        await page.waitForSelector('#game');
        const iframeHandle = await page.$('#game');
        const frame = await iframeHandle.contentFrame();
        return {browser: browser, frame: frame};
    }
    catch {
        console.log("Error starting puppeteer browser");
        return null;
    }
}

async function generateRecaptchaToken(frame) {
    try {
        await frame.waitForTimeout(5000); 
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

module.exports = {
    launchBrowser,
    generateRecaptchaToken
}